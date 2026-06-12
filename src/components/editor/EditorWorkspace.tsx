import { useEffect, useMemo, useRef, useState } from "react";
import type { ClipboardEvent, DragEvent, KeyboardEvent, MouseEvent, MutableRefObject } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Image from "@tiptap/extension-image";
import { Table, TableRow, TableCell, TableHeader } from "@tiptap/extension-table";
import Highlight from "@tiptap/extension-highlight";
import Typography from "@tiptap/extension-typography";
import type { CursorPosition, EditorMode, MarkdownFile, SearchResult } from "../../types/models";
import type { MarkdownService } from "../../services/markdownService";
import { htmlToMarkdown } from "../../services/htmlMarkdownConversionService";
import { filterWikiCandidates, findWikiLinkTrigger, replaceWikiTrigger } from "../../services/wikiLinkService";
import type { WikiLinkCandidate, WikiLinkTrigger } from "../../services/wikiLinkService";

interface EditorWorkspaceProps {
  file: MarkdownFile;
  markdownService: MarkdownService;
  mode: EditorMode;
  typewriterMode?: boolean;
  cursorPosition?: CursorPosition | null;
  onDirtyChange: (dirty: boolean, content: string) => void;
  onCursorChange?: (cursor: CursorPosition) => void;
  onModeChange: (mode: EditorMode) => void;
  onAttachmentPaste?: (file: File) => Promise<string>;
  onOpenWikiLink?: (title: string) => void;
  onOpenBacklink?: (fileId: string) => void;
  wikiBacklinks?: SearchResult[];
  wikiCandidates?: WikiLinkCandidate[];
}

const modeLabels: Record<EditorMode, string> = {
  source: "代码模式",
  split: "双视图模式",
  wysiwyg: "所见即所得",
};

interface SearchMatch {
  start: number;
  end: number;
}

interface OutlineItem {
  level: number;
  line: number;
  offset: number;
  title: string;
}

type MarkdownCommand = "bold" | "italic" | "heading" | "code" | "date" | "task" | "link";

const TEXTAREA_LINE_HEIGHT = 22.1;

type CodeMirrorViewHandle = {
  destroy: () => void;
  focus: () => void;
  dispatch: (spec: unknown) => void;
  state: {
    doc: { toString: () => string };
    selection: { main: { from: number; to: number; head: number } };
  };
  scrollDOM: HTMLElement;
};

function cursorFromOffset(content: string, offset: number): CursorPosition {
  const safeOffset = Math.max(0, Math.min(offset, content.length));
  const beforeCursor = content.slice(0, safeOffset);
  const line = beforeCursor.split("\n").length;
  const lastLineStart = beforeCursor.lastIndexOf("\n");
  const column = lastLineStart === -1 ? beforeCursor.length + 1 : beforeCursor.length - lastLineStart;
  return { line, column };
}

function offsetFromCursor(content: string, cursor: CursorPosition): number {
  const lines = content.split("\n");
  const safeLine = Math.max(1, Math.min(cursor.line, lines.length));
  const lineStart = lines.slice(0, safeLine - 1).reduce((offset, line) => offset + line.length + 1, 0);
  const safeColumn = Math.max(1, Math.min(cursor.column, lines[safeLine - 1].length + 1));
  return lineStart + safeColumn - 1;
}

function todayText() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function taskLineIndexes(content: string) {
  return content
    .split("\n")
    .map((line, index) => (/^\s*- \[[ xX]\] /.test(line) ? index : -1))
    .filter((index) => index >= 0);
}

function extractOutline(content: string): OutlineItem[] {
  const items: OutlineItem[] = [];
  let offset = 0;

  content.split("\n").forEach((line, index) => {
    const match = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (match) {
      items.push({
        level: match[1].length,
        line: index + 1,
        offset,
        title: match[2].replace(/\s+#+$/, "").trim() || "未命名标题",
      });
    }
    offset += line.length + 1;
  });

  return items;
}

interface CodeMirrorPaneProps {
  ariaLabel: string;
  value: string;
  typewriterMode: boolean;
  viewRef: MutableRefObject<CodeMirrorViewHandle | null>;
  onChange: (value: string) => void;
  onCursorChange: (offset: number) => void;
  onPaste: (event: ClipboardEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onScroll?: (event?: { currentTarget: HTMLElement }) => void;
}

function CodeMirrorPane({
  ariaLabel,
  value,
  typewriterMode,
  viewRef,
  onChange,
  onCursorChange,
  onPaste,
  onDrop,
  onDragOver,
  onScroll,
}: CodeMirrorPaneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  const onCursorChangeRef = useRef(onCursorChange);
  const onScrollRef = useRef(onScroll);

  useEffect(() => {
    onChangeRef.current = onChange;
    onCursorChangeRef.current = onCursorChange;
    onScrollRef.current = onScroll;
  }, [onChange, onCursorChange, onScroll]);

  useEffect(() => {
    if (!hostRef.current) return;

    let cancelled = false;
    let view: CodeMirrorViewHandle | null = null;

    void Promise.all([
      import("@codemirror/state"),
      import("@codemirror/view"),
      import("@codemirror/lang-markdown"),
      import("@codemirror/theme-one-dark"),
      import("codemirror"),
    ]).then(([stateModule, viewModule, markdownModule, themeModule, setupModule]) => {
      if (cancelled || !hostRef.current) return;
      const { EditorState } = stateModule;
      const { EditorView } = viewModule;
      const codeMirrorTheme = EditorView.theme({
        "&": {
          height: "100%",
          background: "transparent",
          color: "#d6deeb",
          fontSize: "14px",
        },
        ".cm-scroller": {
          fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
          lineHeight: "1.58",
        },
        ".cm-content": {
          minHeight: "100%",
          padding: "18px 20px",
        },
        ".cm-gutters": {
          background: "rgba(8, 13, 26, 0.88)",
          borderRight: "1px solid rgba(255,255,255,0.06)",
          color: "#607089",
        },
      });

      view = new EditorView({
        parent: hostRef.current,
        state: EditorState.create({
          doc: value,
          extensions: [
            setupModule.basicSetup,
            markdownModule.markdown(),
            themeModule.oneDark,
            codeMirrorTheme,
            EditorView.lineWrapping,
            EditorView.contentAttributes.of({
              "aria-label": ariaLabel,
              role: "textbox",
            }),
            EditorView.updateListener.of((update) => {
              if (update.docChanged) {
                onChangeRef.current(update.state.doc.toString());
              }
              if (update.selectionSet || update.docChanged) {
                onCursorChangeRef.current(update.state.selection.main.head);
              }
            }),
            EditorView.domEventHandlers({
              scroll: (event) => {
                onScrollRef.current?.({ currentTarget: event.currentTarget as HTMLElement });
                return false;
              },
            }),
          ],
        }),
      }) as CodeMirrorViewHandle;
      viewRef.current = view;
    });

    return () => {
      cancelled = true;
      view?.destroy();
      viewRef.current = null;
    };
  }, [ariaLabel, value, viewRef]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    });
  }, [value, viewRef]);

  return (
    <div
      ref={hostRef}
      className={`codemirror-pane ${typewriterMode ? "typewriter-textarea" : ""}`}
      data-testid={`${ariaLabel.includes("双视图") ? "split" : "source"}-codemirror`}
      onPaste={onPaste}
      onDrop={onDrop}
      onDragOver={onDragOver}
    />
  );
}

export function EditorWorkspace({
  file,
  markdownService,
  mode,
  typewriterMode = false,
  cursorPosition,
  onDirtyChange,
  onCursorChange,
  onModeChange,
  onAttachmentPaste,
  onOpenWikiLink,
  onOpenBacklink,
  wikiBacklinks = [],
  wikiCandidates = [],
}: EditorWorkspaceProps) {
  const [content, setContent] = useState(file.raw);
  const [findPanelOpen, setFindPanelOpen] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [replaceQuery, setReplaceQuery] = useState("");
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [outlineOpen, setOutlineOpen] = useState(true);
  const [activeLine, setActiveLine] = useState(cursorPosition?.line ?? 1);
  const [wikiTrigger, setWikiTrigger] = useState<WikiLinkTrigger | null>(null);
  const sourceRef = useRef<HTMLTextAreaElement>(null);
  const splitRef = useRef<HTMLTextAreaElement>(null);
  const sourceCodeMirrorRef = useRef<CodeMirrorViewHandle | null>(null);
  const splitCodeMirrorRef = useRef<CodeMirrorViewHandle | null>(null);
  const splitPreviewRef = useRef<HTMLDivElement>(null);
  const wysiwygRef = useRef<HTMLDivElement>(null);
  const appliedCursorKey = useRef<string | null>(null);
  const syncingScroll = useRef<"source" | "preview" | null>(null);
  const syncingTipTap = useRef(false);

  useEffect(() => {
    setContent(file.raw);
    appliedCursorKey.current = null;
  }, [file.id, file.raw]);

  useEffect(() => {
    if (!cursorPosition || mode === "wysiwyg") return;

    const cursorKey = `${file.id}:${mode}:${cursorPosition.line}:${cursorPosition.column}`;
    if (appliedCursorKey.current === cursorKey) return;

    const offset = offsetFromCursor(content, cursorPosition);
    setEditorSelection(offset, offset, mode);
    setActiveLine(cursorPosition.line);
    appliedCursorKey.current = cursorKey;
  }, [content, cursorPosition, file.id, mode, typewriterMode]);

  const taskIndexes = useMemo(() => taskLineIndexes(content), [content]);
  const [rendered, setRendered] = useState(() => markdownService.render(content, taskIndexes));
  const lines = useMemo(() => content.split("\n"), [content]);
  const outlineItems = useMemo(() => extractOutline(content), [content]);
  const wikiSuggestions = useMemo(
    () => (wikiTrigger ? filterWikiCandidates(wikiCandidates, wikiTrigger.query, file.id) : []),
    [file.id, wikiCandidates, wikiTrigger],
  );
  const activeOutlineLine = useMemo(() => {
    const activeItem = outlineItems.filter((item) => item.line <= activeLine).at(-1);
    return activeItem?.line;
  }, [activeLine, outlineItems]);
  const matches = useMemo<SearchMatch[]>(() => {
    if (!findQuery) return [];

    const nextMatches: SearchMatch[] = [];
    const needle = findQuery.toLowerCase();
    const haystack = content.toLowerCase();
    let offset = haystack.indexOf(needle);
    while (offset >= 0) {
      nextMatches.push({ start: offset, end: offset + findQuery.length });
      offset = haystack.indexOf(needle, offset + Math.max(findQuery.length, 1));
    }
    return nextMatches;
  }, [content, findQuery]);
  const tiptapEditor = useEditor({
    immediatelyRender: false,
    content: rendered,
    editable: mode === "wysiwyg",
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: "开始写点什么..." }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Image,
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      Highlight,
      Typography,
    ],
    editorProps: {
      attributes: {
        "aria-label": "TipTap 所见即所得编辑器",
        class: "wysiwyg-editor md-render",
      },
    },
    onUpdate: ({ editor }) => {
      if (mode !== "wysiwyg") return;
      if (syncingTipTap.current) return;
      const markdown = htmlToMarkdown(editor.getHTML());
      updateContent(markdown);
    },
  });

  useEffect(() => {
    setActiveMatchIndex(0);
  }, [findQuery]);

  useEffect(() => {
    if (!tiptapEditor) return;
    tiptapEditor.setEditable(mode === "wysiwyg");
  }, [mode, tiptapEditor]);

  useEffect(() => {
    if (!tiptapEditor) return;
    syncingTipTap.current = true;
    tiptapEditor.commands.setContent(rendered || "<p></p>", { emitUpdate: false });
    syncingTipTap.current = false;
  }, [rendered, tiptapEditor]);

  useEffect(() => {
    let cancelled = false;
    const fallbackHtml = markdownService.render(content, taskIndexes);
    setRendered(fallbackHtml);
    void markdownService.renderAsync(content, taskIndexes).then((html) => {
      if (!cancelled) setRendered(html);
    });
    return () => {
      cancelled = true;
    };
  }, [content, markdownService, taskIndexes]);

  useEffect(() => {
    if (import.meta.env.MODE === "test") return;
    const roots = [splitPreviewRef.current, wysiwygRef.current].filter(Boolean) as HTMLElement[];
    if (!roots.some((root) => root.querySelector(".mermaid"))) return;

    let cancelled = false;
    const mermaidVendorUrl = "/vendor/mermaid/mermaid.esm.min.mjs";
    void import(/* @vite-ignore */ mermaidVendorUrl).then(({ default: mermaid }) => {
      if (cancelled) return;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "dark",
      });
      for (const root of roots) {
        void mermaid.run({ nodes: root.querySelectorAll<HTMLElement>(".mermaid") });
      }
    }).catch(() => {
      // Mermaid 图表渲染失败时保留原始代码块，避免影响普通 Markdown 预览。
    });

    return () => {
      cancelled = true;
    };
  }, [mode, rendered]);

  const updateContent = (nextContent: string) => {
    setContent(nextContent);
    onDirtyChange(true, nextContent);
  };

  const updateWikiTrigger = (textarea: HTMLTextAreaElement, nextContent = textarea.value) => {
    setWikiTrigger(findWikiLinkTrigger(nextContent, textarea.selectionStart));
  };

  const reportCursor = (textarea: HTMLTextAreaElement) => {
    const cursor = cursorFromOffset(textarea.value, textarea.selectionStart);
    setActiveLine(cursor.line);
    updateWikiTrigger(textarea);
    if (typewriterMode) centerTextareaLine(textarea, cursor.line);
    onCursorChange?.(cursor);
  };

  const reportCodeMirrorCursor = (offset: number) => {
    const cursor = cursorFromOffset(content, offset);
    setActiveLine(cursor.line);
    onCursorChange?.(cursor);
  };

  const activeTextarea = () => (mode === "split" ? splitRef.current : sourceRef.current);
  const activeCodeMirror = (targetMode: EditorMode = mode) => (targetMode === "split" ? splitCodeMirrorRef.current : sourceCodeMirrorRef.current);

  const setEditorSelection = (start: number, end: number, targetMode: EditorMode = mode) => {
    const textarea = targetMode === "split" ? splitRef.current : sourceRef.current;
    if (textarea) {
      textarea.focus();
      textarea.setSelectionRange(start, end);
      setActiveLine(cursorFromOffset(textarea.value, start).line);
      if (typewriterMode) centerTextareaLine(textarea, cursorFromOffset(textarea.value, start).line);
    }

    const view = activeCodeMirror(targetMode);
    if (view) {
      view.focus();
      view.dispatch({ selection: { anchor: start, head: end }, scrollIntoView: true });
    }
  };

  const activeSelection = () => {
    const textarea = activeTextarea();
    if (textarea && (textarea.selectionStart !== textarea.selectionEnd || document.activeElement === textarea)) {
      return { start: textarea.selectionStart, end: textarea.selectionEnd };
    }

    const view = activeCodeMirror();
    if (view) {
      const selection = view.state.selection.main;
      return { start: selection.from, end: selection.to };
    }

    return {
      start: textarea?.selectionStart ?? content.length,
      end: textarea?.selectionEnd ?? content.length,
    };
  };

  const centerTextareaLine = (textarea: HTMLTextAreaElement, line: number) => {
    const visibleHeight = textarea.clientHeight || 0;
    if (!visibleHeight) return;

    const targetTop = Math.max(0, (line - 1) * TEXTAREA_LINE_HEIGHT - visibleHeight * 0.45);
    textarea.scrollTop = targetTop;

    if (textarea === splitRef.current && splitPreviewRef.current) {
      syncScrollPosition(textarea, splitPreviewRef.current, "source");
    }
  };

  const syncScrollPosition = (from: HTMLElement, to: HTMLElement, source: "source" | "preview") => {
    if (syncingScroll.current && syncingScroll.current !== source) return;

    const fromMax = from.scrollHeight - from.clientHeight;
    const toMax = to.scrollHeight - to.clientHeight;
    const ratio = fromMax > 0 ? from.scrollTop / fromMax : 0;

    syncingScroll.current = source;
    to.scrollTop = toMax > 0 ? toMax * ratio : 0;
    window.requestAnimationFrame(() => {
      syncingScroll.current = null;
    });
  };

  const handleSplitSourceScroll = (event?: { currentTarget: HTMLElement }) => {
    const source = event?.currentTarget ?? splitCodeMirrorRef.current?.scrollDOM ?? splitRef.current;
    if (!source || !splitPreviewRef.current) return;
    syncScrollPosition(source, splitPreviewRef.current, "source");
  };

  const handleSplitPreviewScroll = () => {
    const source = splitCodeMirrorRef.current?.scrollDOM ?? splitRef.current;
    if (!source || !splitPreviewRef.current) return;
    syncScrollPosition(splitPreviewRef.current, source, "preview");
  };

  const focusSelection = (start: number, end: number, targetMode: EditorMode = mode) => {
    window.setTimeout(() => {
      setEditorSelection(start, end, targetMode);
    }, 0);
  };

  const selectMatch = (index: number) => {
    if (!matches.length) return;
    const safeIndex = ((index % matches.length) + matches.length) % matches.length;
    setActiveMatchIndex(safeIndex);
    const match = matches[safeIndex];
    focusSelection(match.start, match.end);
  };

  const jumpToOutline = (item: OutlineItem) => {
    const targetMode = mode === "split" ? "split" : "source";
    if (mode === "wysiwyg") onModeChange("source");
    setActiveLine(item.line);
    focusSelection(item.offset, item.offset, targetMode);
  };

  const replaceSelection = (buildText: (selected: string) => string, fallback: string) => {
    const { start, end } = activeSelection();
    const selected = content.slice(start, end);
    const nextText = selected ? buildText(selected) : fallback;
    const nextContent = `${content.slice(0, start)}${nextText}${content.slice(end)}`;
    updateContent(nextContent);
    focusSelection(start, start + nextText.length);
  };

  const insertTextAtCursor = (text: string, selection = activeSelection()) => {
    const { start, end } = selection;
    const prefix = content.slice(0, start);
    const suffix = content.slice(end);
    const spacingBefore = prefix && !prefix.endsWith("\n") ? "\n\n" : "";
    const spacingAfter = suffix && !suffix.startsWith("\n") ? "\n\n" : "";
    const inserted = `${spacingBefore}${text}${spacingAfter}`;
    const nextContent = `${prefix}${inserted}${suffix}`;
    updateContent(nextContent);
    focusSelection(start + inserted.length, start + inserted.length);
  };

  const completeWikiLink = (candidate: WikiLinkCandidate) => {
    if (!wikiTrigger) return;
    const nextContent = replaceWikiTrigger(content, wikiTrigger, candidate.title);
    const cursorOffset = wikiTrigger.start + candidate.title.length + 4;
    updateContent(nextContent);
    setWikiTrigger(null);
    focusSelection(cursorOffset, cursorOffset);
  };

  const applyCommand = (command: MarkdownCommand) => {
    const commands: Record<MarkdownCommand, () => void> = {
      bold: () => replaceSelection((selected) => `**${selected}**`, "**加粗文字**"),
      italic: () => replaceSelection((selected) => `*${selected}*`, "*斜体文字*"),
      heading: () => replaceSelection((selected) => `## ${selected}`, "## 新标题"),
      code: () => replaceSelection((selected) => `\`${selected}\``, "`代码`"),
      date: () => replaceSelection(() => todayText(), todayText()),
      task: () => replaceSelection((selected) => `- [ ] ${selected}`, "- [ ] 新任务"),
      link: () => replaceSelection((selected) => `[${selected}](https://example.com)`, "[链接文本](https://example.com)"),
    };
    commands[command]();
  };

  const replaceCurrentMatch = () => {
    if (!matches.length) return;
    const match = matches[activeMatchIndex] ?? matches[0];
    const nextContent = `${content.slice(0, match.start)}${replaceQuery}${content.slice(match.end)}`;
    updateContent(nextContent);
    focusSelection(match.start, match.start + replaceQuery.length);
  };

  const replaceAllMatches = () => {
    if (!findQuery) return;
    const nextContent = content.replace(new RegExp(findQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), replaceQuery);
    updateContent(nextContent);
  };

  const toggleTaskLine = (lineIndex: number) => {
    const nextLines = content.split("\n");
    const line = nextLines[lineIndex];
    if (!line || !/^\s*- \[[ xX]\] /.test(line)) return;
    nextLines[lineIndex] = line.replace(/\[[ xX]\]/, /\[[xX]\]/.test(line) ? "[ ]" : "[x]");
    updateContent(nextLines.join("\n"));
  };

  const handlePreviewClick = (event: MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    const wikiLink = target.closest<HTMLAnchorElement>("a[data-wiki-link]");
    if (wikiLink) {
      event.preventDefault();
      onOpenWikiLink?.(wikiLink.dataset.wikiLink ?? wikiLink.textContent ?? "");
      return;
    }

    const checkbox = target.closest<HTMLInputElement>("input[data-task-line]");
    if (!checkbox) return;
    const line = Number(checkbox.dataset.taskLine);
    if (Number.isFinite(line)) toggleTaskLine(line);
  };

  const handleEditorKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const key = event.key.toLowerCase();
    if (!(event.ctrlKey || event.metaKey)) return;

    if (key === "b") {
      event.preventDefault();
      applyCommand("bold");
    }
    if (key === "i") {
      event.preventDefault();
      applyCommand("italic");
    }
    if (key === "k") {
      event.preventDefault();
      applyCommand("link");
    }
    if (key === "f") {
      event.preventDefault();
      setFindPanelOpen(true);
      setReplaceOpen(false);
    }
    if (key === "h") {
      event.preventDefault();
      setFindPanelOpen(true);
      setReplaceOpen(true);
    }
  };

  const imageFilesFromList = (files: FileList | File[]) => Array.from(files).filter((item) => item.type.startsWith("image/"));

  const insertImageFiles = async (files: File[], selection?: { start: number; end: number }) => {
    if (!onAttachmentPaste || !files.length) return;
    const links = await Promise.all(files.map((item) => onAttachmentPaste(item)));
    insertTextAtCursor(links.join("\n"), selection);
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement | HTMLDivElement>) => {
    const files = imageFilesFromList(event.clipboardData.files);
    if (!files.length) return;
    event.preventDefault();
    const target = event.currentTarget;
    const selection = target instanceof HTMLTextAreaElement
      ? { start: target.selectionStart, end: target.selectionEnd }
      : activeSelection();
    void insertImageFiles(files, selection);
  };

  const handleDrop = (event: DragEvent<HTMLTextAreaElement | HTMLElement>) => {
    const files = imageFilesFromList(event.dataTransfer.files);
    if (!files.length) return;
    event.preventDefault();
    const target = event.currentTarget;
    const selection = target instanceof HTMLTextAreaElement
      ? { start: target.selectionStart, end: target.selectionEnd }
      : activeSelection();
    void insertImageFiles(files, selection);
  };

  const handleDragOver = (event: DragEvent<HTMLTextAreaElement | HTMLElement>) => {
    if (imageFilesFromList(event.dataTransfer.files).length) {
      event.preventDefault();
    }
  };

  return (
    <section className="main">
      <div className="editor-toolbar">
        <div className="editor-mode-switch" role="tablist" aria-label="编辑模式">
          <button className={`mode-btn ${mode === "source" ? "active" : ""}`} type="button" onClick={() => onModeChange("source")}>
            代码
          </button>
          <button className={`mode-btn ${mode === "split" ? "active" : ""}`} type="button" onClick={() => onModeChange("split")}>
            双视图
          </button>
          <button className={`mode-btn ${mode === "wysiwyg" ? "active" : ""}`} type="button" onClick={() => onModeChange("wysiwyg")}>
            所见即所得
          </button>
        </div>

        <div className="toolbar-divider" />
        <div className="toolbar-actions" aria-label="Markdown 工具栏">
          <button aria-label="加粗" className="toolbar-btn bold" type="button" onClick={() => applyCommand("bold")}>B</button>
          <button aria-label="斜体" className="toolbar-btn italic" type="button" onClick={() => applyCommand("italic")}>I</button>
          <button aria-label="标题" className="toolbar-btn" type="button" onClick={() => applyCommand("heading")}>H</button>
          <button aria-label="行内代码" className="toolbar-btn code" type="button" onClick={() => applyCommand("code")}>&lt;/&gt;</button>
          <button aria-label="插入日期" className="toolbar-btn" type="button" onClick={() => applyCommand("date")}>日</button>
          <button aria-label="任务列表" className="toolbar-btn" type="button" onClick={() => applyCommand("task")}>☐</button>
          <button aria-label="插入链接" className="toolbar-btn" type="button" onClick={() => applyCommand("link")}>🔗</button>
          <button aria-label="查找" className="toolbar-btn" type="button" onClick={() => { setFindPanelOpen(true); setReplaceOpen(false); }}>⌕</button>
          <button aria-label="替换" className="toolbar-btn" type="button" onClick={() => { setFindPanelOpen(true); setReplaceOpen(true); }}>↔</button>
          <button
            aria-label="大纲"
            aria-pressed={outlineOpen}
            className={`toolbar-btn ${outlineOpen ? "active" : ""}`}
            type="button"
            onClick={() => setOutlineOpen((open) => !open)}
          >
            纲
          </button>
        </div>

        <div className="toolbar-divider" />
        <div className="breadcrumb">
          <span>MoKnow 日记仓库</span>
          <span className="bc-sep">›</span>
          <span>{file.path}</span>
          <span className="bc-sep">›</span>
          <span className="bc-current">{file.name}</span>
        </div>

        <span className="mode-label" data-testid="mode-label">{modeLabels[mode]}</span>
      </div>

      {findPanelOpen ? (
        <div className="find-panel" aria-label="查找和替换">
          <input aria-label="查找内容" value={findQuery} onChange={(event) => setFindQuery(event.target.value)} placeholder="查找" />
          {replaceOpen ? <input aria-label="替换为" value={replaceQuery} onChange={(event) => setReplaceQuery(event.target.value)} placeholder="替换为" /> : null}
          <span className="find-count">{findQuery ? `${matches.length ? activeMatchIndex + 1 : 0}/${matches.length}` : "0/0"}</span>
          <button type="button" onClick={() => selectMatch(activeMatchIndex - 1)}>上一个</button>
          <button type="button" onClick={() => selectMatch(activeMatchIndex + 1)}>下一个</button>
          {replaceOpen ? <button type="button" onClick={replaceCurrentMatch}>替换</button> : null}
          {replaceOpen ? <button type="button" onClick={replaceAllMatches}>全部替换</button> : null}
          <button type="button" onClick={() => setFindPanelOpen(false)}>关闭</button>
        </div>
      ) : null}

      <div className="editor-area">
        <div className={`source-editor ${mode !== "source" ? "hidden" : ""}`} id="editorSource" data-testid="editor-source" hidden={mode !== "source"}>
          <div className="line-numbers">
            {lines.map((_, index) => (
              <span key={`line-${index + 1}`} className={index === 11 ? "active" : ""}>{index + 1}</span>
            ))}
          </div>
          <CodeMirrorPane
            ariaLabel="CodeMirror Markdown 源码编辑器"
            value={content}
            typewriterMode={typewriterMode}
            viewRef={sourceCodeMirrorRef}
            onChange={updateContent}
            onCursorChange={reportCodeMirrorCursor}
            onPaste={handlePaste}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
          />
          <textarea
            ref={sourceRef}
            aria-label="Markdown 源码编辑器"
            className={`code-content code-textarea editor-fallback-textarea ${typewriterMode ? "typewriter-textarea" : ""}`}
            spellCheck={false}
            value={content}
            onKeyDown={handleEditorKeyDown}
            onPaste={handlePaste}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onChange={(event) => {
              updateContent(event.target.value);
              updateWikiTrigger(event.target);
              reportCursor(event.target);
            }}
            onClick={(event) => reportCursor(event.currentTarget)}
            onKeyUp={(event) => reportCursor(event.currentTarget)}
            onSelect={(event) => reportCursor(event.currentTarget)}
          />
        </div>

        <div className={`split-editor ${mode !== "split" ? "hidden" : ""}`} id="editorSplit" data-testid="editor-split" hidden={mode !== "split"}>
          <div className="split-left">
            <CodeMirrorPane
              ariaLabel="CodeMirror Markdown 双视图源码编辑器"
              value={content}
              typewriterMode={typewriterMode}
              viewRef={splitCodeMirrorRef}
              onChange={updateContent}
              onCursorChange={reportCodeMirrorCursor}
              onPaste={handlePaste}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onScroll={handleSplitSourceScroll}
            />
            <textarea
              ref={splitRef}
              aria-label="Markdown 双视图源码编辑器"
              className={`code-content code-textarea split-textarea editor-fallback-textarea ${typewriterMode ? "typewriter-textarea" : ""}`}
              spellCheck={false}
              value={content}
              onKeyDown={handleEditorKeyDown}
              onPaste={handlePaste}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onScroll={handleSplitSourceScroll}
              onChange={(event) => {
                updateContent(event.target.value);
                updateWikiTrigger(event.target);
                reportCursor(event.target);
              }}
              onClick={(event) => reportCursor(event.currentTarget)}
              onKeyUp={(event) => reportCursor(event.currentTarget)}
              onSelect={(event) => reportCursor(event.currentTarget)}
            />
          </div>
          <div className="split-right" ref={splitPreviewRef} data-testid="split-preview" onScroll={handleSplitPreviewScroll}>
            <article className="md-render" onClick={handlePreviewClick} dangerouslySetInnerHTML={{ __html: rendered }} />
          </div>
        </div>

        <div className={`wysiwyg-shell ${mode !== "wysiwyg" ? "hidden" : ""}`} id="editorWysiwyg" data-testid="editor-wysiwyg" hidden={mode !== "wysiwyg"}>
          <div
            ref={wysiwygRef}
            onClick={handlePreviewClick}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
          >
            <EditorContent editor={tiptapEditor} />
          </div>
        </div>

        {outlineOpen ? (
          <aside className="outline-panel">
            <div className="outline-header">
              <span>文档大纲</span>
              <button type="button" onClick={() => setOutlineOpen(false)} aria-label="收起大纲">
                收起
              </button>
            </div>
            <nav className="outline-list" aria-label="文档大纲">
              {outlineItems.length ? (
                outlineItems.map((item) => (
                  <button
                    key={`${item.line}-${item.title}`}
                    type="button"
                    className={`outline-item level-${item.level} ${activeOutlineLine === item.line ? "active" : ""}`}
                    aria-current={activeOutlineLine === item.line ? "location" : undefined}
                    onClick={() => jumpToOutline(item)}
                  >
                    <span>{item.title}</span>
                    <small>{item.line}</small>
                  </button>
                ))
              ) : (
                <span className="outline-empty">暂无标题</span>
              )}
            </nav>
            <div className="backlink-section">
              <div className="outline-header backlink-header">
                <span>反向链接</span>
                <small>{wikiBacklinks.length}</small>
              </div>
              <nav className="backlink-list" aria-label="反向链接">
                {wikiBacklinks.length ? (
                  wikiBacklinks.map((link) => (
                    <button key={`${link.fileId}:${link.relativePath}`} type="button" className="backlink-item" onClick={() => onOpenBacklink?.(link.fileId)}>
                      <span>{link.name}</span>
                      <small>{link.relativePath}</small>
                    </button>
                  ))
                ) : (
                  <span className="outline-empty">暂无反向链接</span>
                )}
              </nav>
            </div>
          </aside>
        ) : null}

        {wikiSuggestions.length ? (
          <div className="wiki-suggest" role="listbox" aria-label="双链自动补全">
            {wikiSuggestions.map((candidate) => (
              <button
                key={`${candidate.fileId}:${candidate.path}`}
                type="button"
                role="option"
                className="wiki-suggest-item"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => completeWikiLink(candidate)}
              >
                <span>{candidate.title}</span>
                <small>{candidate.path}</small>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

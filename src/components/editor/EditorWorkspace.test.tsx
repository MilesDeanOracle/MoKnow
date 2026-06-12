import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { EditorWorkspace } from "./EditorWorkspace";
import { MarkdownService } from "../../services/markdownService";
import type { CursorPosition, EditorMode, MarkdownFile, SearchResult } from "../../types/models";
import type { WikiLinkCandidate } from "../../services/wikiLinkService";

const file: MarkdownFile = {
  id: "source",
  name: "2024-06-04-日记.md",
  path: "2024 › 06月",
  raw: "# 今日\n\n## 计划\n\n- [ ] 写测试",
};

function ControlledEditor({
  cursorPosition,
  initialFile = file,
  onAttachmentPaste,
  onCursorChange,
  onDirtyChange = () => undefined,
  onOpenBacklink,
  onOpenWikiLink,
  typewriterMode = false,
  wikiBacklinks = [],
  wikiCandidates = [],
}: {
  cursorPosition?: CursorPosition;
  initialFile?: MarkdownFile;
  onAttachmentPaste?: (file: File) => Promise<string>;
  onCursorChange?: (cursor: CursorPosition) => void;
  onDirtyChange?: (dirty: boolean, content: string) => void;
  onOpenBacklink?: (fileId: string) => void;
  onOpenWikiLink?: (title: string) => void;
  typewriterMode?: boolean;
  wikiBacklinks?: SearchResult[];
  wikiCandidates?: WikiLinkCandidate[];
}) {
  const [mode, setMode] = useState<EditorMode>("source");

  return (
    <EditorWorkspace
      file={initialFile}
      markdownService={new MarkdownService()}
      mode={mode}
      typewriterMode={typewriterMode}
      cursorPosition={cursorPosition}
      onAttachmentPaste={onAttachmentPaste}
      onCursorChange={onCursorChange}
      onDirtyChange={onDirtyChange}
      onModeChange={setMode}
      onOpenBacklink={onOpenBacklink}
      onOpenWikiLink={onOpenWikiLink}
      wikiBacklinks={wikiBacklinks}
      wikiCandidates={wikiCandidates}
    />
  );
}

describe("EditorWorkspace", () => {
  it("switches between source split and wysiwyg modes", async () => {
    render(<ControlledEditor />);

    expect(screen.getByTestId("editor-source")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "双视图" }));
    const splitEditor = screen.getByTestId("editor-split");
    expect(splitEditor).toBeVisible();
    await waitFor(() => expect(screen.getByTestId("split-codemirror").querySelector(".cm-editor")).not.toBeNull());
    expect(within(splitEditor).getAllByText(/计划/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "所见即所得" }));
    expect(screen.getByTestId("editor-wysiwyg")).toBeVisible();
    expect(screen.getByLabelText("TipTap 所见即所得编辑器")).toBeInTheDocument();
  });

  it("edits markdown through a stable textarea and keeps the preview in sync", async () => {
    const onDirtyChange = vi.fn();
    render(<ControlledEditor onDirtyChange={onDirtyChange} />);

    const editor = screen.getByLabelText("Markdown 源码编辑器");
    fireEvent.change(editor, { target: { value: `${file.raw}\n\n新增内容` } });

    expect(onDirtyChange).toHaveBeenLastCalledWith(true, `${file.raw}\n\n新增内容`);

    fireEvent.click(screen.getByRole("button", { name: "双视图" }));
    await waitFor(() => expect(within(screen.getByTestId("editor-split")).getAllByText("新增内容").length).toBeGreaterThanOrEqual(2));
  });

  it("reports and restores textarea cursor position by line and column", async () => {
    const onCursorChange = vi.fn();
    render(<ControlledEditor cursorPosition={{ line: 3, column: 4 }} onCursorChange={onCursorChange} />);

    const editor = screen.getByLabelText("Markdown 源码编辑器") as HTMLTextAreaElement;
    await waitFor(() => expect(editor.selectionStart).toBe(file.raw.indexOf("计划")));

    editor.setSelectionRange(file.raw.indexOf("写测试") + 2, file.raw.indexOf("写测试") + 2);
    fireEvent.select(editor);

    expect(onCursorChange).toHaveBeenLastCalledWith({ line: 5, column: 9 });
  });

  it("applies markdown shortcuts from the toolbar and keyboard", () => {
    const onDirtyChange = vi.fn();
    render(<ControlledEditor onDirtyChange={onDirtyChange} />);

    const editor = screen.getByLabelText("Markdown 源码编辑器") as HTMLTextAreaElement;
    editor.setSelectionRange(2, 4);
    fireEvent.click(screen.getByRole("button", { name: "加粗" }));

    expect(onDirtyChange).toHaveBeenLastCalledWith(true, "# **今日**\n\n## 计划\n\n- [ ] 写测试");

    fireEvent.keyDown(editor, { key: "k", metaKey: true });
    expect(onDirtyChange.mock.calls.at(-1)?.[1]).toContain("https://example.com");

    fireEvent.click(screen.getByRole("button", { name: "插入日期" }));
    expect(onDirtyChange.mock.calls.at(-1)?.[1]).toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("toggles task checkboxes from the rendered preview and updates markdown", () => {
    const onDirtyChange = vi.fn();
    render(<ControlledEditor onDirtyChange={onDirtyChange} />);

    fireEvent.click(screen.getByRole("button", { name: "双视图" }));
    fireEvent.click(within(screen.getByTestId("editor-split")).getByRole("checkbox"));

    expect(onDirtyChange).toHaveBeenLastCalledWith(true, "# 今日\n\n## 计划\n\n- [x] 写测试");
  });

  it("finds and replaces text in the current file", () => {
    const onDirtyChange = vi.fn();
    render(<ControlledEditor onDirtyChange={onDirtyChange} />);

    fireEvent.click(screen.getByRole("button", { name: "替换" }));
    fireEvent.change(screen.getByLabelText("查找内容"), { target: { value: "计划" } });
    fireEvent.change(screen.getByLabelText("替换为"), { target: { value: "安排" } });

    expect(screen.getByText("1/1")).toBeInTheDocument();

    fireEvent.click(within(screen.getByLabelText("查找和替换")).getByRole("button", { name: "替换" }));
    expect(onDirtyChange).toHaveBeenLastCalledWith(true, "# 今日\n\n## 安排\n\n- [ ] 写测试");
  });

  it("builds a collapsible outline and jumps to headings", async () => {
    render(<ControlledEditor />);

    const outline = screen.getByRole("navigation", { name: "文档大纲" });
    expect(within(outline).getByText("今日")).toBeInTheDocument();
    expect(within(outline).getByText("计划")).toBeInTheDocument();

    const planButton = within(outline).getByText("计划").closest("button");
    expect(planButton).not.toBeNull();
    fireEvent.click(planButton!);

    const editor = screen.getByLabelText("Markdown 源码编辑器") as HTMLTextAreaElement;
    await waitFor(() => expect(editor.selectionStart).toBe(file.raw.indexOf("## 计划")));

    fireEvent.click(screen.getByRole("button", { name: "大纲" }));
    expect(screen.queryByRole("navigation", { name: "文档大纲" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "大纲" }));
    expect(screen.getByRole("navigation", { name: "文档大纲" })).toBeInTheDocument();
  });

  it("syncs split source scrolling with the rendered preview", () => {
    render(<ControlledEditor />);

    fireEvent.click(screen.getByRole("button", { name: "双视图" }));
    const source = screen.getByLabelText("Markdown 双视图源码编辑器") as HTMLTextAreaElement;
    const preview = screen.getByTestId("split-preview");

    Object.defineProperty(source, "scrollHeight", { configurable: true, value: 300 });
    Object.defineProperty(source, "clientHeight", { configurable: true, value: 100 });
    Object.defineProperty(preview, "scrollHeight", { configurable: true, value: 500 });
    Object.defineProperty(preview, "clientHeight", { configurable: true, value: 100 });

    source.scrollTop = 100;
    fireEvent.scroll(source);

    expect(preview.scrollTop).toBe(200);
  });

  it("keeps the active textarea line near the middle in typewriter mode", () => {
    render(<ControlledEditor typewriterMode />);

    const editor = screen.getByLabelText("Markdown 源码编辑器") as HTMLTextAreaElement;
    Object.defineProperty(editor, "clientHeight", { configurable: true, value: 44 });

    editor.setSelectionRange(file.raw.length, file.raw.length);
    fireEvent.select(editor);

    expect(editor).toHaveClass("typewriter-textarea");
    expect(editor.scrollTop).toBeGreaterThan(60);
  });

  it("inserts pasted images as markdown attachment links", async () => {
    const onDirtyChange = vi.fn();
    const onAttachmentPaste = vi.fn(async () => "![photo.png](assets/source/photo.png)");
    render(<ControlledEditor onAttachmentPaste={onAttachmentPaste} onDirtyChange={onDirtyChange} />);

    const editor = screen.getByLabelText("Markdown 源码编辑器") as HTMLTextAreaElement;
    editor.setSelectionRange(file.raw.length, file.raw.length);
    const image = new File(["image"], "photo.png", { type: "image/png" });
    fireEvent.paste(editor, { clipboardData: { files: [image] } });

    await waitFor(() => expect(onAttachmentPaste).toHaveBeenCalledWith(image));
    expect(onDirtyChange).toHaveBeenLastCalledWith(true, `${file.raw}\n\n![photo.png](assets/source/photo.png)`);
  });

  it("inserts dragged images as markdown attachment links", async () => {
    const onDirtyChange = vi.fn();
    const onAttachmentPaste = vi.fn(async () => "![drop.png](assets/source/drop.png)");
    render(<ControlledEditor onAttachmentPaste={onAttachmentPaste} onDirtyChange={onDirtyChange} />);

    const editor = screen.getByLabelText("Markdown 源码编辑器") as HTMLTextAreaElement;
    editor.setSelectionRange(file.raw.length, file.raw.length);
    const image = new File(["image"], "drop.png", { type: "image/png" });
    fireEvent.drop(editor, { dataTransfer: { files: [image] } });

    await waitFor(() => expect(onAttachmentPaste).toHaveBeenCalledWith(image));
    expect(onDirtyChange).toHaveBeenLastCalledWith(true, `${file.raw}\n\n![drop.png](assets/source/drop.png)`);
  });

  it("suggests existing notes after typing a wiki link trigger", () => {
    const onDirtyChange = vi.fn();
    render(
      <ControlledEditor
        onDirtyChange={onDirtyChange}
        wikiCandidates={[
          { fileId: "plan", title: "项目规划", fileName: "项目规划.md", path: "文档/项目/项目规划.md" },
          { fileId: "note", title: "随笔", fileName: "随笔.md", path: "日记/随笔.md" },
        ]}
      />,
    );

    const editor = screen.getByLabelText("Markdown 源码编辑器") as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: `${file.raw}\n\n[[项`, selectionStart: file.raw.length + 5 } });

    const suggest = screen.getByRole("listbox", { name: "双链自动补全" });
    fireEvent.click(within(suggest).getByRole("option", { name: /项目规划/ }));

    expect(onDirtyChange).toHaveBeenLastCalledWith(true, `${file.raw}\n\n[[项目规划]]`);
  });

  it("opens wiki links and backlinks from the rendered editor", () => {
    const onOpenWikiLink = vi.fn();
    const onOpenBacklink = vi.fn();
    const linkedFile: MarkdownFile = { ...file, raw: "# 今日\n\n参考 [[项目规划]]" };

    render(
      <ControlledEditor
        initialFile={linkedFile}
        onOpenBacklink={onOpenBacklink}
        onOpenWikiLink={onOpenWikiLink}
        wikiBacklinks={[
          {
            fileId: "note",
            name: "随笔.md",
            relativePath: "日记/随笔.md",
            snippet: "包含 [[今日]]",
            highlightedSnippet: "包含 <mark>[[今日]]</mark>",
            tags: [],
            score: 1,
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "双视图" }));
    fireEvent.click(within(screen.getByTestId("editor-split")).getByRole("link", { name: "项目规划" }));
    fireEvent.click(within(screen.getByRole("navigation", { name: "反向链接" })).getByRole("button", { name: /随笔/ }));

    expect(onOpenWikiLink).toHaveBeenCalledWith("项目规划");
    expect(onOpenBacklink).toHaveBeenCalledWith("note");
  });
});

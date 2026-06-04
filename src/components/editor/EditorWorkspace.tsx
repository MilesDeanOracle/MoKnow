import { useEffect, useMemo, useState } from "react";
import type { EditorMode, MarkdownFile } from "../../types/models";
import type { MarkdownService } from "../../services/markdownService";

interface EditorWorkspaceProps {
  file: MarkdownFile;
  markdownService: MarkdownService;
  onDirtyChange: (dirty: boolean, content: string) => void;
}

const modeLabels: Record<EditorMode, string> = {
  source: "代码模式",
  split: "双视图模式",
  wysiwyg: "所见即所得",
};

export function EditorWorkspace({ file, markdownService, onDirtyChange }: EditorWorkspaceProps) {
  const [mode, setMode] = useState<EditorMode>("source");
  const [content, setContent] = useState(file.raw);

  useEffect(() => {
    setContent(file.raw);
    onDirtyChange(false, file.raw);
  }, [file, onDirtyChange]);

  const rendered = useMemo(() => markdownService.render(content), [content, markdownService]);
  const highlighted = useMemo(() => markdownService.highlightSource(content), [content, markdownService]);
  const lines = useMemo(() => content.split("\n"), [content]);

  const updateContent = (nextContent: string) => {
    setContent(nextContent);
    onDirtyChange(true, nextContent);
  };

  return (
    <section className="main">
      <div className="editor-toolbar">
        <div className="editor-mode-switch" role="tablist" aria-label="编辑模式">
          <button className={`mode-btn ${mode === "source" ? "active" : ""}`} type="button" onClick={() => setMode("source")}>
            代码
          </button>
          <button className={`mode-btn ${mode === "split" ? "active" : ""}`} type="button" onClick={() => setMode("split")}>
            双视图
          </button>
          <button className={`mode-btn ${mode === "wysiwyg" ? "active" : ""}`} type="button" onClick={() => setMode("wysiwyg")}>
            所见即所得
          </button>
        </div>

        <div className="toolbar-divider" />
        <div className="toolbar-actions" aria-label="Markdown 工具栏">
          <button className="toolbar-btn bold" type="button">B</button>
          <button className="toolbar-btn italic" type="button">I</button>
          <button className="toolbar-btn" type="button">H</button>
          <button className="toolbar-btn code" type="button">&lt;/&gt;</button>
          <button className="toolbar-btn" type="button">⌘</button>
          <button className="toolbar-btn" type="button">⊞</button>
          <button className="toolbar-btn" type="button">⊟</button>
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

      <div className="editor-area">
        <div className={`source-editor ${mode !== "source" ? "hidden" : ""}`} id="editorSource" data-testid="editor-source" hidden={mode !== "source"}>
          <div className="line-numbers">
            {lines.map((_, index) => (
              <span key={`line-${index + 1}`} className={index === 11 ? "active" : ""}>{index + 1}</span>
            ))}
          </div>
          <div
            className="code-content"
            contentEditable
            suppressContentEditableWarning
            spellCheck={false}
            dangerouslySetInnerHTML={{ __html: highlighted }}
            onInput={(event) => updateContent(event.currentTarget.innerText)}
          />
        </div>

        <div className={`split-editor ${mode !== "split" ? "hidden" : ""}`} id="editorSplit" data-testid="editor-split" hidden={mode !== "split"}>
          <div className="split-left">
            <div
              className="code-content"
              contentEditable
              suppressContentEditableWarning
              spellCheck={false}
              dangerouslySetInnerHTML={{ __html: highlighted }}
              onInput={(event) => updateContent(event.currentTarget.innerText)}
            />
          </div>
          <div className="split-right">
            <article className="md-render" dangerouslySetInnerHTML={{ __html: rendered }} />
          </div>
        </div>

        <div className={`wysiwyg-shell ${mode !== "wysiwyg" ? "hidden" : ""}`} id="editorWysiwyg" data-testid="editor-wysiwyg" hidden={mode !== "wysiwyg"}>
          <article
            className="wysiwyg-editor md-render"
            contentEditable
            suppressContentEditableWarning
            dangerouslySetInnerHTML={{ __html: rendered }}
            onInput={(event) => updateContent(event.currentTarget.innerText)}
          />
        </div>
      </div>
    </section>
  );
}

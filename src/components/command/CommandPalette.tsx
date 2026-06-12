import type { SearchResult } from "../../types/models";

export interface PaletteCommand {
  id: string;
  label: string;
  category: string;
  shortcut?: string;
  action: () => void;
}

interface CommandPaletteProps {
  commands: PaletteCommand[];
  fileResults: SearchResult[];
  loading: boolean;
  mode: "files" | "commands";
  open: boolean;
  query: string;
  onClose: () => void;
  onOpenFile: (fileId: string) => void;
  onQueryChange: (query: string) => void;
  onSwitchMode: (mode: "files" | "commands") => void;
}

export function CommandPalette({
  commands,
  fileResults,
  loading,
  mode,
  open,
  query,
  onClose,
  onOpenFile,
  onQueryChange,
  onSwitchMode,
}: CommandPaletteProps) {
  if (!open) return null;

  const filteredCommands = commands.filter((command) => {
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return `${command.label} ${command.category} ${command.shortcut ?? ""}`.toLowerCase().includes(needle);
  });

  const runFirst = () => {
    if (mode === "commands") {
      filteredCommands[0]?.action();
    } else {
      const firstFile = fileResults[0];
      if (firstFile) onOpenFile(firstFile.fileId);
    }
  };

  return (
    <div className="command-palette-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="command-palette" role="dialog" aria-label={mode === "commands" ? "命令面板" : "快速打开文件"} onMouseDown={(event) => event.stopPropagation()}>
        <div className="command-palette-tabs" role="tablist" aria-label="命令面板模式">
          <button type="button" className={mode === "files" ? "active" : ""} onClick={() => onSwitchMode("files")}>文件</button>
          <button type="button" className={mode === "commands" ? "active" : ""} onClick={() => onSwitchMode("commands")}>命令</button>
        </div>

        <input
          aria-label="命令面板搜索"
          autoFocus
          value={query}
          placeholder={mode === "commands" ? "搜索命令..." : "搜索并打开 Markdown..."}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") onClose();
            if (event.key === "Enter") runFirst();
          }}
        />

        <div className="command-palette-results">
          {mode === "commands" ? (
            filteredCommands.length ? filteredCommands.map((command) => (
              <button key={command.id} type="button" aria-label={`执行命令 ${command.label}`} onClick={command.action}>
                <span className="command-label">{command.label}</span>
                <span className="command-meta">{command.category}{command.shortcut ? ` · ${command.shortcut}` : ""}</span>
              </button>
            )) : <span className="command-empty">没有匹配命令</span>
          ) : loading ? (
            <span className="command-empty">正在搜索文件...</span>
          ) : fileResults.length ? fileResults.map((file) => (
            <button key={file.fileId} type="button" aria-label={`快速打开 ${file.name}`} onClick={() => onOpenFile(file.fileId)}>
              <span className="command-label">{file.name}</span>
              <span className="command-meta">{file.relativePath}</span>
            </button>
          )) : <span className="command-empty">没有匹配文件</span>}
        </div>
      </section>
    </div>
  );
}

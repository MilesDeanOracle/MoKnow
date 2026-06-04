interface StatusBarProps {
  modeLabel: string;
  repositoryName: string;
  wordCount: number;
  dirty: boolean;
}

export function StatusBar({ modeLabel, repositoryName, wordCount, dirty }: StatusBarProps) {
  return (
    <footer className="statusbar">
      <div className="status-item">
        <div className="si-dot" />
        <span>{modeLabel}</span>
      </div>
      <div className="status-item">📁 {repositoryName}</div>
      <div className="status-item">字数: {wordCount}</div>
      <div className="status-spacer" />
      <div className="status-item status-saved">● {dirty ? "已修改" : "已保存"}</div>
      <div className="status-item">UTF-8</div>
      <div className="status-item">Markdown</div>
      <div className="status-item">Ln 12, Col 8</div>
    </footer>
  );
}

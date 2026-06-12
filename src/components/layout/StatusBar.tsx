interface StatusBarProps {
  modeLabel: string;
  repositoryName: string;
  wordCount: number;
  dirty: boolean;
  saveStatus: "saved" | "dirty" | "saving" | "failed" | "conflict";
}

const saveStatusLabels: Record<StatusBarProps["saveStatus"], string> = {
  saved: "已保存",
  dirty: "有未保存更改",
  saving: "正在保存",
  failed: "保存失败",
  conflict: "外部修改冲突",
};

export function StatusBar({ modeLabel, repositoryName, wordCount, dirty, saveStatus }: StatusBarProps) {
  const visibleStatus = dirty && saveStatus === "saved" ? "dirty" : saveStatus;

  return (
    <footer className="statusbar">
      <div className="status-item">
        <div className="si-dot" />
        <span>{modeLabel}</span>
      </div>
      <div className="status-item">📁 {repositoryName}</div>
      <div className="status-item">字数: {wordCount}</div>
      <div className="status-spacer" />
      <div className={`status-item status-saved status-${visibleStatus}`}>● {saveStatusLabels[visibleStatus]}</div>
      <div className="status-item">UTF-8</div>
      <div className="status-item">Markdown</div>
      <div className="status-item">Ln 12, Col 8</div>
    </footer>
  );
}

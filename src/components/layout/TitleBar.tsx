import type { ThemeName } from "../../types/models";

interface TitleBarProps {
  dirty: boolean;
  focusMode: boolean;
  fullscreenWriting: boolean;
  lockEnabled: boolean;
  themeName: ThemeName;
  typewriterMode: boolean;
  onNotify: (message: string) => void;
  onBackupRepository: () => void;
  onExportHtml: () => void;
  onExportPdf: () => void;
  onExportJournalCollection: () => void;
  onRestoreBackup: () => void;
  onOpenCommandPalette: () => void;
  onOpenLockSettings: () => void;
  onOpenQuickOpen: () => void;
  onOpenPluginManager: () => void;
  onOpenSettings: () => void;
  onLockNow: () => void;
  onToggleFullscreenWriting: () => void;
  onToggleFocusMode: () => void;
  onToggleTheme: () => void;
  onToggleTypewriterMode: () => void;
}

export function TitleBar({
  dirty,
  focusMode,
  fullscreenWriting,
  lockEnabled,
  themeName,
  typewriterMode,
  onNotify,
  onBackupRepository,
  onExportHtml,
  onExportPdf,
  onExportJournalCollection,
  onRestoreBackup,
  onLockNow,
  onOpenCommandPalette,
  onOpenLockSettings,
  onOpenQuickOpen,
  onOpenPluginManager,
  onOpenSettings,
  onToggleFullscreenWriting,
  onToggleFocusMode,
  onToggleTheme,
  onToggleTypewriterMode,
}: TitleBarProps) {
  const nextThemeLabel = themeName === "night" ? "白天" : "黑夜";

  return (
    <header className="titlebar">
      <div className="titlebar-logo">
        <span className="logo-icon">M</span>
        MoKnow
      </div>

      <nav className="titlebar-tabs" aria-label="打开的文件">
        <button className={`tab active ${dirty ? "modified" : ""}`} type="button">
          <span className="tab-icon">📄</span>
          <span className="tab-name">2024-06-04-日记.md</span>
          <span className="tab-close">×</span>
        </button>
        <button className="tab" type="button">
          <span className="tab-icon">📄</span>
          <span className="tab-name">项目规划.md</span>
          <span className="tab-close">×</span>
        </button>
        <button className="tab" type="button">
          <span className="tab-icon">📄</span>
          <span className="tab-name">README.md</span>
          <span className="tab-close">×</span>
        </button>
      </nav>

      <div className="titlebar-actions">
        <button className="icon-btn" type="button" title="快速打开 Ctrl+P" aria-label="快速打开文件" onClick={onOpenQuickOpen}>⌕</button>
        <button className="icon-btn" type="button" title="命令面板 Ctrl+Shift+P" aria-label="命令面板" onClick={onOpenCommandPalette}>⊞</button>
        <button className="icon-btn" type="button" title="备份仓库" aria-label="备份仓库" onClick={onBackupRepository}>⇩</button>
        <button className="icon-btn" type="button" title="恢复最近备份" aria-label="恢复最近备份" onClick={onRestoreBackup}>⇧</button>
        <button className="icon-btn" type="button" title="导出 HTML" aria-label="导出 HTML" onClick={onExportHtml}>⇱</button>
        <button className="icon-btn" type="button" title="导出 PDF" aria-label="导出 PDF" onClick={onExportPdf}>PDF</button>
        <button className="icon-btn" type="button" title="导出日记合集" aria-label="导出日记合集" onClick={onExportJournalCollection}>⇲</button>
        <button
          className={`icon-btn ${lockEnabled ? "active" : ""}`}
          type="button"
          title={lockEnabled ? "立即锁定" : "应用锁设置"}
          aria-label={lockEnabled ? "立即锁定" : "应用锁设置"}
          aria-pressed={lockEnabled}
          onClick={lockEnabled ? onLockNow : onOpenLockSettings}
        >
          锁
        </button>
        <button
          className={`icon-btn ${focusMode ? "active" : ""}`}
          type="button"
          title={focusMode ? "退出专注写作" : "进入专注写作"}
          aria-label={focusMode ? "退出专注写作" : "进入专注写作"}
          aria-pressed={focusMode}
          onClick={onToggleFocusMode}
        >
          ◱
        </button>
        <button
          className={`icon-btn ${typewriterMode ? "active" : ""}`}
          type="button"
          title={typewriterMode ? "关闭打字机模式" : "开启打字机模式"}
          aria-label={typewriterMode ? "关闭打字机模式" : "开启打字机模式"}
          aria-pressed={typewriterMode}
          onClick={onToggleTypewriterMode}
        >
          ⌶
        </button>
        <button
          className={`icon-btn ${fullscreenWriting ? "active" : ""}`}
          type="button"
          title={fullscreenWriting ? "退出全屏写作" : "进入全屏写作"}
          aria-label={fullscreenWriting ? "退出全屏写作" : "进入全屏写作"}
          aria-pressed={fullscreenWriting}
          onClick={onToggleFullscreenWriting}
        >
          ⛶
        </button>
        <button className="icon-btn active" type="button" title="AI Cockpit" onClick={() => onNotify("AI Cockpit 已打开")}>✦</button>
        <button className="icon-btn theme-toggle-btn" type="button" title={`切换到${nextThemeLabel}主题`} aria-label={`切换到${nextThemeLabel}主题`} onClick={onToggleTheme}>
          {themeName === "night" ? "☀" : "☾"}
        </button>
        <button className="icon-btn" type="button" title="插件管理" aria-label="插件管理" onClick={onOpenPluginManager}>⊕</button>
        <button className="icon-btn" type="button" title="设置" aria-label="设置" onClick={onOpenSettings}>⚙</button>
      </div>
    </header>
  );
}

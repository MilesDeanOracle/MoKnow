import type { ThemeName } from "../../types/models";

interface TitleBarProps {
  dirty: boolean;
  themeName: ThemeName;
  onNotify: (message: string) => void;
  onToggleTheme: () => void;
}

export function TitleBar({ dirty, themeName, onNotify, onToggleTheme }: TitleBarProps) {
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
        <button className="icon-btn" type="button" title="全局搜索 Ctrl+Shift+F" onClick={() => onNotify("全局搜索功能")}>⌕</button>
        <button className="icon-btn" type="button" title="命令面板 Ctrl+P" onClick={() => onNotify("命令面板")}>⊞</button>
        <button className="icon-btn active" type="button" title="AI Cockpit" onClick={() => onNotify("AI Cockpit 已打开")}>✦</button>
        <button className="icon-btn theme-toggle-btn" type="button" title={`切换到${nextThemeLabel}主题`} aria-label={`切换到${nextThemeLabel}主题`} onClick={onToggleTheme}>
          {themeName === "night" ? "☀" : "☾"}
        </button>
        <button className="icon-btn" type="button" title="插件管理" onClick={() => onNotify("插件管理器")}>⊕</button>
        <button className="icon-btn" type="button" title="设置" onClick={() => onNotify("设置面板")}>⚙</button>
      </div>
    </header>
  );
}

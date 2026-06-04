import { theme as antdTheme } from "antd";
import type { ThemeConfig as AntdThemeConfig } from "antd";
import type { AppThemeConfig, ThemeBuildResult, ThemeName } from "../types/models";

const themePresets: Record<ThemeName, AppThemeConfig> = {
  day: {
    mode: "light",
    primaryColor: "#1677ff",
    compact: false,
    borderRadius: 6,
    fontSize: 13,
  },
  night: {
    mode: "dark",
    primaryColor: "#4f8ef7",
    compact: false,
    borderRadius: 6,
    fontSize: 13,
  },
};

/**
 * 设计模式：工厂模式。
 * 原因：主题配置需要由业务配置转换为 Ant Design ConfigProvider 所需对象，
 * 集中生成可避免各组件重复拼装 token 和 css 变量。
 */
export class ThemeService {
  getPreset(name: ThemeName): AppThemeConfig {
    return themePresets[name];
  }

  createAntdTheme(config: AppThemeConfig): AntdThemeConfig {
    const algorithms = [config.mode === "light" ? antdTheme.defaultAlgorithm : antdTheme.darkAlgorithm];

    if (config.compact) {
      algorithms.push(antdTheme.compactAlgorithm);
    }

    return {
      algorithm: algorithms,
      cssVar: { prefix: "moknow" },
      token: {
        colorPrimary: config.primaryColor,
        borderRadius: config.borderRadius,
        fontSize: config.fontSize,
        colorBgBase: config.mode === "light" ? "#f6f8fb" : "#0f1117",
        colorBgContainer: config.mode === "light" ? "#ffffff" : "#161b27",
        colorBorder: config.mode === "light" ? "#d9dee8" : "#2a3348",
      },
    };
  }

  build(config: AppThemeConfig): ThemeBuildResult {
    const isLight = config.mode === "light";

    return {
      antdTheme: this.createAntdTheme(config),
      cssVars: {
        "--accent": config.primaryColor,
        "--accent-glow": isLight ? "rgba(22, 119, 255, 0.14)" : "rgba(79, 142, 247, 0.15)",
        "--accent-dim": isLight ? "rgba(22, 119, 255, 0.08)" : "rgba(79, 142, 247, 0.08)",
        "--bg-base": isLight ? "#f5f7fb" : "#0f1117",
        "--bg-surface": isLight ? "#ffffff" : "#161b27",
        "--bg-elevated": isLight ? "#edf2f8" : "#1e2535",
        "--bg-hover": isLight ? "#e2eaf5" : "#242c3d",
        "--bg-active": isLight ? "#d8e5f5" : "#2a3348",
        "--border": isLight ? "#d7deea" : "#2a3348",
        "--border-light": isLight ? "#e8edf5" : "#1e2535",
        "--text-primary": isLight ? "#182033" : "#e8eaf0",
        "--text-secondary": isLight ? "#4e5c72" : "#8892a4",
        "--text-muted": isLight ? "#8b98aa" : "#4e5a6e",
        "--text-accent": isLight ? "#0958d9" : "#64b5f6",
        "--shadow": isLight ? "0 4px 18px rgba(15, 23, 42, 0.12)" : "0 4px 24px rgba(0, 0, 0, 0.4)",
        "--md-heading": isLight ? "#111827" : "#e8eaf0",
        "--md-heading-soft": isLight ? "#243047" : "#dce0f0",
        "--md-code": isLight ? "#b54708" : "#f5a97f",
        "--md-strong": isLight ? "#ad6800" : "#f0c060",
        "--md-em": isLight ? "#237804" : "#8fd4a8",
        "--radius": `${config.borderRadius}px`,
      },
    };
  }
}

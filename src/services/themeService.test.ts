import { describe, expect, it } from "vitest";
import { ThemeService } from "./themeService";

describe("ThemeService", () => {
  it("maps the prototype dark theme to Ant Design tokens and css variables", () => {
    const service = new ThemeService();

    const theme = service.createAntdTheme({
      mode: "dark",
      primaryColor: "#4f8ef7",
      compact: false,
      borderRadius: 6,
      fontSize: 13,
    });

    expect(theme.token?.colorPrimary).toBe("#4f8ef7");
    expect(theme.token?.borderRadius).toBe(6);
    expect(theme.cssVar).toEqual({ prefix: "moknow" });
  });

  it("provides day and night theme presets", () => {
    const service = new ThemeService();

    const dayTheme = service.getPreset("day");
    const nightTheme = service.getPreset("night");

    expect(dayTheme.mode).toBe("light");
    expect(dayTheme.primaryColor).toBe("#1677ff");
    expect(nightTheme.mode).toBe("dark");
    expect(nightTheme.primaryColor).toBe("#4f8ef7");
  });

  it("builds different css variables for day and night themes", () => {
    const service = new ThemeService();

    const day = service.build(service.getPreset("day"));
    const night = service.build(service.getPreset("night"));

    expect(day.cssVars["--bg-base"]).toBe("#f5f7fb");
    expect(day.cssVars["--text-primary"]).toBe("#182033");
    expect(night.cssVars["--bg-base"]).toBe("#0f1117");
    expect(night.cssVars["--text-primary"]).toBe("#e8eaf0");
  });

  it("resolves enabled plugin themes from user settings", () => {
    const service = new ThemeService();

    const resolved = service.resolvePreference({
      themePreference: "plugin:moknow.theme-pack:mint",
      customTheme: service.getPreset("night"),
      customCss: "",
    }, true, [
      {
        id: "mint",
        key: "moknow.theme-pack:mint",
        title: "薄荷主题",
        pluginId: "moknow.theme-pack",
        pluginName: "主题包",
        theme: {
          mode: "light",
          primaryColor: "#20b486",
          compact: true,
          borderRadius: 8,
          fontSize: 14,
        },
      },
    ]);
    const theme = service.build(resolved.config);

    expect(resolved.name).toBe("day");
    expect(theme.antdTheme.token?.colorPrimary).toBe("#20b486");
    expect(theme.cssVars["--accent"]).toBe("#20b486");
  });
});

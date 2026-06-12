import { afterEach, describe, expect, it } from "vitest";
import {
  APP_SETTINGS_STORAGE_KEY,
  exportUserSettings,
  importUserSettings,
  loadUserSettings,
  normalizeUserSettings,
  resolveScopedUserSettings,
  saveUserSettings,
} from "./appSettingsService";

describe("appSettingsService", () => {
  afterEach(() => {
    window.localStorage.removeItem(APP_SETTINGS_STORAGE_KEY);
  });

  it("normalizes legacy settings and preserves custom css", () => {
    const settings = normalizeUserSettings({
      themePreference: "custom",
      customTheme: {
        mode: "light",
        primaryColor: "#56d98e",
        compact: true,
        borderRadius: 999,
        fontSize: 3,
      },
      customCss: ".app-root { --accent: #ff00aa; }",
    });

    expect(settings.customTheme.borderRadius).toBe(16);
    expect(settings.customTheme.fontSize).toBe(12);
    expect(settings.customCss).toContain("--accent");
  });

  it("exports and imports settings json", () => {
    const exported = exportUserSettings({
      themePreference: "custom",
      customTheme: {
        mode: "dark",
        primaryColor: "#123456",
        compact: false,
        borderRadius: 8,
        fontSize: 15,
      },
      customCss: ".md-render { line-height: 1.8; }",
    });

    const imported = importUserSettings(exported);

    expect(imported.themePreference).toBe("custom");
    expect(imported.customTheme.primaryColor).toBe("#123456");
    expect(imported.customCss).toContain("line-height");
  });

  it("loads saved settings from localStorage", () => {
    saveUserSettings({
      themePreference: "custom",
      customTheme: {
        mode: "light",
        primaryColor: "#abcdef",
        compact: true,
        borderRadius: 10,
        fontSize: 14,
      },
      customCss: ".titlebar { display: none; }",
    });

    const loaded = loadUserSettings();

    expect(loaded.themePreference).toBe("custom");
    expect(loaded.customTheme.compact).toBe(true);
    expect(loaded.customCss).toContain(".titlebar");
  });

  it("resolves repository and file scoped settings over global settings", () => {
    const settings = normalizeUserSettings({
      themePreference: "night",
      customCss: ".global { color: red; }",
      repositorySettings: {
        "repo-1": {
          themePreference: "day",
          customCss: ".repo { color: blue; }",
        },
      },
      fileSettings: {
        "file-1": {
          themePreference: "plugin:moknow.theme:mint",
          customCss: ".file { color: green; }",
        },
      },
    });

    const scoped = resolveScopedUserSettings(settings, "repo-1", "file-1");

    expect(scoped.themePreference).toBe("plugin:moknow.theme:mint");
    expect(scoped.customCss).toContain(".global");
    expect(scoped.customCss).toContain(".repo");
    expect(scoped.customCss).toContain(".file");
  });
});

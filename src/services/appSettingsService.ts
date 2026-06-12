import type { ScopedThemePreference, ScopedUserSettings, ThemePreference, UserSettings } from "../types/models";

export const APP_SETTINGS_STORAGE_KEY = "moknow:user-settings";

export const defaultUserSettings: UserSettings = {
  themePreference: "night",
  customTheme: {
    mode: "dark",
    primaryColor: "#4f8ef7",
    compact: false,
    borderRadius: 6,
    fontSize: 13,
  },
  customCss: "",
  repositorySettings: {},
  fileSettings: {},
};

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "day"
    || value === "night"
    || value === "system"
    || value === "custom"
    || (typeof value === "string" && value.startsWith("plugin:") && value.length > "plugin:".length);
}

function normalizeThemePreference(value: unknown, fallback: ThemePreference): ThemePreference {
  return isThemePreference(value) ? value : fallback;
}

function normalizeScopedThemePreference(value: unknown): ScopedThemePreference | undefined {
  if (value === "inherit") return "inherit";
  return isThemePreference(value) ? value : undefined;
}

function normalizeScopedSettingsMap(value: unknown): Record<string, ScopedUserSettings> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const entries = Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => {
    if (!key || !item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Partial<ScopedUserSettings>;
    const themePreference = normalizeScopedThemePreference(record.themePreference);
    const customCss = typeof record.customCss === "string" ? record.customCss : "";
    if (!themePreference && !customCss.trim()) return [];
    return [[key, {
      ...(themePreference ? { themePreference } : {}),
      ...(customCss ? { customCss } : {}),
    } satisfies ScopedUserSettings]];
  });
  return Object.fromEntries(entries);
}

export function normalizeUserSettings(settings: Partial<UserSettings>): UserSettings {
  const customTheme = settings.customTheme ?? defaultUserSettings.customTheme;
  return {
    themePreference: normalizeThemePreference(settings.themePreference, defaultUserSettings.themePreference),
    customTheme: {
      mode: customTheme.mode ?? defaultUserSettings.customTheme.mode,
      primaryColor: customTheme.primaryColor || defaultUserSettings.customTheme.primaryColor,
      compact: Boolean(customTheme.compact),
      borderRadius: Number.isFinite(customTheme.borderRadius) ? Math.min(Math.max(customTheme.borderRadius, 2), 16) : defaultUserSettings.customTheme.borderRadius,
      fontSize: Number.isFinite(customTheme.fontSize) ? Math.min(Math.max(customTheme.fontSize, 12), 18) : defaultUserSettings.customTheme.fontSize,
    },
    customCss: typeof settings.customCss === "string" ? settings.customCss : defaultUserSettings.customCss,
    repositorySettings: normalizeScopedSettingsMap(settings.repositorySettings),
    fileSettings: normalizeScopedSettingsMap(settings.fileSettings),
  };
}

export function resolveScopedUserSettings(settings: UserSettings, repositoryId?: string, fileId?: string): UserSettings {
  const normalized = normalizeUserSettings(settings);
  const repositorySettings = repositoryId ? normalized.repositorySettings?.[repositoryId] : undefined;
  const fileSettings = fileId ? normalized.fileSettings?.[fileId] : undefined;
  const scopedThemePreference = fileSettings?.themePreference && fileSettings.themePreference !== "inherit"
    ? fileSettings.themePreference
    : repositorySettings?.themePreference && repositorySettings.themePreference !== "inherit"
      ? repositorySettings.themePreference
      : undefined;

  return {
    ...normalized,
    themePreference: scopedThemePreference ?? normalized.themePreference,
    customCss: [
      normalized.customCss,
      repositorySettings?.customCss,
      fileSettings?.customCss,
    ].filter(Boolean).join("\n"),
  };
}

export function exportUserSettings(settings: UserSettings): string {
  return JSON.stringify(normalizeUserSettings(settings), null, 2);
}

export function importUserSettings(json: string): UserSettings {
  const parsed = JSON.parse(json) as Partial<UserSettings>;
  return normalizeUserSettings(parsed);
}

export function loadUserSettings(): UserSettings {
  try {
    const raw = window.localStorage.getItem(APP_SETTINGS_STORAGE_KEY);
    if (!raw) return defaultUserSettings;
    return normalizeUserSettings(JSON.parse(raw) as Partial<UserSettings>);
  } catch {
    return defaultUserSettings;
  }
}

export function saveUserSettings(settings: UserSettings) {
  const normalized = normalizeUserSettings(settings);
  window.localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export interface AppUpdateAvailableResult {
  status: "available";
  version: string;
  date?: string;
  body?: string;
  install: () => Promise<void>;
}

export interface AppUpdateUnavailableResult {
  status: "none" | "unsupported";
  message: string;
}

export type AppUpdateCheckResult = AppUpdateAvailableResult | AppUpdateUnavailableResult;

interface TauriUpdate {
  version: string;
  date?: string;
  body?: string;
  downloadAndInstall: () => Promise<void>;
}

interface TauriUpdaterModule {
  check: () => Promise<TauriUpdate | null>;
}

type UpdaterLoader = () => Promise<TauriUpdaterModule>;
type RuntimeDetector = () => boolean;

const unsupportedMessage = "当前环境不支持自动更新，请在 Tauri 桌面应用中检查更新。";

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function loadTauriUpdater(): Promise<TauriUpdaterModule> {
  return import("@tauri-apps/plugin-updater");
}

/**
 * 设计模式：适配器模式。
 * 原因：Tauri updater 只能在桌面运行时工作，服务层把动态 import、
 * 运行时判断和 UI 友好的结果结构集中起来，组件不需要关心插件细节。
 */
export class AppUpdateService {
  constructor(
    private readonly loadUpdater: UpdaterLoader = loadTauriUpdater,
    private readonly detectRuntime: RuntimeDetector = isTauriRuntime,
  ) {}

  async checkForUpdate(): Promise<AppUpdateCheckResult> {
    if (!this.detectRuntime()) {
      return {
        status: "unsupported",
        message: unsupportedMessage,
      };
    }

    const updater = await this.loadUpdater();
    const update = await updater.check();
    if (!update) {
      return {
        status: "none",
        message: "当前已经是最新版本。",
      };
    }

    return {
      status: "available",
      version: update.version,
      date: update.date,
      body: update.body,
      install: () => update.downloadAndInstall(),
    };
  }
}


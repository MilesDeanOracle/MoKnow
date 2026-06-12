import { describe, expect, it, vi } from "vitest";
import { AppUpdateService } from "./appUpdateService";

describe("AppUpdateService", () => {
  it("reports unsupported outside the Tauri runtime", async () => {
    const service = new AppUpdateService(
      async () => ({ check: vi.fn() }),
      () => false,
    );

    const result = await service.checkForUpdate();

    expect(result).toEqual({
      status: "unsupported",
      message: "当前环境不支持自动更新，请在 Tauri 桌面应用中检查更新。",
    });
  });

  it("reports when no update is available", async () => {
    const check = vi.fn(async () => null);
    const service = new AppUpdateService(
      async () => ({ check }),
      () => true,
    );

    const result = await service.checkForUpdate();

    expect(check).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      status: "none",
      message: "当前已经是最新版本。",
    });
  });

  it("returns update metadata and installs the update", async () => {
    const downloadAndInstall = vi.fn(async () => undefined);
    const service = new AppUpdateService(
      async () => ({
        check: vi.fn(async () => ({
          version: "0.2.0",
          date: "2026-06-09T00:00:00.000Z",
          body: "修复发布流程",
          downloadAndInstall,
        })),
      }),
      () => true,
    );

    const result = await service.checkForUpdate();

    expect(result.status).toBe("available");
    if (result.status === "available") {
      expect(result.version).toBe("0.2.0");
      expect(result.body).toBe("修复发布流程");
      await result.install();
    }
    expect(downloadAndInstall).toHaveBeenCalledTimes(1);
  });
});


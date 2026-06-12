import { afterEach, describe, expect, it, vi } from "vitest";
import { PLUGIN_REGISTRY_STORAGE_KEY, PluginService, createPluginSandboxScript, getPluginPermissionLabel } from "./pluginService";

describe("PluginService", () => {
  afterEach(() => {
    window.localStorage.removeItem(PLUGIN_REGISTRY_STORAGE_KEY);
    vi.restoreAllMocks();
  });

  it("installs and persists a valid plugin manifest", () => {
    const service = new PluginService();

    const registry = service.installManifest(JSON.stringify({
      id: "moknow.example",
      name: "示例插件",
      version: "0.1.0",
      description: "用于验证插件注册表",
      permissions: ["command", "sidebar", "command"],
      contributes: {
        commands: [{ id: "hello", title: "问候命令", category: "示例" }],
        sidebars: [{ id: "panel", title: "示例面板" }],
      },
    }));

    expect(registry).toHaveLength(1);
    expect(registry[0].status).toBe("disabled");
    expect(registry[0].manifest.permissions).toEqual(["command", "sidebar"]);
    expect(service.loadRegistry()[0].manifest.name).toBe("示例插件");
  });

  it("installs bundled official plugins from the catalog", () => {
    const service = new PluginService();
    const catalog = service.getOfficialPluginCatalog();

    expect(catalog.map((item) => item.manifest.id)).toEqual(expect.arrayContaining([
      "moknow.official.calendar",
      "moknow.official.word-count",
      "moknow.official.export-pdf",
      "moknow.official.git-sync",
    ]));

    const registry = service.installOfficialPlugin("moknow.official.word-count");

    expect(registry[0].manifest.name).toBe("官方字数统计");
    expect(registry[0].manifest.contributes?.aiTools).toEqual(["keyword"]);
    expect(service.loadRegistry()[0].manifest.id).toBe("moknow.official.word-count");
  });

  it("rejects unknown official plugin ids", () => {
    const service = new PluginService();

    expect(() => service.installOfficialPlugin("moknow.official.missing")).toThrow("未知官方插件");
  });

  it("guards PluginContext APIs with declared permissions", () => {
    const service = new PluginService();
    const manifest = service.parseManifest({
      id: "moknow.command-only",
      name: "命令插件",
      version: "1.0.0",
      permissions: ["command"],
    });

    const context = service.createContext(manifest);

    expect(context.hasPermission("command")).toBe(true);
    expect(context.hasPermission("ai")).toBe(false);
    expect(() => context.registerCommand({ id: "save", title: "保存" })).not.toThrow();
    expect(() => context.registerAiTool("summary")).toThrow("未声明权限");
    expect(getPluginPermissionLabel("markdown_render")).toBe("Markdown 渲染扩展");
  });

  it("marks failed plugin activation without throwing to the host app", () => {
    const service = new PluginService();
    const registry = service.installManifest({
      id: "moknow.broken",
      name: "故障插件",
      version: "0.1.0",
      permissions: ["command"],
    });

    const nextRegistry = service.activatePlugin(registry[0], () => {
      throw new Error("入口文件加载失败");
    }, registry);

    expect(nextRegistry[0].status).toBe("failed");
    expect(nextRegistry[0].error).toBe("入口文件加载失败");
    expect(service.loadRegistry()[0].status).toBe("failed");
  });

  it("activates third-party entry code through the sandbox and stores registered contributions", async () => {
    const service = new PluginService();
    const registry = service.installManifest({
      id: "moknow.third-party",
      name: "第三方入口插件",
      version: "0.1.0",
      entry: "globalThis.activate = (moknow) => moknow.registerCommand({ id: 'hello', title: '问候命令' });",
      permissions: ["command"],
    });
    const workerFactory = () => {
      const worker = {
        onmessage: null as ((event: MessageEvent) => void) | null,
        onerror: null as ((event: ErrorEvent) => void) | null,
        postMessage: () => {
          worker.onmessage?.({
            data: {
              type: "register",
              contribution: { type: "command", payload: { id: "hello", title: "问候命令" } },
            },
          } as MessageEvent);
          worker.onmessage?.({ data: { type: "done" } } as MessageEvent);
        },
        terminate: vi.fn(),
      };
      return worker;
    };

    const nextRegistry = await service.activatePluginInSandbox(registry[0], registry, {
      workerFactory,
    });
    const reactivatedRegistry = await service.activatePluginInSandbox(nextRegistry[0], nextRegistry, {
      workerFactory,
    });

    expect(nextRegistry[0].status).toBe("enabled");
    expect(nextRegistry[0].sandbox?.contributionsRegistered).toBe(1);
    expect(nextRegistry[0].manifest.contributes?.commands).toEqual([{ id: "hello", title: "问候命令" }]);
    expect(reactivatedRegistry[0].manifest.contributes?.commands).toEqual([{ id: "hello", title: "问候命令" }]);
    expect(service.collectRuntimeContributions(nextRegistry).commands[0]).toEqual(expect.objectContaining({
      id: "hello",
      pluginId: "moknow.third-party",
    }));
  });

  it("marks sandbox plugins as failed when they register undeclared contributions", async () => {
    const service = new PluginService();
    const registry = service.installManifest({
      id: "moknow.unsafe-entry",
      name: "越权入口插件",
      version: "0.1.0",
      entry: "globalThis.activate = (moknow) => moknow.registerCommand({ id: 'hello', title: '问候命令' });",
      permissions: ["sidebar"],
    });

    const nextRegistry = await service.activatePluginInSandbox(registry[0], registry, {
      workerFactory: () => {
        const worker = {
          onmessage: null as ((event: MessageEvent) => void) | null,
          onerror: null as ((event: ErrorEvent) => void) | null,
          postMessage: () => {
            worker.onmessage?.({
              data: {
                type: "register",
                contribution: { type: "command", payload: { id: "hello", title: "问候命令" } },
              },
            } as MessageEvent);
          },
          terminate: vi.fn(),
        };
        return worker;
      },
    });

    expect(nextRegistry[0].status).toBe("failed");
    expect(nextRegistry[0].error).toContain("未声明权限：command");
  });

  it("creates a hardened worker script for third-party plugin entries", () => {
    const service = new PluginService();
    const manifest = service.parseManifest({
      id: "moknow.hardened",
      name: "沙箱插件",
      version: "1.0.0",
      entry: "moknow.registerAiTool('summary');",
      permissions: ["ai"],
    });

    const script = createPluginSandboxScript(manifest);

    expect(script).toContain("globalThis.fetch = () => Promise.reject");
    expect(script).toContain("globalThis.document = undefined");
    expect(script).toContain("globalThis.localStorage = undefined");
    expect(script).toContain("registerAiTool");
  });

  it("collects enabled runtime contributions guarded by permissions", () => {
    const service = new PluginService();
    const registry = service.saveRegistry([
      {
        manifest: service.parseManifest({
          id: "moknow.enabled",
          name: "启用插件",
          version: "1.0.0",
          permissions: ["command", "sidebar"],
          contributes: {
            commands: [{ id: "hello", title: "问候命令", category: "示例" }],
            sidebars: [{ id: "panel", title: "示例面板" }],
            themes: ["missing-permission-theme"],
          },
        }),
        status: "enabled",
        installedAt: "2026-06-09T00:00:00.000Z",
      },
      {
        manifest: service.parseManifest({
          id: "moknow.disabled",
          name: "停用插件",
          version: "1.0.0",
          permissions: ["command"],
          contributes: {
            commands: [{ id: "disabled", title: "停用命令" }],
          },
        }),
        status: "disabled",
        installedAt: "2026-06-09T00:00:00.000Z",
      },
    ]);

    const contributions = service.collectRuntimeContributions(registry);

    expect(contributions.commands).toEqual([
      {
        id: "hello",
        title: "问候命令",
        category: "示例",
        pluginId: "moknow.enabled",
        pluginName: "启用插件",
      },
    ]);
    expect(contributions.sidebars).toHaveLength(1);
    expect(contributions.themes).toEqual([]);
  });

  it("collects enabled plugin theme contributions with runtime keys", () => {
    const service = new PluginService();
    const registry = service.saveRegistry([
      {
        manifest: service.parseManifest({
          id: "moknow.theme-pack",
          name: "主题包",
          version: "1.0.0",
          permissions: ["theme"],
          contributes: {
            themes: [
              {
                id: "mint",
                title: "薄荷主题",
                theme: {
                  mode: "light",
                  primaryColor: "#20b486",
                  compact: true,
                  borderRadius: 8,
                  fontSize: 14,
                },
              },
            ],
          },
        }),
        status: "enabled",
        installedAt: "2026-06-09T00:00:00.000Z",
      },
    ]);

    const contributions = service.collectRuntimeContributions(registry);

    expect(contributions.themes).toEqual([
      expect.objectContaining({
        id: "mint",
        key: "moknow.theme-pack:mint",
        title: "薄荷主题",
        pluginId: "moknow.theme-pack",
        pluginName: "主题包",
        theme: expect.objectContaining({ primaryColor: "#20b486" }),
      }),
    ]);
  });

  it("rejects unknown permissions", () => {
    const service = new PluginService();

    expect(() => service.parseManifest({
      id: "moknow.unsafe",
      name: "未知权限插件",
      version: "1.0.0",
      permissions: ["filesystem" as never],
    })).toThrow("未知插件权限");
  });
});

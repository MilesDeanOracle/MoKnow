import type {
  PluginCommandContribution,
  PluginContext,
  PluginManifest,
  PluginPermission,
  PluginRegistryItem,
  PluginSidebarContribution,
  PluginThemeContribution,
} from "../types/models";

export const PLUGIN_REGISTRY_STORAGE_KEY = "moknow:plugin-registry";

const pluginPermissions: PluginPermission[] = [
  "read_repository",
  "write_repository",
  "command",
  "sidebar",
  "markdown_render",
  "ai",
  "theme",
  "network",
];

const permissionLabels: Record<PluginPermission, string> = {
  read_repository: "读取仓库",
  write_repository: "写入仓库",
  command: "注册命令",
  sidebar: "侧边栏面板",
  markdown_render: "Markdown 渲染扩展",
  ai: "AI 工具",
  theme: "主题扩展",
  network: "网络访问",
};

export interface PluginRuntimeContributions {
  commands: Array<PluginCommandContribution & { pluginId: string; pluginName: string }>;
  sidebars: Array<PluginSidebarContribution & { pluginId: string; pluginName: string }>;
  markdownRenderers: Array<{ id: string; pluginId: string; pluginName: string }>;
  aiTools: Array<{ id: string; pluginId: string; pluginName: string }>;
  themes: Array<PluginThemeContribution & { key: string; pluginId: string; pluginName: string }>;
}

type PluginSandboxContribution =
  | { type: "command"; payload: PluginCommandContribution }
  | { type: "sidebar"; payload: PluginSidebarContribution }
  | { type: "markdown"; payload: string }
  | { type: "ai"; payload: string }
  | { type: "theme"; payload: string | PluginThemeContribution };

interface PluginSandboxWorker {
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage: (message: unknown) => void;
  terminate: () => void;
}

export interface PluginSandboxOptions {
  timeoutMs?: number;
  workerFactory?: (script: string) => PluginSandboxWorker;
}

export interface OfficialPluginCatalogItem {
  manifest: PluginManifest;
  category: string;
  bundled: boolean;
}

export const OFFICIAL_PLUGIN_CATALOG: OfficialPluginCatalogItem[] = [
  {
    category: "日历",
    bundled: true,
    manifest: {
      id: "moknow.official.calendar",
      name: "官方日历视图",
      version: "1.0.0",
      description: "在插件侧边栏注册一个日历视图入口，用于承载后续增强日历能力。",
      permissions: ["sidebar"],
      contributes: {
        sidebars: [{ id: "calendar-view", title: "官方日历视图" }],
      },
    },
  },
  {
    category: "写作",
    bundled: true,
    manifest: {
      id: "moknow.official.word-count",
      name: "官方字数统计",
      version: "1.0.0",
      description: "注册字数统计 AI 工具，可基于当前上下文生成关键词和记录概览。",
      permissions: ["ai"],
      contributes: {
        aiTools: ["keyword"],
      },
    },
  },
  {
    category: "导出",
    bundled: true,
    manifest: {
      id: "moknow.official.export-pdf",
      name: "官方导出 PDF",
      version: "1.0.0",
      description: "注册导出 PDF 命令入口，便于从插件命令区触发导出工作流。",
      permissions: ["command"],
      contributes: {
        commands: [{ id: "export-pdf", title: "官方导出 PDF", category: "官方插件" }],
      },
    },
  },
  {
    category: "同步",
    bundled: true,
    manifest: {
      id: "moknow.official.git-sync",
      name: "官方 Git 同步",
      version: "1.0.0",
      description: "注册 Git 同步占位命令，第三方网络与进程能力完成后可接入真实同步。",
      permissions: ["command"],
      contributes: {
        commands: [{ id: "git-sync", title: "官方 Git 同步", category: "官方插件" }],
      },
    },
  },
];

export function getPluginPermissionLabel(permission: PluginPermission): string {
  return permissionLabels[permission];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function assertValidPermission(value: unknown): PluginPermission {
  if (typeof value !== "string" || !pluginPermissions.includes(value as PluginPermission)) {
    throw new Error(`未知插件权限：${String(value)}`);
  }
  return value as PluginPermission;
}

function normalizeCommands(value: unknown): PluginCommandContribution[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((item) => {
    if (!isRecord(item)) throw new Error("插件命令贡献必须是对象");
    const id = normalizeString(item.id);
    const title = normalizeString(item.title);
    if (!id || !title) throw new Error("插件命令贡献必须包含 id 和 title");
    return {
      id,
      title,
      category: normalizeString(item.category),
    };
  });
}

function normalizeSidebars(value: unknown): PluginSidebarContribution[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((item) => {
    if (!isRecord(item)) throw new Error("插件侧边栏贡献必须是对象");
    const id = normalizeString(item.id);
    const title = normalizeString(item.title);
    if (!id || !title) throw new Error("插件侧边栏贡献必须包含 id 和 title");
    return { id, title };
  });
}

function normalizeStringList(value: unknown, label: string): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((item) => {
    const normalized = normalizeString(item);
    if (!normalized) throw new Error(`${label} 必须是非空字符串`);
    return normalized;
  });
}

function normalizeThemeContributions(value: unknown): PluginThemeContribution[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((item) => {
    if (typeof item === "string") {
      const id = normalizeString(item);
      if (!id) throw new Error("主题扩展必须是非空字符串或对象");
      return { id, title: id };
    }

    if (!isRecord(item)) throw new Error("主题扩展必须是非空字符串或对象");
    const id = normalizeString(item.id);
    if (!id) throw new Error("主题扩展必须包含 id");
    const theme = isRecord(item.theme) ? {
      mode: item.theme.mode === "light" || item.theme.mode === "dark" || item.theme.mode === "system" ? item.theme.mode : undefined,
      primaryColor: normalizeString(item.theme.primaryColor),
      compact: typeof item.theme.compact === "boolean" ? item.theme.compact : undefined,
      borderRadius: typeof item.theme.borderRadius === "number" ? item.theme.borderRadius : undefined,
      fontSize: typeof item.theme.fontSize === "number" ? item.theme.fontSize : undefined,
    } satisfies PluginThemeContribution["theme"] : undefined;

    return {
      id,
      title: normalizeString(item.title) ?? id,
      ...(theme ? { theme } : {}),
    };
  });
}

function mergeContributes(
  current: PluginManifest["contributes"] | undefined,
  additions: PluginSandboxContribution[],
): PluginManifest["contributes"] | undefined {
  const next: NonNullable<PluginManifest["contributes"]> = {
    ...(current ?? {}),
    commands: [...(current?.commands ?? [])],
    sidebars: [...(current?.sidebars ?? [])],
    markdownRenderers: [...(current?.markdownRenderers ?? [])],
    aiTools: [...(current?.aiTools ?? [])],
    themes: [...(current?.themes ?? [])],
  };

  for (const contribution of additions) {
    if (contribution.type === "command") next.commands?.push(contribution.payload);
    if (contribution.type === "sidebar") next.sidebars?.push(contribution.payload);
    if (contribution.type === "markdown") next.markdownRenderers?.push(contribution.payload);
    if (contribution.type === "ai") next.aiTools?.push(contribution.payload);
    if (contribution.type === "theme") next.themes?.push(contribution.payload);
  }

  const uniqueById = <T extends { id: string }>(items: T[] | undefined): T[] | undefined => {
    if (!items?.length) return undefined;
    const keyed = new Map<string, T>();
    for (const item of items) keyed.set(item.id, item);
    return Array.from(keyed.values());
  };
  const uniqueThemes = (items: Array<string | PluginThemeContribution> | undefined) => {
    if (!items?.length) return undefined;
    const keyed = new Map<string, string | PluginThemeContribution>();
    for (const item of items) {
      const id = typeof item === "string" ? item : item.id;
      keyed.set(id, item);
    }
    return Array.from(keyed.values());
  };

  return {
    commands: uniqueById(next.commands),
    sidebars: uniqueById(next.sidebars),
    markdownRenderers: next.markdownRenderers?.length ? Array.from(new Set(next.markdownRenderers)) : undefined,
    aiTools: next.aiTools?.length ? Array.from(new Set(next.aiTools)) : undefined,
    themes: uniqueThemes(next.themes),
  };
}

function validateSandboxContribution(
  manifest: PluginManifest,
  contribution: PluginSandboxContribution,
): PluginSandboxContribution {
  const permissions = new Set(manifest.permissions);
  const requirePermission = (permission: PluginPermission) => {
    if (!permissions.has(permission)) throw new Error(`插件 ${manifest.id} 未声明权限：${permission}`);
  };

  if (contribution.type === "command") {
    requirePermission("command");
    return { type: "command", payload: normalizeCommands([contribution.payload])?.[0] as PluginCommandContribution };
  }
  if (contribution.type === "sidebar") {
    requirePermission("sidebar");
    return { type: "sidebar", payload: normalizeSidebars([contribution.payload])?.[0] as PluginSidebarContribution };
  }
  if (contribution.type === "markdown") {
    requirePermission("markdown_render");
    const value = normalizeString(contribution.payload);
    if (!value) throw new Error("Markdown 渲染扩展必须是非空字符串");
    return { type: "markdown", payload: value };
  }
  if (contribution.type === "ai") {
    requirePermission("ai");
    const value = normalizeString(contribution.payload);
    if (!value) throw new Error("AI 工具必须是非空字符串");
    return { type: "ai", payload: value };
  }

  requirePermission("theme");
  const theme = normalizeThemeContributions([contribution.payload])?.[0];
  if (!theme) throw new Error("主题扩展必须是非空字符串或对象");
  return { type: "theme", payload: theme };
}

export function createPluginSandboxScript(manifest: PluginManifest): string {
  const pluginId = JSON.stringify(manifest.id);
  const permissions = JSON.stringify(manifest.permissions);
  const entry = manifest.entry ?? "";
  const networkAllowed = manifest.permissions.includes("network");

  return `
"use strict";
const __pluginId = ${pluginId};
const __permissions = new Set(${permissions});
const __hasPermission = (permission) => __permissions.has(permission);
const __requirePermission = (permission) => {
  if (!__hasPermission(permission)) {
    throw new Error("插件 " + __pluginId + " 未声明权限：" + permission);
  }
};
const __postContribution = (type, payload) => {
  postMessage({ type: "register", contribution: { type, payload } });
};
if (${networkAllowed ? "false" : "true"}) {
  globalThis.fetch = () => Promise.reject(new Error("插件 " + __pluginId + " 未声明权限：network"));
  globalThis.XMLHttpRequest = undefined;
  globalThis.WebSocket = undefined;
  globalThis.EventSource = undefined;
  globalThis.importScripts = () => { throw new Error("插件 " + __pluginId + " 不允许加载外部脚本"); };
}
globalThis.document = undefined;
globalThis.window = undefined;
globalThis.localStorage = undefined;
globalThis.sessionStorage = undefined;
globalThis.moknow = Object.freeze({
  pluginId: __pluginId,
  permissions: Object.freeze(Array.from(__permissions)),
  hasPermission: __hasPermission,
  registerCommand(command) {
    __requirePermission("command");
    __postContribution("command", command);
  },
  registerSidebarPanel(panel) {
    __requirePermission("sidebar");
    __postContribution("sidebar", panel);
  },
  registerMarkdownRenderer(rendererId) {
    __requirePermission("markdown_render");
    __postContribution("markdown", rendererId);
  },
  registerAiTool(toolId) {
    __requirePermission("ai");
    __postContribution("ai", toolId);
  },
  registerTheme(theme) {
    __requirePermission("theme");
    __postContribution("theme", theme);
  },
});
self.onmessage = async (event) => {
  if (!event.data || event.data.type !== "activate") return;
  try {
    ${entry}
    if (typeof globalThis.activate === "function") {
      await globalThis.activate(globalThis.moknow);
    }
    postMessage({ type: "done" });
  } catch (error) {
    postMessage({ type: "error", message: error instanceof Error ? error.message : "插件沙箱执行失败" });
  }
};
`;
}

function createDefaultSandboxWorker(script: string): PluginSandboxWorker {
  if (typeof Worker === "undefined" || typeof Blob === "undefined" || typeof URL === "undefined") {
    throw new Error("当前环境不支持 Worker 插件沙箱");
  }

  const url = URL.createObjectURL(new Blob([script], { type: "text/javascript" }));
  const worker = new Worker(url) as PluginSandboxWorker;
  const originalTerminate = worker.terminate.bind(worker);
  worker.terminate = () => {
    originalTerminate();
    URL.revokeObjectURL(url);
  };
  return worker;
}

export class PluginService {
  getOfficialPluginCatalog(): OfficialPluginCatalogItem[] {
    return OFFICIAL_PLUGIN_CATALOG.map((item) => ({
      ...item,
      manifest: this.parseManifest(item.manifest),
    }));
  }

  parseManifest(input: string | PluginManifest): PluginManifest {
    const data = typeof input === "string" ? JSON.parse(input) as unknown : input;
    if (!isRecord(data)) throw new Error("插件 manifest 必须是 JSON 对象");

    const id = normalizeString(data.id);
    const name = normalizeString(data.name);
    const version = normalizeString(data.version);
    if (!id || !/^[a-z0-9][a-z0-9.-]*$/i.test(id)) {
      throw new Error("插件 id 必须是字母、数字、点或连字符组成的非空字符串");
    }
    if (!name) throw new Error("插件 name 不能为空");
    if (!version) throw new Error("插件 version 不能为空");

    const permissions = Array.isArray(data.permissions)
      ? Array.from(new Set(data.permissions.map(assertValidPermission)))
      : [];
    const contributes = isRecord(data.contributes) ? {
      commands: normalizeCommands(data.contributes.commands),
      sidebars: normalizeSidebars(data.contributes.sidebars),
      markdownRenderers: normalizeStringList(data.contributes.markdownRenderers, "Markdown 渲染扩展"),
      aiTools: normalizeStringList(data.contributes.aiTools, "AI 工具"),
      themes: normalizeThemeContributions(data.contributes.themes),
    } : undefined;

    return {
      id,
      name,
      version,
      description: normalizeString(data.description),
      author: normalizeString(data.author),
      entry: normalizeString(data.entry),
      permissions,
      contributes,
    };
  }

  loadRegistry(): PluginRegistryItem[] {
    try {
      const raw = window.localStorage.getItem(PLUGIN_REGISTRY_STORAGE_KEY);
      if (!raw) return [];
      const items = JSON.parse(raw) as unknown;
      if (!Array.isArray(items)) return [];
      return items.map((item) => {
        if (!isRecord(item)) throw new Error("插件注册表格式错误");
        const manifest = this.parseManifest(item.manifest as PluginManifest);
        const status = item.status === "enabled" || item.status === "failed" ? item.status : "disabled";
        return {
          manifest,
          status,
          installedAt: normalizeString(item.installedAt) ?? new Date().toISOString(),
          enabledAt: normalizeString(item.enabledAt),
          error: normalizeString(item.error),
          sandbox: isRecord(item.sandbox) ? {
            lastRunAt: normalizeString(item.sandbox.lastRunAt),
            contributionsRegistered: typeof item.sandbox.contributionsRegistered === "number" ? item.sandbox.contributionsRegistered : undefined,
          } : undefined,
        };
      });
    } catch {
      return [];
    }
  }

  saveRegistry(items: PluginRegistryItem[]): PluginRegistryItem[] {
    const normalized = items.map((item) => ({
      ...item,
      manifest: this.parseManifest(item.manifest),
      status: item.status,
      installedAt: item.installedAt || new Date().toISOString(),
    }));
    window.localStorage.setItem(PLUGIN_REGISTRY_STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  }

  installManifest(input: string | PluginManifest, registry = this.loadRegistry()): PluginRegistryItem[] {
    const manifest = this.parseManifest(input);
    const installed: PluginRegistryItem = {
      manifest,
      status: "disabled",
      installedAt: new Date().toISOString(),
    };
    return this.saveRegistry([installed, ...registry.filter((item) => item.manifest.id !== manifest.id)]);
  }

  installOfficialPlugin(pluginId: string, registry = this.loadRegistry()): PluginRegistryItem[] {
    const item = this.getOfficialPluginCatalog().find((plugin) => plugin.manifest.id === pluginId);
    if (!item) throw new Error(`未知官方插件：${pluginId}`);
    return this.installManifest(item.manifest, registry);
  }

  setPluginEnabled(pluginId: string, enabled: boolean, registry = this.loadRegistry()): PluginRegistryItem[] {
    return this.saveRegistry(registry.map((item) => item.manifest.id === pluginId ? {
      ...item,
      status: enabled ? "enabled" : "disabled",
      enabledAt: enabled ? new Date().toISOString() : undefined,
      error: enabled ? undefined : item.error,
    } : item));
  }

  removePlugin(pluginId: string, registry = this.loadRegistry()): PluginRegistryItem[] {
    return this.saveRegistry(registry.filter((item) => item.manifest.id !== pluginId));
  }

  collectRuntimeContributions(registry = this.loadRegistry()): PluginRuntimeContributions {
    const contributions: PluginRuntimeContributions = {
      commands: [],
      sidebars: [],
      markdownRenderers: [],
      aiTools: [],
      themes: [],
    };

    for (const item of registry) {
      if (item.status !== "enabled") continue;
      const { manifest } = item;
      const permissions = new Set(manifest.permissions);
      if (permissions.has("command")) {
        contributions.commands.push(...(manifest.contributes?.commands ?? []).map((command) => ({
          ...command,
          pluginId: manifest.id,
          pluginName: manifest.name,
        })));
      }
      if (permissions.has("sidebar")) {
        contributions.sidebars.push(...(manifest.contributes?.sidebars ?? []).map((sidebar) => ({
          ...sidebar,
          pluginId: manifest.id,
          pluginName: manifest.name,
        })));
      }
      if (permissions.has("markdown_render")) {
        contributions.markdownRenderers.push(...(manifest.contributes?.markdownRenderers ?? []).map((id) => ({
          id,
          pluginId: manifest.id,
          pluginName: manifest.name,
        })));
      }
      if (permissions.has("ai")) {
        contributions.aiTools.push(...(manifest.contributes?.aiTools ?? []).map((id) => ({
          id,
          pluginId: manifest.id,
          pluginName: manifest.name,
        })));
      }
      if (permissions.has("theme")) {
        contributions.themes.push(...(manifest.contributes?.themes ?? []).map((theme) => {
          const contribution = typeof theme === "string" ? { id: theme, title: theme } : theme;
          return {
            ...contribution,
            key: `${manifest.id}:${contribution.id}`,
            pluginId: manifest.id,
            pluginName: manifest.name,
          };
        }));
      }
    }

    return contributions;
  }

  createContext(manifest: PluginManifest): PluginContext {
    const registeredPermissions = new Set(manifest.permissions);
    const requirePermission = (permission: PluginPermission) => {
      if (!registeredPermissions.has(permission)) {
        throw new Error(`插件 ${manifest.id} 未声明权限：${permission}`);
      }
    };

    return {
      pluginId: manifest.id,
      permissions: manifest.permissions,
      hasPermission: (permission) => registeredPermissions.has(permission),
      registerCommand: () => requirePermission("command"),
      registerSidebarPanel: () => requirePermission("sidebar"),
      registerMarkdownRenderer: () => requirePermission("markdown_render"),
      registerAiTool: () => requirePermission("ai"),
      registerTheme: () => requirePermission("theme"),
    };
  }

  activatePlugin(
    item: PluginRegistryItem,
    activate: (context: PluginContext) => void,
    registry = this.loadRegistry(),
  ): PluginRegistryItem[] {
    try {
      activate(this.createContext(item.manifest));
      return this.saveRegistry(registry.map((plugin) => plugin.manifest.id === item.manifest.id ? {
        ...plugin,
        status: "enabled",
        enabledAt: new Date().toISOString(),
        error: undefined,
      } : plugin));
    } catch (error) {
      const message = error instanceof Error ? error.message : "插件启动失败";
      return this.saveRegistry(registry.map((plugin) => plugin.manifest.id === item.manifest.id ? {
        ...plugin,
        status: "failed",
        error: message,
      } : plugin));
    }
  }

  async activatePluginInSandbox(
    item: PluginRegistryItem,
    registry = this.loadRegistry(),
    options: PluginSandboxOptions = {},
  ): Promise<PluginRegistryItem[]> {
    if (!item.manifest.entry) {
      return this.activatePlugin(item, () => undefined, registry);
    }

    try {
      const contributions = await this.runSandbox(item.manifest, options);
      const activatedManifest = this.parseManifest({
        ...item.manifest,
        contributes: mergeContributes(item.manifest.contributes, contributions),
      });
      return this.saveRegistry(registry.map((plugin) => plugin.manifest.id === item.manifest.id ? {
        ...plugin,
        manifest: activatedManifest,
        status: "enabled",
        enabledAt: new Date().toISOString(),
        error: undefined,
        sandbox: {
          lastRunAt: new Date().toISOString(),
          contributionsRegistered: contributions.length,
        },
      } : plugin));
    } catch (error) {
      const message = error instanceof Error ? error.message : "插件沙箱执行失败";
      return this.saveRegistry(registry.map((plugin) => plugin.manifest.id === item.manifest.id ? {
        ...plugin,
        status: "failed",
        error: message,
      } : plugin));
    }
  }

  private runSandbox(
    manifest: PluginManifest,
    options: PluginSandboxOptions,
  ): Promise<PluginSandboxContribution[]> {
    const script = createPluginSandboxScript(manifest);
    const worker = (options.workerFactory ?? createDefaultSandboxWorker)(script);
    const timeoutMs = options.timeoutMs ?? 1500;
    const contributions: PluginSandboxContribution[] = [];

    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        worker.terminate();
        reject(new Error("插件沙箱执行超时"));
      }, timeoutMs);

      const cleanup = () => {
        window.clearTimeout(timeout);
        worker.terminate();
      };

      worker.onerror = (event) => {
        cleanup();
        reject(new Error(event.message || "插件沙箱执行失败"));
      };

      worker.onmessage = (event) => {
        const message = event.data as unknown;
        if (!isRecord(message) || typeof message.type !== "string") return;
        if (message.type === "register") {
          if (!isRecord(message.contribution)) {
            cleanup();
            reject(new Error("插件沙箱贡献格式错误"));
            return;
          }
          try {
            contributions.push(validateSandboxContribution(manifest, message.contribution as PluginSandboxContribution));
          } catch (error) {
            cleanup();
            reject(error);
          }
          return;
        }
        if (message.type === "done") {
          cleanup();
          resolve(contributions);
          return;
        }
        if (message.type === "error") {
          cleanup();
          reject(new Error(normalizeString(message.message) ?? "插件沙箱执行失败"));
        }
      };

      worker.postMessage({ type: "activate" });
    });
  }
}

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { message, Modal } from "antd";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { mockFiles } from "./data/mockRepository";
import { ERROR_DIAGNOSTIC_LOG_STORAGE_KEY } from "./services/appErrorService";
import { APP_SETTINGS_STORAGE_KEY } from "./services/appSettingsService";
import { APP_LOCK_STORAGE_KEY, createAppLockSettings } from "./services/appLockService";
import { AI_PROVIDER_SETTINGS_STORAGE_KEY } from "./services/aiCockpitService";
import { AI_EMBEDDING_SETTINGS_STORAGE_KEY, AI_VECTOR_INDEX_STORAGE_KEY } from "./services/aiVectorIndexService";
import { parseFrontmatter } from "./services/frontmatterService";
import { PLUGIN_REGISTRY_STORAGE_KEY } from "./services/pluginService";

describe("App theme switching", () => {
  afterEach(() => {
    message.destroy();
    Modal.destroyAll();
    vi.restoreAllMocks();
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith("moknow:draft:")) {
        window.localStorage.removeItem(key);
      }
    }
    window.localStorage.removeItem("moknow:tag-colors");
    window.localStorage.removeItem(APP_LOCK_STORAGE_KEY);
    window.localStorage.removeItem(APP_SETTINGS_STORAGE_KEY);
    window.localStorage.removeItem(AI_PROVIDER_SETTINGS_STORAGE_KEY);
    window.localStorage.removeItem(AI_EMBEDDING_SETTINGS_STORAGE_KEY);
    window.localStorage.removeItem(AI_VECTOR_INDEX_STORAGE_KEY);
    window.localStorage.removeItem(ERROR_DIAGNOSTIC_LOG_STORAGE_KEY);
    window.localStorage.removeItem(PLUGIN_REGISTRY_STORAGE_KEY);
  });

  it("switches between night and day themes from the titlebar", async () => {
    const { container } = render(<App />);

    await waitFor(() => expect(screen.getByText("2024-06-04-日记.md")).toBeInTheDocument());

    const appRoot = container.querySelector(".app-root");
    expect(appRoot).toHaveAttribute("data-theme", "night");
    expect(screen.getByRole("button", { name: "切换到白天主题" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "切换到白天主题" }));

    expect(appRoot).toHaveAttribute("data-theme", "day");
    expect(screen.getByRole("button", { name: "切换到黑夜主题" })).toBeInTheDocument();
    expect(window.localStorage.getItem(APP_SETTINGS_STORAGE_KEY)).toContain('"themePreference":"day"');
  });

  it("saves custom appearance settings from the general settings panel", async () => {
    const { container } = render(<App />);

    await waitFor(() => expect(screen.getByText("2024-06-04-日记.md")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    const dialog = await screen.findByRole("dialog", { name: "设置" });

    fireEvent.mouseDown(within(dialog).getByLabelText("主题"));
    fireEvent.click(await screen.findByText("自定义"));
    fireEvent.change(within(dialog).getByLabelText("自定义主色"), { target: { value: "#56d98e" } });
    fireEvent.change(within(dialog).getByLabelText("圆角"), { target: { value: "8" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /保\s*存/ }));

    await waitFor(() => expect(window.localStorage.getItem(APP_SETTINGS_STORAGE_KEY)).toContain('"themePreference":"custom"'));
    expect(container.querySelector(".app-root")).toHaveStyle({ "--accent": "#56d98e" });
  });

  it("applies custom css and imports or exports settings from the general settings panel", async () => {
    const createObjectUrl = vi.fn((object: Blob | MediaSource) => {
      void object;
      return "blob:moknow-settings";
    });
    const revokeObjectUrl = vi.fn();
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectUrl });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectUrl });

    render(<App />);

    await waitFor(() => expect(screen.getByText("2024-06-04-日记.md")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    const dialog = await screen.findByRole("dialog", { name: "设置" });
    fireEvent.change(within(dialog).getByLabelText("自定义 CSS"), { target: { value: ".app-root { outline: 3px solid rgb(255, 0, 170); }" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "导出设置" }));

    const exportedBlob = createObjectUrl.mock.calls[0][0] as Blob;
    await expect(exportedBlob.text()).resolves.toContain("outline");
    expect(anchorClick).toHaveBeenCalled();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:moknow-settings");

    fireEvent.click(within(dialog).getByRole("button", { name: /保\s*存/ }));

    await waitFor(() => expect(document.querySelector("#moknow-custom-css")?.textContent).toContain("outline"));

    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    const nextDialog = await screen.findByRole("dialog", { name: "设置" });
    const settingsFile = new File([JSON.stringify({
      themePreference: "custom",
      customTheme: {
        mode: "light",
        primaryColor: "#123456",
        compact: false,
        borderRadius: 7,
        fontSize: 14,
      },
      customCss: ".titlebar { min-height: 44px; }",
    })], "moknow-settings.json", { type: "application/json" });
    fireEvent.change(within(nextDialog).getByLabelText("导入设置文件"), { target: { files: [settingsFile] } });

    await waitFor(() => expect(window.localStorage.getItem(APP_SETTINGS_STORAGE_KEY)).toContain("#123456"));
    expect(document.querySelector("#moknow-custom-css")?.textContent).toContain("min-height");
  });

  it("applies plugin themes and file scoped css from the general settings panel", async () => {
    window.localStorage.setItem(PLUGIN_REGISTRY_STORAGE_KEY, JSON.stringify([
      {
        manifest: {
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
        },
        status: "enabled",
        installedAt: "2026-06-09T00:00:00.000Z",
      },
    ]));

    const { container } = render(<App />);

    await waitFor(() => expect(screen.getByText("2024-06-04-日记.md")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    const dialog = await screen.findByRole("dialog", { name: "设置" });
    fireEvent.mouseDown(within(dialog).getByLabelText("主题"));
    fireEvent.click(await screen.findByText("插件：薄荷主题（主题包）"));
    fireEvent.change(within(dialog).getByLabelText("文件 CSS"), { target: { value: ".file-scoped { color: rgb(32, 180, 134); }" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /保\s*存/ }));

    await waitFor(() => expect(window.localStorage.getItem(APP_SETTINGS_STORAGE_KEY)).toContain("plugin:moknow.theme-pack:mint"));
    expect(container.querySelector(".app-root")).toHaveStyle({ "--accent": "#20b486" });
    expect(document.querySelector("#moknow-custom-css")?.textContent).toContain(".file-scoped");
  });

  it("filters, exports and clears persisted error logs from the command palette", async () => {
    const createObjectUrl = vi.fn((object: Blob | MediaSource) => {
      void object;
      return "blob:moknow-error-log";
    });
    const revokeObjectUrl = vi.fn();
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectUrl });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectUrl });

    window.localStorage.setItem(ERROR_DIAGNOSTIC_LOG_STORAGE_KEY, JSON.stringify([
      {
        id: "diag-test",
        occurredAt: "2026-06-09T00:00:00.000Z",
        operation: "保存当前文件",
        message: "保存失败",
        scenario: "permission",
        suggestion: "请检查目标文件或目录的读写权限，或换一个你有权限的仓库位置后重试。",
        repositoryName: "MoKnow 日记仓库",
        fileName: "today.md",
      },
      {
        id: "diag-backup",
        occurredAt: "2026-06-09T00:05:00.000Z",
        operation: "备份当前仓库",
        message: "备份失败",
        scenario: "backup",
        suggestion: "请确认备份文件存在、目标位置可写且磁盘空间充足，然后重新执行备份或恢复。",
        repositoryName: "MoKnow 日记仓库",
        fileName: "backup.zip",
      },
    ]));
    render(<App />);

    await waitFor(() => expect(screen.getByText("2024-06-04-日记.md")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "命令面板" }));
    fireEvent.change(await screen.findByPlaceholderText(/搜索命令/), { target: { value: "错误日志" } });
    fireEvent.click(screen.getByRole("button", { name: /查看错误日志/ }));

    const dialog = await screen.findByRole("dialog", { name: "错误日志" });
    expect(within(dialog).getByText("保存当前文件")).toBeInTheDocument();
    expect(within(dialog).getByText("保存失败")).toBeInTheDocument();
    expect(within(dialog).getByText("备份当前仓库")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "重试保存" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "重新备份" })).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText("错误场景筛选"), { target: { value: "permission" } });
    fireEvent.change(within(dialog).getByLabelText("错误日志搜索"), { target: { value: "today" } });
    expect(within(dialog).getByText("保存当前文件")).toBeInTheDocument();
    expect(within(dialog).queryByText("备份当前仓库")).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "导出日志" }));
    const exportedBlob = createObjectUrl.mock.calls[0][0] as Blob;
    await expect(exportedBlob.text()).resolves.toContain("保存当前文件");
    await expect(exportedBlob.text()).resolves.not.toContain("备份当前仓库");
    expect(anchorClick).toHaveBeenCalled();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:moknow-error-log");

    fireEvent.click(within(dialog).getByRole("button", { name: "清空日志" }));
    expect(within(dialog).getByText("暂无错误日志")).toBeInTheDocument();
  });

  it("installs and enables plugin manifests from the plugin manager", async () => {
    render(<App />);

    await waitFor(() => expect(screen.getByText("2024-06-04-日记.md")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "插件管理" }));
    const dialog = await screen.findByRole("dialog", { name: "插件管理" });

    fireEvent.change(within(dialog).getByLabelText("插件 Manifest JSON"), {
      target: {
        value: JSON.stringify({
          id: "moknow.quick-command",
          name: "快捷命令插件",
          version: "0.1.0",
          description: "注册一个命令入口",
          permissions: ["command", "sidebar"],
          contributes: {
            commands: [{ id: "hello", title: "问候命令", category: "示例" }],
            sidebars: [{ id: "today-panel", title: "今日插件面板" }],
          },
        }),
      },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "安装 Manifest" }));

    expect(within(dialog).getByText("快捷命令插件")).toBeInTheDocument();
    expect(within(dialog).getByText("注册命令")).toBeInTheDocument();
    expect(window.localStorage.getItem(PLUGIN_REGISTRY_STORAGE_KEY)).toContain("moknow.quick-command");

    fireEvent.click(within(dialog).getByRole("switch", { name: "快捷命令插件 启用状态" }));

    await waitFor(() => expect(window.localStorage.getItem(PLUGIN_REGISTRY_STORAGE_KEY)).toContain('"status":"enabled"'));
  });

  it("installs official plugins from the plugin manager catalog", async () => {
    render(<App />);

    await waitFor(() => expect(screen.getByText("2024-06-04-日记.md")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "插件管理" }));
    const dialog = await screen.findByRole("dialog", { name: "插件管理" });

    expect(within(dialog).getByText("官方字数统计")).toBeInTheDocument();
    const officialWordCountCard = within(dialog).getByText("官方字数统计").closest("article");
    expect(officialWordCountCard).not.toBeNull();
    fireEvent.click(within(officialWordCountCard as HTMLElement).getByRole("button", { name: "安装官方插件" }));

    await waitFor(() => expect(window.localStorage.getItem(PLUGIN_REGISTRY_STORAGE_KEY)).toContain("moknow.official.word-count"));
    expect(within(dialog).getAllByText("官方字数统计").length).toBeGreaterThanOrEqual(2);
    expect(within(dialog).getByRole("switch", { name: "官方字数统计 启用状态" })).toBeInTheDocument();
  });

  it("registers enabled plugin commands, sidebar and AI tool contributions in the runtime UI", async () => {
    window.localStorage.setItem(PLUGIN_REGISTRY_STORAGE_KEY, JSON.stringify([
      {
        manifest: {
          id: "moknow.runtime",
          name: "运行时插件",
          version: "0.1.0",
          permissions: ["command", "sidebar", "ai", "markdown_render"],
          contributes: {
            commands: [{ id: "hello", title: "问候命令", category: "示例" }],
            sidebars: [{ id: "today-panel", title: "今日插件面板" }],
            aiTools: ["summary"],
            markdownRenderers: ["callout"],
          },
        },
        status: "enabled",
        installedAt: "2026-06-09T00:00:00.000Z",
        enabledAt: "2026-06-09T00:00:00.000Z",
      },
    ]));

    render(<App />);

    await waitFor(() => expect(screen.getByText("2024-06-04-日记.md")).toBeInTheDocument());
    expect(screen.getByRole("region", { name: "插件侧边栏贡献" })).toBeInTheDocument();
    expect(screen.getByText("今日插件面板")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "命令面板" }));
    expect(await screen.findByRole("dialog", { name: "命令面板" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("命令面板搜索"), { target: { value: "问候命令" } });
    fireEvent.click(screen.getByRole("button", { name: "执行命令 问候命令" }));

    expect(screen.getByText("插件命令已触发：问候命令")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "插件：summary" }));

    expect(await screen.findByText(/插件 运行时插件 \/ summary 已读取/)).toBeInTheDocument();
  });

  it("toggles focus writing mode from the titlebar", async () => {
    const { container } = render(<App />);

    await waitFor(() => expect(screen.getByText("2024-06-04-日记.md")).toBeInTheDocument());
    expect(container.querySelector(".sidebar")).toBeInTheDocument();
    expect(container.querySelector(".ai-panel")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "进入专注写作" }));

    expect(container.querySelector(".app-root")).toHaveClass("focus-mode");
    expect(container.querySelector(".sidebar")).not.toBeInTheDocument();
    expect(container.querySelector(".ai-panel")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "退出专注写作" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "退出专注写作" }));

    expect(container.querySelector(".app-root")).not.toHaveClass("focus-mode");
    expect(container.querySelector(".sidebar")).toBeInTheDocument();
    expect(container.querySelector(".ai-panel")).toBeInTheDocument();
  });

  it("enables typewriter mode and keeps the editor in focus mode", async () => {
    const { container } = render(<App />);

    await waitFor(() => expect(screen.getByText("2024-06-04-日记.md")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "开启打字机模式" }));

    expect(container.querySelector(".app-root")).toHaveClass("focus-mode");
    expect(await screen.findByLabelText("Markdown 源码编辑器")).toHaveClass("typewriter-textarea");
    expect(screen.getByRole("button", { name: "关闭打字机模式" })).toBeInTheDocument();
  });

  it("enters and exits fullscreen writing mode", async () => {
    let fullscreenElement: Element | null = null;
    const requestFullscreen = vi.fn(async () => {
      fullscreenElement = document.documentElement;
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    const exitFullscreen = vi.fn(async () => {
      fullscreenElement = null;
      document.dispatchEvent(new Event("fullscreenchange"));
    });

    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => fullscreenElement,
    });
    Object.defineProperty(document.documentElement, "requestFullscreen", {
      configurable: true,
      value: requestFullscreen,
    });
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: exitFullscreen,
    });

    const { container } = render(<App />);

    await waitFor(() => expect(screen.getByText("2024-06-04-日记.md")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "进入全屏写作" }));

    await waitFor(() => expect(requestFullscreen).toHaveBeenCalled());
    expect(container.querySelector(".app-root")).toHaveClass("focus-mode");
    expect(screen.getByRole("button", { name: "退出全屏写作" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "退出全屏写作" }));

    await waitFor(() => expect(exitFullscreen).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "进入全屏写作" })).toBeInTheDocument();
  });

  it("asks users to create a real repository before creating journals from the mock repository", async () => {
    render(<App />);

    await waitFor(() => expect(screen.getByText("2024-06-04-日记.md")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "新增日记" }));

    expect(await screen.findByRole("dialog", { name: "新建仓库" })).toBeInTheDocument();
  });

  it("keeps the workspace mounted while creating a journal in a real repository", async () => {
    render(<App />);

    await waitFor(() => expect(screen.getByText("2024-06-04-日记.md")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "新建仓库" }));
    fireEvent.change(screen.getByPlaceholderText("仓库名称"), { target: { value: "真实仓库" } });
    fireEvent.change(screen.getByPlaceholderText("仓库存放位置"), { target: { value: "D:/Notes" } });
    fireEvent.click(screen.getByRole("button", { name: /创\s*建|创建/ }));

    await waitFor(() => expect(screen.getAllByText("2026-06-04.md").length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole("button", { name: "新增日记" }));

    expect(screen.queryByText("正在加载 MoKnow 仓库...")).not.toBeInTheDocument();
    expect((await screen.findAllByText("2026-06-04-2.md")).length).toBeGreaterThan(0);
  });

  it("backs up a real repository from the titlebar", async () => {
    render(<App />);

    await waitFor(() => expect(screen.getByText("2024-06-04-日记.md")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "新建仓库" }));
    fireEvent.change(screen.getByPlaceholderText("仓库名称"), { target: { value: "真实仓库" } });
    fireEvent.change(screen.getByPlaceholderText("仓库存放位置"), { target: { value: "D:/Notes" } });
    fireEvent.click(screen.getByRole("button", { name: /创\s*建|创建/ }));

    await waitFor(() => expect(screen.getAllByText("2026-06-04.md").length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: "备份仓库" }));
    const dialog = await screen.findByRole("dialog", { name: "备份仓库" });
    expect(within(dialog).getByLabelText("备份预览")).toHaveTextContent("疑似隐私文件");
    fireEvent.change(within(dialog).getByLabelText("备份位置"), { target: { value: "D:/Notes/Backups/手动备份" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /开始备份/ }));

    expect(await screen.findByText(/仓库已备份/)).toBeInTheDocument();
    expect(await screen.findByText(/手动备份\.zip/)).toBeInTheDocument();
  });

  it("asks users to save dirty content before backing up", async () => {
    render(<App />);

    await waitFor(() => expect(screen.getByText("2024-06-04-日记.md")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "新建仓库" }));
    fireEvent.change(screen.getByPlaceholderText("仓库名称"), { target: { value: "备份前保存" } });
    fireEvent.change(screen.getByPlaceholderText("仓库存放位置"), { target: { value: "D:/Notes" } });
    fireEvent.click(screen.getByRole("button", { name: /创\s*建|创建/ }));

    const editor = await screen.findByLabelText("Markdown 源码编辑器");
    fireEvent.change(editor, { target: { value: "# 未保存\n\n需要先保存" } });
    fireEvent.click(screen.getByRole("button", { name: "备份仓库" }));

    expect((await screen.findAllByText("备份前请先保存当前未保存内容")).length).toBeGreaterThan(0);
  });

  it("previews and restores a selected backup from the titlebar", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<App />);

    await waitFor(() => expect(screen.getByText("2024-06-04-日记.md")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "新建仓库" }));
    fireEvent.change(screen.getByPlaceholderText("仓库名称"), { target: { value: "恢复仓库" } });
    fireEvent.change(screen.getByPlaceholderText("仓库存放位置"), { target: { value: "D:/Notes" } });
    fireEvent.click(screen.getByRole("button", { name: /创\s*建|创建/ }));

    await waitFor(() => expect(screen.getAllByText("2026-06-04.md").length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: "恢复最近备份" }));
    const dialog = await screen.findByRole("dialog", { name: "恢复备份" });
    expect(await within(dialog).findByLabelText("恢复预览")).toHaveTextContent("差异预览");
    expect(within(dialog).getByText(/新增 1/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("恢复备份文件"), { target: { value: "D:/Notes/Backups/手动备份.zip" } });
    fireEvent.blur(within(dialog).getByLabelText("恢复备份文件"));
    await waitFor(() => expect(within(dialog).getByText(/手动备份\.zip/)).toBeInTheDocument());
    fireEvent.change(within(dialog).getByLabelText("恢复策略"), { target: { value: "merge_keep_current" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /执行恢复/ }));

    expect(await screen.findByText(/已恢复备份/)).toBeInTheDocument();
    expect(confirmSpy).toHaveBeenCalledWith("合并恢复会保留当前已有文件，只补回备份中缺失的文件，继续吗？");
  });

  it("exports the current file as HTML from the titlebar", async () => {
    render(<App />);

    await waitFor(() => expect(screen.getByText("2024-06-04-日记.md")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "新建仓库" }));
    fireEvent.change(screen.getByPlaceholderText("仓库名称"), { target: { value: "导出仓库" } });
    fireEvent.change(screen.getByPlaceholderText("仓库存放位置"), { target: { value: "D:/Notes" } });
    fireEvent.click(screen.getByRole("button", { name: /创\s*建|创建/ }));

    await waitFor(() => expect(screen.getAllByText("2026-06-04.md").length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: "导出 HTML" }));

    expect(await screen.findByText(/HTML 已导出/)).toBeInTheDocument();
  });

  it("exports the current file as PDF from the titlebar", async () => {
    render(<App />);

    await waitFor(() => expect(screen.getByText("2024-06-04-日记.md")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "新建仓库" }));
    fireEvent.change(screen.getByPlaceholderText("仓库名称"), { target: { value: "PDF 导出仓库" } });
    fireEvent.change(screen.getByPlaceholderText("仓库存放位置"), { target: { value: "D:/Notes" } });
    fireEvent.click(screen.getByRole("button", { name: /创\s*建|创建/ }));

    await waitFor(() => expect(screen.getAllByText("2026-06-04.md").length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: "导出 PDF" }));

    expect(await screen.findByText(/PDF 已导出/)).toBeInTheDocument();
    expect(await screen.findByText(/2026-06-04\.pdf/)).toBeInTheDocument();
  });

  it("inserts AI diary assistant output into the current draft", async () => {
    render(<App />);

    await waitFor(() => expect(screen.getByText("2024-06-04-日记.md")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "周回顾" }));

    await waitFor(() => expect(screen.getByText(/范围：1 篇记录/)).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole("button", { name: "插入正文" }).at(-1)!);

    const editor = screen.getByLabelText("Markdown 源码编辑器") as HTMLTextAreaElement;
    await waitFor(() => expect(editor.value).toContain("## 周回顾"));
    expect(screen.getByText("● 有未保存更改")).toBeInTheDocument();
  });

  it("retrieves repository notes for AI questions and opens source references", async () => {
    render(<App />);

    await waitFor(() => expect(screen.getByText("2024-06-04-日记.md")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "全仓库" }));
    fireEvent.change(screen.getByPlaceholderText("问我任何关于你笔记的问题..."), {
      target: { value: "许可证" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送 ↑" }));

    const sourceButton = await screen.findByRole("button", { name: "打开来源 README.md" });
    expect(screen.getByText("文档/项目/README.md")).toBeInTheDocument();
    expect(screen.getAllByText(/许可证/).length).toBeGreaterThan(0);

    fireEvent.click(sourceButton);

    const editor = screen.getByLabelText("Markdown 源码编辑器") as HTMLTextAreaElement;
    await waitFor(() => expect(editor.value).toContain("## 许可证"));
  });

  it("exports journal entries by date range to a selected HTML path", async () => {
    const { container } = render(<App />);
    const view = within(container);

    await waitFor(() => expect(view.getByText("2024-06-04-日记.md")).toBeInTheDocument());

    fireEvent.click(view.getByRole("button", { name: "新建仓库" }));
    const createDialog = await screen.findByRole("dialog", { name: "新建仓库" });
    fireEvent.change(within(createDialog).getByPlaceholderText("仓库名称"), { target: { value: "合集导出仓库" } });
    fireEvent.change(within(createDialog).getByPlaceholderText("仓库存放位置"), { target: { value: "D:/Notes" } });
    fireEvent.click(within(createDialog).getByRole("button", { name: /创\s*建|创建/ }));

    await waitFor(() => expect(view.getAllByText("2026-06-04.md").length).toBeGreaterThan(0));
    fireEvent.click(view.getByRole("button", { name: "命令面板" }));
    const commandDialog = await screen.findByRole("dialog", { name: "命令面板" });
    fireEvent.change(within(commandDialog).getByLabelText("命令面板搜索"), { target: { value: "日期范围日记" } });
    fireEvent.click(within(commandDialog).getByRole("button", { name: "执行命令 导出日期范围日记" }));

    const dialog = await screen.findByRole("dialog", { name: "导出日记合集" });
    fireEvent.change(within(dialog).getByLabelText("导出类型"), { target: { value: "range" } });
    fireEvent.change(within(dialog).getByLabelText("导出格式"), { target: { value: "print-html" } });
    fireEvent.click(within(dialog).getByLabelText("每篇日记分页"));
    expect(within(dialog).getByLabelText("导出预览")).toHaveTextContent("打印友好 HTML");
    fireEvent.change(within(dialog).getByLabelText("导出开始日期"), { target: { value: "2026-06-01" } });
    fireEvent.change(within(dialog).getByLabelText("导出结束日期"), { target: { value: "2026-06-30" } });
    fireEvent.change(within(dialog).getByLabelText("导出位置"), { target: { value: "D:/Notes/导出/六月合集" } });
    const exportButton = within(dialog).getByRole("button", { name: /导\s*出/ });
    await waitFor(() => expect(exportButton).not.toBeDisabled());
    await waitFor(() => expect(exportButton).not.toHaveClass("ant-btn-loading"));
    fireEvent.click(exportButton);

    expect(await view.findByText(/日记合集已导出/)).toBeInTheDocument();
    expect(await view.findByText(/六月合集\.html/)).toBeInTheDocument();
  });

  it("opens wiki links and navigates backlinks", async () => {
    render(<App />);

    await waitFor(() => expect(screen.getByText("2024-06-04-日记.md")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "双视图" }));
    fireEvent.click(within(screen.getByTestId("editor-split")).getByRole("link", { name: "项目规划" }));

    const editor = await screen.findByLabelText("Markdown 源码编辑器");
    await waitFor(() => expect((editor as HTMLTextAreaElement).value).toContain("# MoKnow 项目规划"));

    const backlinks = await screen.findByRole("navigation", { name: "反向链接" });
    fireEvent.click(within(backlinks).getByRole("button", { name: /2024-06-04-日记/ }));

    await waitFor(() => expect((editor as HTMLTextAreaElement).value).toContain("# 2024年6月4日 晴"));
  });

  it("requires the app lock password on startup when enabled", async () => {
    const settings = await createAppLockSettings({
      enabled: true,
      password: "secret",
      lockOnBlur: true,
      idleMinutes: 10,
    });
    window.localStorage.setItem(APP_LOCK_STORAGE_KEY, JSON.stringify(settings));

    render(<App />);

    const dialog = await screen.findByRole("dialog", { name: "MoKnow 已锁定" });
    expect(screen.queryByLabelText("Markdown 源码编辑器")).not.toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText("解锁密码"), { target: { value: "bad" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /解\s*锁/ }));

    expect(await within(dialog).findByText("密码不正确")).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText("解锁密码"), { target: { value: "secret" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /解\s*锁/ }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "MoKnow 已锁定" })).not.toBeInTheDocument());
    expect(await screen.findByLabelText("Markdown 源码编辑器")).toBeInTheDocument();
  });

  it("resets the app lock password with a recovery code from the lock screen", async () => {
    const settings = await createAppLockSettings({
      enabled: true,
      password: "secret",
      recoveryCode: "ABCD-EFGH-IJKL",
      lockOnBlur: true,
      idleMinutes: 10,
    });
    window.localStorage.setItem(APP_LOCK_STORAGE_KEY, JSON.stringify(settings));

    render(<App />);

    const dialog = await screen.findByRole("dialog", { name: "MoKnow 已锁定" });
    fireEvent.click(within(dialog).getByRole("button", { name: "忘记密码？使用恢复码重置" }));
    fireEvent.change(within(dialog).getByLabelText("应用锁恢复码"), { target: { value: "ABCD-EFGH-IJKL" } });
    fireEvent.change(within(dialog).getByLabelText("新的应用锁密码"), { target: { value: "new-secret" } });
    fireEvent.change(within(dialog).getByLabelText("确认新的应用锁密码"), { target: { value: "new-secret" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "重置并解锁" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "MoKnow 已锁定" })).not.toBeInTheDocument());
    expect(await screen.findByLabelText("Markdown 源码编辑器")).toBeInTheDocument();
    expect(window.localStorage.getItem(APP_LOCK_STORAGE_KEY)).toContain("recoveryCodeHash");
    expect(window.localStorage.getItem(APP_LOCK_STORAGE_KEY)).not.toContain("pendingRecoveryCode");

    const recoveryDialog = await screen.findByRole("dialog", { name: "应用锁恢复码" });
    fireEvent.click(within(recoveryDialog).getByRole("button", { name: "我已保存" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "应用锁恢复码" })).not.toBeInTheDocument());
  });

  it("enables app lock settings and locks when the window is hidden", async () => {
    const originalVisibilityState = document.visibilityState;
    render(<App />);

    await waitFor(() => expect(screen.getByText("2024-06-04-日记.md")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "应用锁设置" }));
    const dialog = await screen.findByRole("dialog", { name: "应用锁设置" });

    fireEvent.click(within(dialog).getByLabelText("启用应用锁"));
    fireEvent.change(within(dialog).getByPlaceholderText("输入解锁密码"), { target: { value: "secret" } });
    fireEvent.change(within(dialog).getByPlaceholderText("再次输入密码"), { target: { value: "secret" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /保\s*存/ }));

    expect(await screen.findByText("应用锁设置已保存")).toBeInTheDocument();
    expect(window.localStorage.getItem(APP_LOCK_STORAGE_KEY)).toContain('"passwordStorage":"system_credential"');
    expect(window.localStorage.getItem(APP_LOCK_STORAGE_KEY)).not.toContain("passwordHash");

    const recoveryDialog = screen.queryByRole("dialog", { name: "应用锁恢复码" });
    if (recoveryDialog) {
      fireEvent.click(within(recoveryDialog).getByRole("button", { name: "我已保存" }));
    }

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(await screen.findByRole("dialog", { name: "MoKnow 已锁定" })).toBeInTheDocument();

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => originalVisibilityState,
    });
  });

  it("opens and saves diary settings from the command palette", async () => {
    render(<App />);

    await waitFor(() => expect(screen.getByText("2024-06-04-日记.md")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "命令面板" }));
    fireEvent.change(await screen.findByPlaceholderText(/搜索命令/), { target: { value: "日记设置" } });
    fireEvent.click(screen.getByRole("button", { name: /打开日记设置/ }));
    const dialog = await screen.findByRole("dialog", { name: "日记设置" });

    fireEvent.change(within(dialog).getByPlaceholderText("日记"), { target: { value: "Journal" } });
    fireEvent.change(within(dialog).getByPlaceholderText("{YYYY-MM-DD}.md"), { target: { value: "{YYYY-MM-DD}-daily.md" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /保\s*存/ }));

    expect(await screen.findByText("日记设置已保存")).toBeInTheDocument();
  });

  it("writes diary metadata to markdown frontmatter", async () => {
    render(<App />);

    const editor = await screen.findByLabelText("Markdown 源码编辑器");

    fireEvent.change(screen.getByLabelText("情绪"), { target: { value: "calm" } });
    fireEvent.change(screen.getByLabelText("标签"), { target: { value: "工作, 家庭" } });
    fireEvent.change(screen.getByLabelText("地点"), { target: { value: "上海 家里" } });
    fireEvent.click(screen.getByLabelText("收藏当前日记"));

    const body = parseFrontmatter(mockFiles.source.raw).body;
    await waitFor(() => {
      expect(editor).toHaveValue(`---
date: 2024-06-04
tags: [工作, 家庭]
mood: calm
location: "上海 家里"
favorite: true
---

${body}`);
    });
    expect(screen.getByText("● 有未保存更改")).toBeInTheDocument();
  });

  it("manages current diary tags from the metadata panel", async () => {
    try {
      render(<App />);

      const editor = await screen.findByLabelText("Markdown 源码编辑器");

      fireEvent.change(screen.getByLabelText("新建标签"), { target: { value: "学习" } });
      fireEvent.click(screen.getByRole("button", { name: "添加" }));

      fireEvent.click(screen.getByRole("button", { name: "编辑标签 工作" }));
      fireEvent.change(screen.getByLabelText("工作 新标签名"), { target: { value: "项目" } });
      fireEvent.click(screen.getByRole("button", { name: "保存标签 工作" }));

      fireEvent.change(screen.getByLabelText("项目 标签颜色"), { target: { value: "#56d98e" } });
      fireEvent.click(screen.getByRole("button", { name: "删除标签 生活" }));
      fireEvent.click(screen.getByRole("button", { name: "查看标签 项目" }));

      await waitFor(() => expect((editor as HTMLTextAreaElement).value).toContain("tags: [日记, 项目, 学习]"));
      expect(screen.getByText("正在查看：项目")).toBeInTheDocument();
    } finally {
      window.localStorage.removeItem("moknow:tag-colors");
    }
  });

  it("searches the repository by tag and keeps query history", async () => {
    render(<App />);

    await waitFor(() => expect(screen.getByText("2024-06-04-日记.md")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "按标签查看 工作" }));

    const results = screen.getByLabelText("搜索结果");
    await waitFor(() => expect(within(results).getByText("2024-06-04-日记.md")).toBeInTheDocument());
    expect(screen.getByText("清除标签筛选：工作")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("全库关键词"), { target: { value: "MoKnow" } });
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));

    await waitFor(() => expect(within(results).getByText("2024-06-04-日记.md")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "MoKnow" })).toBeInTheDocument();
    expect(results.querySelector("mark")?.textContent).toBe("MoKnow");
  });

  it("opens markdown files from the quick open palette", async () => {
    render(<App />);

    await waitFor(() => expect(screen.getByText("2024-06-04-日记.md")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "快速打开文件" }));
    expect(await screen.findByRole("dialog", { name: "快速打开文件" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("命令面板搜索"), { target: { value: "README" } });
    fireEvent.click(await screen.findByRole("button", { name: "快速打开 README.md" }));

    await waitFor(() => expect(screen.getByLabelText("Markdown 源码编辑器")).toHaveValue(mockFiles.readme.raw));
  });

  it("runs editor commands from the command palette", async () => {
    render(<App />);

    await waitFor(() => expect(screen.getByText("2024-06-04-日记.md")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "命令面板" }));
    expect(await screen.findByRole("dialog", { name: "命令面板" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("命令面板搜索"), { target: { value: "双视图" } });
    fireEvent.click(screen.getByRole("button", { name: "执行命令 切换到双视图模式" }));

    expect(await screen.findByTestId("mode-label")).toHaveTextContent("双视图模式");
  });

  it("runs app update checks from the command palette", async () => {
    const info = vi.spyOn(message, "info");

    render(<App />);

    await waitFor(() => expect(screen.getByText("2024-06-04-日记.md")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "命令面板" }));
    fireEvent.change(await screen.findByLabelText("命令面板搜索"), { target: { value: "应用更新" } });
    fireEvent.click(screen.getByRole("button", { name: "执行命令 检查应用更新" }));

    await waitFor(() => expect(info).toHaveBeenCalledWith(expect.objectContaining({
      content: "当前环境不支持自动更新，请在 Tauri 桌面应用中检查更新。",
    })));
  });

  it("captures inbox items and moves them into today's journal", async () => {
    render(<App />);

    await waitFor(() => expect(screen.getByText("2024-06-04-日记.md")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("快速记录内容"), { target: { value: "晚上整理项目进度" } });
    fireEvent.click(screen.getByRole("button", { name: "加入收件箱" }));

    await waitFor(() => expect(screen.getByText("晚上整理项目进度")).toBeInTheDocument());
    const inboxPanel = screen.getByLabelText("收件箱与整理");
    fireEvent.click(within(inboxPanel).getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "整理到今天日记" }));

    await waitFor(() => expect((screen.getByLabelText("Markdown 源码编辑器") as HTMLTextAreaElement).value).toContain("晚上整理项目进度"));
    expect((screen.getByLabelText("Markdown 源码编辑器") as HTMLTextAreaElement).value).toContain("## 收件箱整理");
  });

  it("renames and deletes global tags across markdown files", async () => {
    const originalSource = { ...mockFiles.source };

    try {
      render(<App />);

      const editor = await screen.findByLabelText("Markdown 源码编辑器");

      fireEvent.click(screen.getByRole("button", { name: "编辑全局标签 工作" }));
      fireEvent.change(screen.getByLabelText("工作 全局新标签名"), { target: { value: "事业" } });
      fireEvent.click(screen.getByRole("button", { name: "保存全局标签 工作" }));

      await waitFor(() => expect(screen.getByRole("button", { name: "按标签查看 事业" })).toBeInTheDocument());
      await waitFor(() => expect((editor as HTMLTextAreaElement).value).toContain("tags: [日记, 事业, 生活]"));

      fireEvent.change(screen.getByLabelText("事业 全局标签颜色"), { target: { value: "#56d98e" } });
      fireEvent.click(screen.getByRole("button", { name: "删除全局标签 事业" }));

      await waitFor(() => expect(screen.queryByRole("button", { name: "按标签查看 事业" })).not.toBeInTheDocument());
      await waitFor(() => expect((editor as HTMLTextAreaElement).value).toContain("tags: [日记, 生活]"));
    } finally {
      mockFiles.source = originalSource;
    }
  });

  it("auto-saves dirty markdown after users stop typing", async () => {
    render(<App />);

    await waitFor(() => expect(screen.getByText("2024-06-04-日记.md")).toBeInTheDocument());

    vi.useFakeTimers();
    try {
      fireEvent.change(screen.getByLabelText("Markdown 源码编辑器"), {
        target: { value: "# 自动保存\n\n新的正文" },
      });

      expect(screen.getByText("● 有未保存更改")).toBeInTheDocument();

      await act(async () => {
        vi.advanceTimersByTime(2100);
        await Promise.resolve();
        await Promise.resolve();
      });
      vi.useRealTimers();

      await waitFor(() => expect(screen.getByText("● 已保存")).toBeInTheDocument());
    } finally {
      vi.useRealTimers();
    }
  });

  it("recovers an unsaved local draft when opening the same file", async () => {
    window.localStorage.setItem(
      "moknow:draft:source",
      JSON.stringify({ content: "# 恢复的草稿\n\n还没保存", updatedAt: "2026-06-04T08:00:00.000Z" }),
    );

    try {
      render(<App />);

      const editor = await screen.findByLabelText("Markdown 源码编辑器");

      expect(editor).toHaveValue("# 恢复的草稿\n\n还没保存");
      expect(screen.getByText("● 有未保存更改")).toBeInTheDocument();
    } finally {
      window.localStorage.removeItem("moknow:draft:source");
    }
  });

  it("shows conflict actions and can load the external file version", async () => {
    const originalSource = { ...mockFiles.source };

    try {
      render(<App />);

      const editor = await screen.findByLabelText("Markdown 源码编辑器");
      mockFiles.source = {
        ...mockFiles.source,
        raw: "# 外部版本\n\n来自其它程序",
        modifiedAt: "2099-01-01T00:00:00.000Z",
      };

      fireEvent.change(editor, { target: { value: "# 当前草稿\n\n还没保存" } });
      fireEvent.keyDown(window, { key: "s", ctrlKey: true });

      const dialog = await screen.findByRole("dialog", { name: "检测到外部修改" });
      expect(within(dialog).getByRole("button", { name: "保留当前版本" })).toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: "加载外部版本" })).toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: "另存副本" })).toBeInTheDocument();

      fireEvent.click(within(dialog).getByRole("button", { name: "加载外部版本" }));

      await waitFor(() => expect(screen.getByLabelText("Markdown 源码编辑器")).toHaveValue("# 外部版本\n\n来自其它程序"));
      expect(screen.getByText("● 已保存")).toBeInTheDocument();
    } finally {
      mockFiles.source = originalSource;
      window.localStorage.removeItem("moknow:draft:source");
    }
  });
});

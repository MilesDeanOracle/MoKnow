import { App as AntdApp, ConfigProvider, message, Spin } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { AiCockpit } from "./components/ai/AiCockpit";
import { EditorWorkspace } from "./components/editor/EditorWorkspace";
import { StatusBar } from "./components/layout/StatusBar";
import { TitleBar } from "./components/layout/TitleBar";
import { CreateDocumentModal } from "./components/repository/CreateDocumentModal";
import type { DocumentCreateKind } from "./components/repository/CreateDocumentModal";
import { CreateRepositoryModal } from "./components/repository/CreateRepositoryModal";
import { RepositoryTree } from "./components/repository/RepositoryTree";
import { TauriCommandGateway } from "./services/commandGateway";
import { createMockCommandGateway } from "./services/mockCommandGateway";
import { AiCockpitService } from "./services/aiCockpitService";
import { MarkdownService } from "./services/markdownService";
import { RepositoryService } from "./services/repositoryService";
import { ThemeService } from "./services/themeService";
import type { MarkdownFile, RecentRepository, Repository, ThemeName } from "./types/models";
import "./styles/app.css";

function createCommandGateway() {
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    return new TauriCommandGateway();
  }

  return createMockCommandGateway();
}

function findFirstMarkdownFileId(repository: Repository): string | null {
  const visit = (nodes: Repository["files"]): string | null => {
    for (const node of nodes) {
      if (node.type === "markdown") {
        return node.contentKey ?? node.id;
      }

      const child = node.children ? visit(node.children) : null;
      if (child) return child;
    }

    return null;
  };

  return visit(repository.files);
}

export default function App() {
  const repositoryService = useMemo(() => new RepositoryService(createCommandGateway()), []);
  const markdownService = useMemo(() => new MarkdownService(), []);
  const aiService = useMemo(() => new AiCockpitService(), []);
  const themeService = useMemo(() => new ThemeService(), []);

  const [themeName, setThemeName] = useState<ThemeName>("night");
  const [repository, setRepository] = useState<Repository | null>(null);
  const [currentFile, setCurrentFile] = useState<MarkdownFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [draft, setDraft] = useState("");
  const [recentRepositories, setRecentRepositories] = useState<RecentRepository[]>([]);
  const [createRepositoryOpen, setCreateRepositoryOpen] = useState(false);
  const [createDocumentOpen, setCreateDocumentOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [notification, setNotification] = useState("文件已保存 ✓");
  const [showNotification, setShowNotification] = useState(false);
  const themeResult = useMemo(() => themeService.build(themeService.getPreset(themeName)), [themeName, themeService]);

  const notify = useCallback((message: string) => {
    setNotification(message);
    setShowNotification(true);
    window.clearTimeout(window.__moknowNotifTimer);
    window.__moknowNotifTimer = window.setTimeout(() => setShowNotification(false), 1800);
  }, []);

  const refreshRecentRepositories = useCallback(async () => {
    try {
      const repositories = await repositoryService.listRecentRepositories();
      setRecentRepositories(repositories);
    } catch {
      setRecentRepositories([]);
    }
  }, [repositoryService]);

  const openFirstMarkdownFile = useCallback(
    async (nextRepository: Repository) => {
      const firstFileId = findFirstMarkdownFileId(nextRepository);
      if (!firstFileId) {
        setCurrentFile(null);
        setDraft("");
        setDirty(false);
        return;
      }

      const nextFile = await repositoryService.readFile(firstFileId);
      setCurrentFile(nextFile);
      setDraft(nextFile.raw);
      setDirty(false);
    },
    [repositoryService],
  );

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const nextRepository = await repositoryService.loadRepository();
      setRepository(nextRepository);
      await openFirstMarkdownFile(nextRepository);
      await refreshRecentRepositories();
      setLoading(false);
    };

    void load();
  }, [openFirstMarkdownFile, refreshRecentRepositories, repositoryService]);

  const selectFile = async (fileId: string) => {
    const nextFile = await repositoryService.readFile(fileId);
    setCurrentFile(nextFile);
    setDraft(nextFile.raw);
    setDirty(false);
  };

  const createJournal = async () => {
    if (!repository) return;
    if (repository.isMock) {
      setCreateRepositoryOpen(true);
      message.info("请先新建或打开一个真实仓库");
      return;
    }

    try {
      setActionLoading(true);
      const nextFile = await repositoryService.createJournalEntry(repository.id);
      const nextRepository = await repositoryService.loadRepositoryTree(repository.id);
      setRepository(nextRepository);
      setCurrentFile(nextFile);
      setDraft(nextFile.raw);
      setDirty(false);
      notify("新日记已创建");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "创建日记失败");
    } finally {
      setActionLoading(false);
    }
  };

  const createRepository = async (name: string, basePath: string) => {
    if (!name || !basePath) {
      message.error("请输入仓库名称并选择存放位置");
      return;
    }

    try {
      setActionLoading(true);
      const nextRepository = await repositoryService.createRepository(name, basePath);
      setRepository(nextRepository);
      setCreateRepositoryOpen(false);
      setCurrentFile(null);
      setDraft("");
      await refreshRecentRepositories();
      notify("仓库已创建");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "创建仓库失败");
    } finally {
      setActionLoading(false);
    }
  };

  const openRepository = async (rootPath: string) => {
    try {
      setActionLoading(true);
      const nextRepository = await repositoryService.openRepository(rootPath);
      setRepository(nextRepository);
      await openFirstMarkdownFile(nextRepository);
      await refreshRecentRepositories();
      notify("仓库已切换");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "切换仓库失败");
    } finally {
      setActionLoading(false);
    }
  };

  const createDocument = async (kind: DocumentCreateKind, name: string) => {
    if (!repository || !name) {
      message.error("请输入名称");
      return;
    }

    try {
      setActionLoading(true);
      if (kind === "directory") {
        await repositoryService.createDocumentDirectory(repository.id, "文档", name);
        const nextRepository = await repositoryService.loadRepositoryTree(repository.id);
        setRepository(nextRepository);
      } else {
        const nextFile = await repositoryService.createDocumentFile(repository.id, "文档", name);
        const nextRepository = await repositoryService.loadRepositoryTree(repository.id);
        setRepository(nextRepository);
        setCurrentFile(nextFile);
        setDraft(nextFile.raw);
        setDirty(false);
      }
      setCreateDocumentOpen(false);
      notify("文档已创建");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "创建文档失败");
    } finally {
      setActionLoading(false);
    }
  };

  const save = async () => {
    if (!currentFile) return;
    await repositoryService.saveFile(currentFile.id, draft);
    setDirty(false);
    notify("文件已保存 ✓");
  };

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [save]);

  const wordCount = draft.replace(/\s/g, "").length;

  return (
    <ConfigProvider theme={themeResult.antdTheme}>
      <AntdApp>
          <div className="app-root" data-theme={themeName} style={themeResult.cssVars as CSSProperties}>
          <div className={`notif ${showNotification ? "" : "hidden"}`} id="notif">{notification}</div>
          <TitleBar
            dirty={dirty}
            themeName={themeName}
            onNotify={notify}
            onToggleTheme={() => {
              setThemeName((current) => (current === "night" ? "day" : "night"));
              notify(themeName === "night" ? "已切换到白天主题" : "已切换到黑夜主题");
            }}
          />

          <main className="layout">
            {loading || !repository ? (
              <div className="loading-mask">
                <Spin description="正在加载 MoKnow 仓库..." />
              </div>
            ) : (
              <>
                <RepositoryTree
                  repository={repository}
                  activeFileId={currentFile?.id ?? ""}
                  onSelectFile={(fileId) => void selectFile(fileId)}
                  onCreateJournal={() => void createJournal()}
                  onCreateDocument={() => setCreateDocumentOpen(true)}
                  onCreateRepository={() => setCreateRepositoryOpen(true)}
                  onOpenRepository={(rootPath) => void openRepository(rootPath)}
                  recentRepositories={recentRepositories}
                  repositorySwitching={actionLoading}
                />
                {currentFile ? (
                  <EditorWorkspace
                    file={currentFile}
                    markdownService={markdownService}
                    onDirtyChange={(nextDirty, content) => {
                      setDirty(nextDirty);
                      setDraft(content);
                    }}
                  />
                ) : (
                  <div className="empty-editor">选择或创建一个 Markdown 文件开始记录</div>
                )}
                <AiCockpit
                  aiService={aiService}
                  context={{
                    fileName: currentFile?.name ?? "未选择文件",
                    filePath: currentFile?.path ?? "",
                    repositoryName: repository.name,
                  }}
                />
              </>
            )}
          </main>

          <CreateRepositoryModal
            open={createRepositoryOpen}
            loading={actionLoading}
            onCancel={() => setCreateRepositoryOpen(false)}
            onSubmit={(name, basePath) => void createRepository(name, basePath)}
          />
          <CreateDocumentModal
            open={createDocumentOpen}
            loading={actionLoading}
            parentPath="文档"
            onCancel={() => setCreateDocumentOpen(false)}
            onSubmit={(kind, name) => void createDocument(kind, name)}
          />

          <StatusBar modeLabel="代码模式" repositoryName={repository?.name ?? "MoKnow 日记仓库"} wordCount={wordCount} dirty={dirty} />
        </div>
      </AntdApp>
    </ConfigProvider>
  );
}

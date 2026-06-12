import { App as AntdApp, Button, ConfigProvider, Input, message, Modal, Progress, Spin } from "antd";
import { open as chooseOpenPath, save as chooseSavePath } from "@tauri-apps/plugin-dialog";
import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { AiCockpit } from "./components/ai/AiCockpit";
import { CommandPalette } from "./components/command/CommandPalette";
import type { PaletteCommand } from "./components/command/CommandPalette";
import { InboxPanel } from "./components/inbox/InboxPanel";
import { StatusBar } from "./components/layout/StatusBar";
import { TitleBar } from "./components/layout/TitleBar";
import { MetadataPanel } from "./components/metadata/MetadataPanel";
import { PluginManagerModal } from "./components/plugins/PluginManagerModal";
import { CreateDocumentModal } from "./components/repository/CreateDocumentModal";
import type { DocumentCreateKind } from "./components/repository/CreateDocumentModal";
import { CreateRepositoryModal } from "./components/repository/CreateRepositoryModal";
import { RepositoryTree } from "./components/repository/RepositoryTree";
import { AppLockOverlay } from "./components/security/AppLockOverlay";
import { SearchPanel } from "./components/search/SearchPanel";
import { AppLockSettingsModal } from "./components/settings/AppLockSettingsModal";
import { AppSettingsModal } from "./components/settings/AppSettingsModal";
import { DiarySettingsModal } from "./components/settings/DiarySettingsModal";
import { TauriCommandGateway } from "./services/commandGateway";
import { createMockCommandGateway } from "./services/mockCommandGateway";
import { AiCockpitService } from "./services/aiCockpitService";
import { AiVectorIndexService } from "./services/aiVectorIndexService";
import type { AiVectorIndexProgress } from "./services/aiVectorIndexService";
import {
  appendErrorDiagnostic,
  clearErrorDiagnostics,
  createErrorDiagnostic,
  filterErrorDiagnostics,
  getErrorRecoveryActions,
  loadErrorDiagnostics,
  serializeErrorDiagnostic,
  serializeErrorDiagnosticLog,
} from "./services/appErrorService";
import type { ErrorDiagnostic, ErrorRecoveryAction, ErrorScenario } from "./services/appErrorService";
import { defaultUserSettings, exportUserSettings, importUserSettings, loadUserSettings, resolveScopedUserSettings, saveUserSettings } from "./services/appSettingsService";
import { AppUpdateService } from "./services/appUpdateService";
import {
  createAppLockSettings,
  defaultAppLockSettings,
  loadAppLockSettings,
  resetAppLockPasswordWithRecovery,
  saveAppLockSettings,
  verifyAppLockBiometric,
  verifyAppLockPassword,
} from "./services/appLockService";
import type { AppLockSettings, AppLockSettingsInput } from "./services/appLockService";
import { MarkdownService } from "./services/markdownService";
import { PluginService } from "./services/pluginService";
import type { MarkdownExportEntry } from "./services/markdownService";
import { RepositoryService } from "./services/repositoryService";
import { ThemeService } from "./services/themeService";
import { collectWikiCandidates, extractWikiLinks, normalizeWikiTitle } from "./services/wikiLinkService";
import type { WikiLinkCandidate } from "./services/wikiLinkService";
import type { AiContext, AiContextScope, AiMessage, BackupRestoreStrategy, CursorPosition, DiaryDateStatus, DiarySettings, EditorMode, FileChangeStatus, FileNode, MarkdownFile, OrganizeView, PluginRegistryItem, RecentFile, RecentRepository, Repository, RestorePreviewResult, SearchFilters, SearchResult, TagSummary, ThemeName, UserSettings } from "./types/models";
import "./styles/app.css";

type SaveStatus = "saved" | "dirty" | "saving" | "failed" | "conflict";
type SaveReason = "manual" | "auto";
type ErrorScenarioFilter = ErrorScenario | "all";
type JournalExportMode = "month" | "range";
type JournalExportFormat = "web-html" | "print-html";

interface ExportProgressState {
  label: string;
  percent: number;
}

const EditorWorkspace = lazy(() => import("./components/editor/EditorWorkspace").then((module) => ({
  default: module.EditorWorkspace,
})));

const errorScenarioLabels: Record<ErrorScenarioFilter, string> = {
  all: "全部场景",
  permission: "权限不足",
  missing_path: "目录或文件不存在",
  disk_space: "磁盘空间不足",
  attachment: "附件处理",
  backup: "备份恢复",
  conflict: "外部修改冲突",
  generic: "其他错误",
};

function formatDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function monthRange(date: Date): { from: string; to: string } {
  const firstDay = new Date(date.getFullYear(), date.getMonth(), 1);
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return {
    from: formatDateInput(firstDay),
    to: formatDateInput(lastDay),
  };
}

function weekRange(date: Date): { from: string; to: string } {
  const from = new Date(date);
  from.setDate(date.getDate() - 6);
  return {
    from: formatDateInput(from),
    to: formatDateInput(date),
  };
}

function defaultExportPath(repository: Repository | null, from: string, to: string): string {
  const rootPath = repository?.rootPath || ".";
  const separator = rootPath.includes("\\") ? "\\" : "/";
  const fileName = from === to ? `MoKnow-日记-${from}.html` : `MoKnow-日记-${from}-${to}.html`;
  return `${rootPath}${separator}导出${separator}${fileName}`;
}

function defaultBackupPath(repository: Repository | null): string {
  const rootPath = repository?.rootPath || ".";
  const separator = rootPath.includes("\\") ? "\\" : "/";
  const date = formatDateInput(new Date()).replace(/-/g, "");
  return `${rootPath}${separator}.moknow${separator}backups${separator}MoKnow-backup-${date}.zip`;
}

interface DraftBackup {
  content: string;
  updatedAt: string;
  fileModifiedAt?: string;
}

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

function draftBackupKey(fileId: string) {
  return `moknow:draft:${fileId}`;
}

function clearDraftBackup(fileId: string) {
  window.localStorage.removeItem(draftBackupKey(fileId));
}

function stripSearchHighlight(value: string) {
  return value.replace(/<\/?mark>/g, "");
}

export default function App() {
  const repositoryService = useMemo(() => new RepositoryService(createCommandGateway()), []);
  const aiService = useMemo(() => new AiCockpitService(repositoryService), [repositoryService]);
  const aiVectorIndexService = useMemo(() => new AiVectorIndexService(repositoryService), [repositoryService]);
  const pluginService = useMemo(() => new PluginService(), []);
  const appUpdateService = useMemo(() => new AppUpdateService(), []);
  const themeService = useMemo(() => new ThemeService(), []);

  const [userSettings, setUserSettings] = useState<UserSettings>(defaultUserSettings);
  const [systemPrefersDark, setSystemPrefersDark] = useState(true);
  const [themeName, setThemeName] = useState<ThemeName>("night");
  const [repository, setRepository] = useState<Repository | null>(null);
  const [currentFile, setCurrentFile] = useState<MarkdownFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [draft, setDraft] = useState("");
  const [editorMode, setEditorMode] = useState<EditorMode>("source");
  const [focusMode, setFocusMode] = useState(false);
  const [fullscreenWriting, setFullscreenWriting] = useState(false);
  const [typewriterMode, setTypewriterMode] = useState(false);
  const [lastCursorPosition, setLastCursorPosition] = useState<CursorPosition | null>(null);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const [calendarStatuses, setCalendarStatuses] = useState<DiaryDateStatus[]>([]);
  const [calendarSelectedDate, setCalendarSelectedDate] = useState<string | null>(null);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [recentOpenedFiles, setRecentOpenedFiles] = useState<RecentFile[]>([]);
  const [recentEditedFiles, setRecentEditedFiles] = useState<RecentFile[]>([]);
  const [recentRepositories, setRecentRepositories] = useState<RecentRepository[]>([]);
  const [globalTags, setGlobalTags] = useState<TagSummary[]>([]);
  const [organizeView, setOrganizeView] = useState<OrganizeView | null>(null);
  const [organizeLoading, setOrganizeLoading] = useState(false);
  const [aiIndexProgress, setAiIndexProgress] = useState<AiVectorIndexProgress | null>(null);
  const [searchFilters, setSearchFilters] = useState<SearchFilters>({ fileType: "all" });
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [wikiBacklinks, setWikiBacklinks] = useState<SearchResult[]>([]);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandPaletteMode, setCommandPaletteMode] = useState<"files" | "commands">("files");
  const [commandPaletteQuery, setCommandPaletteQuery] = useState("");
  const [commandPaletteResults, setCommandPaletteResults] = useState<SearchResult[]>([]);
  const [commandPaletteLoading, setCommandPaletteLoading] = useState(false);
  const [createRepositoryOpen, setCreateRepositoryOpen] = useState(false);
  const [createDocumentOpen, setCreateDocumentOpen] = useState(false);
  const [appSettingsOpen, setAppSettingsOpen] = useState(false);
  const [pluginManagerOpen, setPluginManagerOpen] = useState(false);
  const [pluginManifestDraft, setPluginManifestDraft] = useState("");
  const [pluginRegistry, setPluginRegistry] = useState<PluginRegistryItem[]>([]);
  const [diarySettingsOpen, setDiarySettingsOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [backupPath, setBackupPath] = useState("");
  const [backupExcludePrivateData, setBackupExcludePrivateData] = useState(true);
  const [backupProgress, setBackupProgress] = useState<ExportProgressState | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreBackupPath, setRestoreBackupPath] = useState("");
  const [restoreStrategy, setRestoreStrategy] = useState<BackupRestoreStrategy>("replace");
  const [restorePreview, setRestorePreview] = useState<RestorePreviewResult | null>(null);
  const [restoreProgress, setRestoreProgress] = useState<ExportProgressState | null>(null);
  const [journalExportOpen, setJournalExportOpen] = useState(false);
  const [journalExportMode, setJournalExportMode] = useState<JournalExportMode>("month");
  const [journalExportFrom, setJournalExportFrom] = useState(() => monthRange(new Date()).from);
  const [journalExportTo, setJournalExportTo] = useState(() => monthRange(new Date()).to);
  const [journalExportPath, setJournalExportPath] = useState("");
  const [journalExportFormat, setJournalExportFormat] = useState<JournalExportFormat>("web-html");
  const [journalExportIncludeToc, setJournalExportIncludeToc] = useState(true);
  const [journalExportPageBreaks, setJournalExportPageBreaks] = useState(false);
  const [journalExportProgress, setJournalExportProgress] = useState<ExportProgressState | null>(null);
  const [appLockSettingsOpen, setAppLockSettingsOpen] = useState(false);
  const [appLockSettings, setAppLockSettings] = useState<AppLockSettings>(defaultAppLockSettings);
  const [appLocked, setAppLocked] = useState(false);
  const [appLockLoading, setAppLockLoading] = useState(false);
  const [unlockLoading, setUnlockLoading] = useState(false);
  const [unlockError, setUnlockError] = useState("");
  const [diarySettings, setDiarySettings] = useState<DiarySettings | null>(null);
  const [renameTarget, setRenameTarget] = useState<FileNode | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [conflictStatus, setConflictStatus] = useState<FileChangeStatus | null>(null);
  const [conflictLoading, setConflictLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [notification, setNotification] = useState("文件已保存 ✓");
  const [showNotification, setShowNotification] = useState(false);
  const [lastErrorDiagnostic, setLastErrorDiagnostic] = useState<ErrorDiagnostic | null>(null);
  const [errorDiagnostics, setErrorDiagnostics] = useState<ErrorDiagnostic[]>([]);
  const [errorLogOpen, setErrorLogOpen] = useState(false);
  const [errorLogScenario, setErrorLogScenario] = useState<ErrorScenarioFilter>("all");
  const [errorLogQuery, setErrorLogQuery] = useState("");
  const pluginContributions = useMemo(() => pluginService.collectRuntimeContributions(pluginRegistry), [pluginRegistry, pluginService]);
  const officialPlugins = useMemo(() => pluginService.getOfficialPluginCatalog(), [pluginService]);
  const markdownService = useMemo(() => new MarkdownService(pluginContributions.markdownRenderers), [pluginContributions.markdownRenderers]);
  const effectiveUserSettings = useMemo(
    () => resolveScopedUserSettings(userSettings, repository?.id, currentFile?.id),
    [currentFile?.id, repository?.id, userSettings],
  );
  const resolvedTheme = useMemo(
    () => themeService.resolvePreference(effectiveUserSettings, systemPrefersDark, pluginContributions.themes),
    [effectiveUserSettings, pluginContributions.themes, systemPrefersDark, themeService],
  );
  const themeResult = useMemo(() => themeService.build(resolvedTheme.config), [resolvedTheme.config, themeService]);
  const wikiCandidates = useMemo<WikiLinkCandidate[]>(() => (repository ? collectWikiCandidates(repository.files) : []), [repository]);
  const filteredErrorDiagnostics = useMemo(
    () => filterErrorDiagnostics(errorDiagnostics, { scenario: errorLogScenario, query: errorLogQuery }),
    [errorDiagnostics, errorLogQuery, errorLogScenario],
  );

  const notify = useCallback((message: string) => {
    setNotification(message);
    setShowNotification(true);
    window.clearTimeout(window.__moknowNotifTimer);
    window.__moknowNotifTimer = window.setTimeout(() => setShowNotification(false), 1800);
  }, []);

  const reportError = useCallback(
    (error: unknown, fallbackMessage: string, operation: string, notificationPrefix?: string) => {
      const diagnostic = createErrorDiagnostic(error, fallbackMessage, {
        operation,
        repositoryName: repository?.name,
        repositoryId: repository?.id,
        fileName: currentFile?.name,
        fileId: currentFile?.id,
      });
      setLastErrorDiagnostic(diagnostic);
      setErrorDiagnostics(appendErrorDiagnostic(diagnostic));
      message.error(`${diagnostic.message}\n${diagnostic.suggestion}`);
      if (notificationPrefix) {
        notify(`${notificationPrefix}：${diagnostic.message}`);
      }
      return diagnostic.message;
    },
    [currentFile, notify, repository],
  );

  const copyLastErrorDiagnostic = useCallback(async () => {
    if (!lastErrorDiagnostic) {
      message.info("暂无错误诊断信息");
      return;
    }

    try {
      await navigator.clipboard.writeText(serializeErrorDiagnostic(lastErrorDiagnostic));
      notify("错误诊断已复制");
    } catch {
      message.error("复制诊断信息失败，请检查剪贴板权限");
    }
  }, [lastErrorDiagnostic, notify]);

  const openErrorLog = useCallback(() => {
    setErrorDiagnostics(loadErrorDiagnostics());
    setErrorLogOpen(true);
  }, []);

  const clearErrorLog = useCallback(() => {
    clearErrorDiagnostics();
    setErrorDiagnostics([]);
    setLastErrorDiagnostic(null);
    setErrorLogScenario("all");
    setErrorLogQuery("");
    notify("错误日志已清空");
  }, [notify]);

  const exportFilteredErrorLog = useCallback(() => {
    if (!filteredErrorDiagnostics.length) {
      message.info("没有可导出的错误日志");
      return;
    }

    const content = serializeErrorDiagnosticLog(filteredErrorDiagnostics);
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `moknow-error-log-${new Date().toISOString().slice(0, 10)}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
    notify("错误日志已导出");
  }, [filteredErrorDiagnostics, notify]);

  useEffect(() => {
    const nextSettings = loadUserSettings();
    setUserSettings(nextSettings);
  }, []);

  useEffect(() => {
    setPluginRegistry(pluginService.loadRegistry());
  }, [pluginService]);

  useEffect(() => {
    const diagnostics = loadErrorDiagnostics();
    setErrorDiagnostics(diagnostics);
    setLastErrorDiagnostic(diagnostics[0] ?? null);
  }, []);

  useEffect(() => {
    setThemeName(resolvedTheme.name);
  }, [resolvedTheme.name]);

  useEffect(() => {
    const matcher = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!matcher) return;

    const updateSystemPreference = () => setSystemPrefersDark(matcher.matches);
    updateSystemPreference();
    matcher.addEventListener?.("change", updateSystemPreference);
    return () => matcher.removeEventListener?.("change", updateSystemPreference);
  }, []);

  useEffect(() => {
    const settings = loadAppLockSettings();
    setAppLockSettings(settings);
    setAppLocked(settings.enabled);
  }, []);

  useEffect(() => {
    if (!dirty && saveStatus !== "saving") {
      setSaveStatus("saved");
    }
  }, [dirty, saveStatus]);

  useEffect(() => {
    const syncFullscreenState = () => {
      setFullscreenWriting(Boolean(document.fullscreenElement));
    };

    document.addEventListener("fullscreenchange", syncFullscreenState);
    return () => document.removeEventListener("fullscreenchange", syncFullscreenState);
  }, []);

  const recoverDraftBackup = useCallback(
    (file: MarkdownFile): { file: MarkdownFile; recovered: boolean } => {
      if (typeof window === "undefined") return { file, recovered: false };

      try {
        const rawBackup = window.localStorage.getItem(draftBackupKey(file.id));
        if (!rawBackup) return { file, recovered: false };

        const backup = JSON.parse(rawBackup) as DraftBackup;
        if (!backup.content || backup.content === file.raw) {
          return { file, recovered: false };
        }

        notify("已恢复上次未保存草稿");
        return { file: { ...file, raw: backup.content }, recovered: true };
      } catch {
        return { file, recovered: false };
      }
    },
    [notify],
  );

  const loadFileIntoEditor = useCallback(
    (file: MarkdownFile, cursorPosition: CursorPosition | null = null) => {
      const recovered = recoverDraftBackup(file);
      setCurrentFile(recovered.file);
      setDraft(recovered.file.raw);
      setLastCursorPosition(cursorPosition);
      setDirty(recovered.recovered);
      setSaveStatus(recovered.recovered ? "dirty" : "saved");
      return recovered.file;
    },
    [recoverDraftBackup],
  );

  useEffect(() => {
    if (!currentFile || !dirty) return;

    const backup: DraftBackup = {
      content: draft,
      updatedAt: new Date().toISOString(),
      fileModifiedAt: currentFile.modifiedAt,
    };
    window.localStorage.setItem(draftBackupKey(currentFile.id), JSON.stringify(backup));
  }, [currentFile, dirty, draft]);

  const refreshRecentRepositories = useCallback(async () => {
    try {
      const repositories = await repositoryService.listRecentRepositories();
      setRecentRepositories(repositories);
    } catch {
      setRecentRepositories([]);
    }
  }, [repositoryService]);

  const refreshRecentFiles = useCallback(
    async (nextRepository: Repository | null) => {
      if (!nextRepository) {
        setRecentOpenedFiles([]);
        setRecentEditedFiles([]);
        return;
      }

      try {
        const [opened, edited] = await Promise.all([
          repositoryService.listRecentFiles(nextRepository.id, "opened"),
          repositoryService.listRecentFiles(nextRepository.id, "edited"),
        ]);
        setRecentOpenedFiles(opened);
        setRecentEditedFiles(edited);
      } catch {
        setRecentOpenedFiles([]);
        setRecentEditedFiles([]);
      }
    },
    [repositoryService],
  );

  const refreshTags = useCallback(
    async (nextRepository: Repository | null) => {
      if (!nextRepository) {
        setGlobalTags([]);
        return;
      }

      try {
        const tags = await repositoryService.listTags(nextRepository.id);
        setGlobalTags(tags);
      } catch {
        setGlobalTags([]);
      }
    },
    [repositoryService],
  );

  const refreshOrganizeView = useCallback(
    async (nextRepository: Repository | null = repository) => {
      if (!nextRepository) {
        setOrganizeView(null);
        return;
      }

      try {
        setOrganizeLoading(true);
        const view = await repositoryService.listOrganizeView(nextRepository.id);
        setOrganizeView(view);
      } catch {
        setOrganizeView(null);
      } finally {
        setOrganizeLoading(false);
      }
    },
    [repository, repositoryService],
  );

  useEffect(() => {
    void refreshOrganizeView(repository);
  }, [refreshOrganizeView, repository]);

  const runSearch = useCallback(
    async (filters: SearchFilters = searchFilters) => {
      if (!repository) {
        setSearchResults([]);
        return;
      }

      try {
        setSearchLoading(true);
        const results = await repositoryService.searchFiles(repository.id, filters);
        setSearchResults(results);
        const query = filters.query?.trim();
        if (query) {
          setSearchHistory((current) => [query, ...current.filter((item) => item !== query)].slice(0, 5));
        }
      } catch (error) {
        setSearchResults([]);
        reportError(error, "搜索失败", "搜索文件");
      } finally {
        setSearchLoading(false);
      }
    },
    [reportError, repository, repositoryService, searchFilters],
  );

  const selectSearchTag = (tag: string) => {
    const nextFilters: SearchFilters = { ...searchFilters, tag };
    setSearchFilters(nextFilters);
    void runSearch(nextFilters);
  };

  const selectSearchHistory = (query: string) => {
    const nextFilters: SearchFilters = { ...searchFilters, query };
    setSearchFilters(nextFilters);
    void runSearch(nextFilters);
  };

  const searchCommandPaletteFiles = useCallback(
    async (query: string) => {
      if (!repository) {
        setCommandPaletteResults([]);
        return;
      }

      try {
        setCommandPaletteLoading(true);
        const results = await repositoryService.searchFiles(repository.id, { query, fileType: "all" });
        setCommandPaletteResults(results);
      } catch {
        setCommandPaletteResults([]);
      } finally {
        setCommandPaletteLoading(false);
      }
    },
    [repository, repositoryService],
  );

  const openCommandPalette = (mode: "files" | "commands") => {
    setCommandPaletteMode(mode);
    setCommandPaletteQuery("");
    setCommandPaletteOpen(true);
    if (mode === "files") void searchCommandPaletteFiles("");
  };

  const changeCommandPaletteQuery = (query: string) => {
    setCommandPaletteQuery(query);
    if (commandPaletteMode === "files") void searchCommandPaletteFiles(query);
  };

  const openCommandPaletteFile = async (fileId: string) => {
    setCommandPaletteOpen(false);
    await selectFile(fileId);
  };

  const checkForAppUpdate = async () => {
    const messageKey = "app-update-check";
    message.loading({ key: messageKey, content: "正在检查更新..." });
    try {
      const result = await appUpdateService.checkForUpdate();
      if (result.status !== "available") {
        message.info({ key: messageKey, content: result.message });
        return;
      }

      message.destroy(messageKey);
      Modal.confirm({
        title: `发现新版本 ${result.version}`,
        content: result.body || "是否现在下载并安装更新？安装完成后请重新打开 MoKnow。",
        okText: "下载并安装",
        cancelText: "稍后",
        onOk: async () => {
          message.loading({ key: messageKey, content: "正在下载并安装更新..." });
          await result.install();
          message.success({ key: messageKey, content: "更新已安装，请重新启动 MoKnow。" });
        },
      });
    } catch (error) {
      message.error({ key: messageKey, content: error instanceof Error ? error.message : "检查更新失败" });
    }
  };

  const reloadCurrentFileAfterTagChange = async () => {
    if (!currentFile || dirty) return;
    try {
      const nextFile = await repositoryService.readFile(currentFile.id);
      loadFileIntoEditor(nextFile, lastCursorPosition);
    } catch {
      // 文件被移动或删除时让后续文件树刷新处理，不打断标签操作。
    }
  };

  const setGlobalTagColor = async (tag: string, color: string) => {
    if (!repository) return;
    try {
      const tags = await repositoryService.setTagColor(repository.id, tag, color);
      setGlobalTags(tags);
      notify("标签颜色已更新");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "更新标签颜色失败");
    }
  };

  const renameGlobalTag = async (oldName: string, newName: string) => {
    if (!repository) return;
    try {
      const tags = await repositoryService.renameTag(repository.id, oldName, newName);
      setGlobalTags(tags);
      const nextFilters = searchFilters.tag === oldName ? { ...searchFilters, tag: newName } : searchFilters;
      setSearchFilters(nextFilters);
      await reloadCurrentFileAfterTagChange();
      await runSearch(nextFilters);
      notify("标签已跨文档改名");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "重命名标签失败");
    }
  };

  const deleteGlobalTag = async (tag: string) => {
    if (!repository) return;
    try {
      const tags = await repositoryService.deleteTag(repository.id, tag);
      setGlobalTags(tags);
      const nextFilters = searchFilters.tag === tag ? { ...searchFilters, tag: undefined } : searchFilters;
      setSearchFilters(nextFilters);
      await reloadCurrentFileAfterTagChange();
      await runSearch(nextFilters);
      notify("标签已从所有文档移除");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "删除标签失败");
    }
  };

  const loadDiarySettings = useCallback(async (): Promise<DiarySettings | null> => {
    try {
      const settings = await repositoryService.getDiarySettings();
      setDiarySettings(settings);
      return settings;
    } catch {
      return null;
    }
  }, [repositoryService]);

  const refreshCalendarStatus = useCallback(
    async (nextRepository: Repository | null, month: Date) => {
      if (!nextRepository) {
        setCalendarStatuses([]);
        return;
      }

      try {
        setCalendarLoading(true);
        const statuses = await repositoryService.listDiaryMonthStatus(nextRepository.id, month.getFullYear(), month.getMonth() + 1);
        setCalendarStatuses(statuses);
      } catch {
        setCalendarStatuses([]);
      } finally {
        setCalendarLoading(false);
      }
    },
    [repositoryService],
  );

  const openFirstMarkdownFile = useCallback(
    async (nextRepository: Repository): Promise<MarkdownFile | null> => {
      const firstFileId = findFirstMarkdownFileId(nextRepository);
      if (!firstFileId) {
        setCurrentFile(null);
        setDraft("");
        setLastCursorPosition(null);
        setDirty(false);
        setSaveStatus("saved");
        return null;
      }

      const nextFile = await repositoryService.readFile(firstFileId);
      return loadFileIntoEditor(nextFile);
    },
    [loadFileIntoEditor, repositoryService],
  );

  const persistWorkspaceState = useCallback(
    async (nextRepository: Repository | null, fileId: string | null, mode: EditorMode, cursorPosition?: CursorPosition | null) => {
      if (!nextRepository || nextRepository.isMock) return;

      try {
        await repositoryService.saveWorkspaceState(nextRepository.id, fileId, mode, cursorPosition);
      } catch {
        // 工作区状态不影响正文读写，失败时静默降级。
      }
    },
    [repositoryService],
  );

  const openStartupFile = useCallback(
    async (nextRepository: Repository): Promise<Repository> => {
      if (nextRepository.isMock) {
        await openFirstMarkdownFile(nextRepository);
        return nextRepository;
      }

      const workspaceState = await repositoryService.getWorkspaceState(nextRepository.id);
      const restoredMode = workspaceState.lastEditMode ?? "source";
      setEditorMode(restoredMode);

      if (workspaceState.autoOpenToday) {
        const todayFile = await repositoryService.openTodayJournal(nextRepository.id);
        const refreshedRepository = await repositoryService.loadRepositoryTree(nextRepository.id);
        const restoredCursor = workspaceState.lastOpenedFile === todayFile.id ? workspaceState.lastCursorPosition ?? null : null;
        loadFileIntoEditor(todayFile, restoredCursor);
        await persistWorkspaceState(refreshedRepository, todayFile.id, restoredMode, restoredCursor);
        return refreshedRepository;
      }

      if (workspaceState.lastOpenedFile) {
        try {
          const restoredFile = await repositoryService.readFile(workspaceState.lastOpenedFile);
          loadFileIntoEditor(restoredFile, workspaceState.lastCursorPosition ?? null);
          return nextRepository;
        } catch {
          // 上次文件不存在时回退到第一个 Markdown。
        }
      }

      const firstFile = await openFirstMarkdownFile(nextRepository);
      await persistWorkspaceState(nextRepository, firstFile?.id ?? null, restoredMode, null);
      return nextRepository;
    },
    [loadFileIntoEditor, openFirstMarkdownFile, persistWorkspaceState, repositoryService],
  );

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await loadDiarySettings();
      const nextRepository = await repositoryService.loadRepository();
      const hydratedRepository = await openStartupFile(nextRepository);
      setRepository(hydratedRepository);
      await refreshCalendarStatus(hydratedRepository, new Date());
      await refreshRecentFiles(hydratedRepository);
      await refreshRecentRepositories();
      await refreshTags(hydratedRepository);
      setLoading(false);
    };

    void load();
  }, [loadDiarySettings, openStartupFile, refreshCalendarStatus, refreshRecentFiles, refreshRecentRepositories, refreshTags, repositoryService]);

  useEffect(() => {
    if (!repository || loading) return;
    void refreshCalendarStatus(repository, calendarMonth);
  }, [calendarMonth, loading, refreshCalendarStatus, repository]);

  const selectFile = async (fileId: string) => {
    const nextFile = await repositoryService.readFile(fileId);
    loadFileIntoEditor(nextFile);
    await persistWorkspaceState(repository, nextFile.id, editorMode, null);
    await refreshRecentFiles(repository);
  };

  const refreshWikiBacklinks = useCallback(
    async (nextRepository: Repository | null = repository, nextFile: MarkdownFile | null = currentFile) => {
      if (!nextRepository || !nextFile) {
        setWikiBacklinks([]);
        return;
      }

      const currentTitle = normalizeWikiTitle(nextFile.name);
      const uniqueCandidates = new Map<string, WikiLinkCandidate>();
      for (const candidate of collectWikiCandidates(nextRepository.files)) {
        if (candidate.fileId !== nextFile.id && !uniqueCandidates.has(candidate.fileId)) {
          uniqueCandidates.set(candidate.fileId, candidate);
        }
      }

      const backlinks: SearchResult[] = [];
      await Promise.all(Array.from(uniqueCandidates.values()).map(async (candidate) => {
        try {
          const file = await repositoryService.readFile(candidate.fileId);
          const links = extractWikiLinks(file.raw).map(normalizeWikiTitle);
          if (!links.includes(currentTitle)) return;

          backlinks.push({
            fileId: candidate.fileId,
            name: candidate.fileName,
            relativePath: candidate.path,
            snippet: `包含 [[${nextFile.name.replace(/\.md$/i, "")}]]`,
            highlightedSnippet: `包含 <mark>[[${nextFile.name.replace(/\.md$/i, "")}]]</mark>`,
            tags: [],
            score: 1,
          });
        } catch {
          // 单个文件读取失败不影响其它反向链接。
        }
      }));

      backlinks.sort((first, second) => first.name.localeCompare(second.name, "zh-CN"));
      setWikiBacklinks(backlinks);
    },
    [currentFile, repository, repositoryService],
  );

  useEffect(() => {
    void refreshWikiBacklinks(repository, currentFile);
  }, [currentFile, refreshWikiBacklinks, repository]);

  const openWikiLink = async (title: string) => {
    const targetTitle = normalizeWikiTitle(title);
    const target = wikiCandidates.find((candidate) => normalizeWikiTitle(candidate.title) === targetTitle);
    if (!target) {
      message.warning(`未找到双链目标：${title}`);
      return;
    }

    await selectFile(target.fileId);
    notify(`已打开双链：${target.title}`);
  };

  const addInboxEntry = async (content: string) => {
    if (!repository) return;
    try {
      await repositoryService.appendInboxEntry(repository.id, content);
      await refreshOrganizeView(repository);
      notify("已加入收件箱");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "写入收件箱失败");
    }
  };

  const clearInboxEntries = async (entryIds: string[]) => {
    if (!repository) return;
    try {
      await repositoryService.clearInboxEntries(repository.id, entryIds);
      await refreshOrganizeView(repository);
      notify(entryIds.length ? "已清空选中记录" : "收件箱已清空");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "清空收件箱失败");
    }
  };

  const moveInboxEntriesToToday = async (entryIds: string[]) => {
    if (!repository) return;
    try {
      const nextFile = await repositoryService.moveInboxEntriesToToday(repository.id, entryIds);
      const nextRepository = await repositoryService.loadRepositoryTree(repository.id);
      setRepository(nextRepository);
      await refreshCalendarStatus(nextRepository, calendarMonth);
      await refreshRecentFiles(nextRepository);
      await refreshTags(nextRepository);
      await refreshOrganizeView(nextRepository);
      loadFileIntoEditor(nextFile);
      await persistWorkspaceState(nextRepository, nextFile.id, editorMode, null);
      notify("已整理到今日日记");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "整理到今日日记失败");
    }
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
      await refreshCalendarStatus(nextRepository, calendarMonth);
      await refreshRecentFiles(nextRepository);
      await refreshTags(nextRepository);
      loadFileIntoEditor(nextFile);
      await persistWorkspaceState(nextRepository, nextFile.id, editorMode, null);
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
      const hydratedRepository = await openStartupFile(nextRepository);
      setRepository(hydratedRepository);
      await refreshCalendarStatus(hydratedRepository, calendarMonth);
      await refreshRecentFiles(hydratedRepository);
      await refreshTags(hydratedRepository);
      setCreateRepositoryOpen(false);
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
      const hydratedRepository = await openStartupFile(nextRepository);
      setRepository(hydratedRepository);
      await refreshCalendarStatus(hydratedRepository, calendarMonth);
      await refreshRecentFiles(hydratedRepository);
      await refreshTags(hydratedRepository);
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
        await refreshTags(nextRepository);
      } else {
        const nextFile = await repositoryService.createDocumentFile(repository.id, "文档", name);
        const nextRepository = await repositoryService.loadRepositoryTree(repository.id);
        setRepository(nextRepository);
        await refreshTags(nextRepository);
        loadFileIntoEditor(nextFile);
        await persistWorkspaceState(nextRepository, nextFile.id, editorMode, null);
      }
      setCreateDocumentOpen(false);
      notify("文档已创建");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "创建文档失败");
    } finally {
      setActionLoading(false);
    }
  };

  const openCalendarDate = async (date: string) => {
    if (!repository) return;

    try {
      setActionLoading(true);
      const nextFile = await repositoryService.openJournalByDate(repository.id, date);
      const nextRepository = await repositoryService.loadRepositoryTree(repository.id);
      setRepository(nextRepository);
      await refreshRecentFiles(nextRepository);
      loadFileIntoEditor(nextFile);
      setCalendarSelectedDate(date);
      await persistWorkspaceState(nextRepository, nextFile.id, editorMode, null);
      await refreshCalendarStatus(nextRepository, calendarMonth);
      await refreshRecentFiles(nextRepository);
      await refreshTags(nextRepository);
      notify("日记已打开");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "打开日记失败");
    } finally {
      setActionLoading(false);
    }
  };

  const openDiarySettings = async () => {
    setDiarySettingsOpen(true);
    if (!diarySettings) {
      setSettingsLoading(true);
      await loadDiarySettings();
      setSettingsLoading(false);
    }
  };

  const lockApplication = useCallback(() => {
    if (!appLockSettings.enabled) return;
    setCommandPaletteOpen(false);
    setCreateRepositoryOpen(false);
    setCreateDocumentOpen(false);
    setDiarySettingsOpen(false);
    setAppLockSettingsOpen(false);
    setRenameTarget(null);
    setConflictStatus(null);
    setUnlockError("");
    setAppLocked(true);
  }, [appLockSettings.enabled]);

  const lockNow = () => {
    if (!appLockSettings.enabled) {
      message.info("请先启用应用锁");
      setAppLockSettingsOpen(true);
      return;
    }

    lockApplication();
    notify("应用已锁定");
  };

  const unlockApplication = async (password: string) => {
    if (!password.trim()) {
      setUnlockError("请输入解锁密码");
      return;
    }

    try {
      setUnlockLoading(true);
      const unlocked = await verifyAppLockPassword(appLockSettings, password, repositoryService);
      if (!unlocked) {
        setUnlockError("密码不正确");
        return;
      }

      setUnlockError("");
      setAppLocked(false);
      notify("应用已解锁");
    } finally {
      setUnlockLoading(false);
    }
  };

  const showRecoveryCodeNotice = (recoveryCode?: string) => {
    if (!recoveryCode) return;
    Modal.info({
      title: "应用锁恢复码",
      content: (
        <div className="app-lock-recovery-notice">
          <p>请把这个恢复码保存到安全位置。忘记应用锁密码时，可用它重置密码；关闭本窗口后不会再次显示。</p>
          <code>{recoveryCode}</code>
        </div>
      ),
      okText: "我已保存",
      transitionName: "",
      maskTransitionName: "",
    });
  };

  const unlockWithBiometric = async () => {
    try {
      setUnlockLoading(true);
      const unlocked = await verifyAppLockBiometric(appLockSettings);
      if (!unlocked) {
        setUnlockError("生物识别解锁未完成");
        return;
      }

      setUnlockError("");
      setAppLocked(false);
      notify("应用已解锁");
    } catch (error) {
      setUnlockError(error instanceof Error ? error.message : "生物识别解锁失败");
    } finally {
      setUnlockLoading(false);
    }
  };

  const resetLockPassword = async ({ recoveryCode, newPassword }: { recoveryCode: string; newPassword: string }) => {
    try {
      setUnlockLoading(true);
      const nextSettings = await resetAppLockPasswordWithRecovery(appLockSettings, recoveryCode, newPassword, repositoryService);
      saveAppLockSettings(nextSettings);
      setAppLockSettings(nextSettings);
      setUnlockError("");
      setAppLocked(false);
      showRecoveryCodeNotice(nextSettings.pendingRecoveryCode);
      notify("应用锁密码已重置");
    } catch (error) {
      setUnlockError(error instanceof Error ? error.message : "应用锁密码重置失败");
    } finally {
      setUnlockLoading(false);
    }
  };

  const saveLockSettings = async (settingsInput: AppLockSettingsInput) => {
    try {
      setAppLockLoading(true);
      const nextSettings = await createAppLockSettings(settingsInput, appLockSettings, repositoryService);
      saveAppLockSettings(nextSettings);
      setAppLockSettings(nextSettings);
      setAppLockSettingsOpen(false);
      if (!nextSettings.enabled) {
        setAppLocked(false);
      }
      showRecoveryCodeNotice(nextSettings.pendingRecoveryCode);
      notify(nextSettings.enabled ? "应用锁设置已保存" : "应用锁已关闭");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "保存应用锁设置失败");
    } finally {
      setAppLockLoading(false);
    }
  };

  const saveGeneralSettings = async (settings: UserSettings) => {
    try {
      setSettingsLoading(true);
      const savedSettings = saveUserSettings(settings);
      setUserSettings(savedSettings);
      setAppSettingsOpen(false);
      notify("设置已保存");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "保存设置失败");
    } finally {
      setSettingsLoading(false);
    }
  };

  const exportSettingsFile = (settings: UserSettings) => {
    try {
      const content = exportUserSettings(settings);
      const blob = new Blob([content], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `moknow-settings-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      notify("设置已导出");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "导出设置失败");
    }
  };

  const importSettingsJson = (json: string) => {
    try {
      const importedSettings = importUserSettings(json);
      const savedSettings = saveUserSettings(importedSettings);
      setUserSettings(savedSettings);
      notify("设置已导入");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "导入设置失败，请检查 JSON 文件");
    }
  };

  const installPluginManifest = () => {
    try {
      const nextRegistry = pluginService.installManifest(pluginManifestDraft, pluginRegistry);
      setPluginRegistry(nextRegistry);
      setPluginManifestDraft("");
      notify("插件 manifest 已安装");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "安装插件 manifest 失败");
    }
  };

  const installOfficialPlugin = (pluginId: string) => {
    try {
      const nextRegistry = pluginService.installOfficialPlugin(pluginId, pluginRegistry);
      setPluginRegistry(nextRegistry);
      notify("官方插件已安装");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "安装官方插件失败");
    }
  };

  const togglePluginEnabled = async (pluginId: string, enabled: boolean) => {
    const target = pluginRegistry.find((plugin) => plugin.manifest.id === pluginId);
    if (!target) return;

    const nextRegistry = enabled
      ? await pluginService.activatePluginInSandbox(target, pluginRegistry)
      : pluginService.setPluginEnabled(pluginId, false, pluginRegistry);
    setPluginRegistry(nextRegistry);
    const nextPlugin = nextRegistry.find((plugin) => plugin.manifest.id === pluginId);
    if (enabled && nextPlugin?.status === "failed") {
      message.error(nextPlugin.error ?? "插件启用失败");
      return;
    }
    notify(enabled ? "插件已启用" : "插件已停用");
  };

  const removePlugin = (pluginId: string) => {
    const nextRegistry = pluginService.removePlugin(pluginId, pluginRegistry);
    setPluginRegistry(nextRegistry);
    notify("插件已移除");
  };

  const toggleThemePreference = () => {
    setUserSettings((current) => {
      const nextSettings = saveUserSettings({
        ...current,
        themePreference: themeService.nextPreference(themeName),
      });
      notify(nextSettings.themePreference === "day" ? "已切换到白天主题" : "已切换到黑夜主题");
      return nextSettings;
    });
  };

  useEffect(() => {
    if (!appLockSettings.enabled || appLocked || !appLockSettings.lockOnBlur) return;

    const lockWhenHidden = () => {
      if (document.visibilityState === "hidden") {
        lockApplication();
      }
    };
    const lockWhenBlurred = () => {
      window.setTimeout(() => lockApplication(), 0);
    };

    document.addEventListener("visibilitychange", lockWhenHidden);
    window.addEventListener("blur", lockWhenBlurred);
    return () => {
      document.removeEventListener("visibilitychange", lockWhenHidden);
      window.removeEventListener("blur", lockWhenBlurred);
    };
  }, [appLocked, appLockSettings.enabled, appLockSettings.lockOnBlur, lockApplication]);

  useEffect(() => {
    if (!appLockSettings.enabled || appLocked) return;

    const resetIdleTimer = () => {
      window.clearTimeout(window.__moknowLockTimer);
      window.__moknowLockTimer = window.setTimeout(() => lockApplication(), appLockSettings.idleMinutes * 60_000);
    };
    const events = ["keydown", "mousedown", "mousemove", "touchstart", "scroll"];

    resetIdleTimer();
    events.forEach((eventName) => window.addEventListener(eventName, resetIdleTimer, { passive: true }));
    return () => {
      window.clearTimeout(window.__moknowLockTimer);
      events.forEach((eventName) => window.removeEventListener(eventName, resetIdleTimer));
    };
  }, [appLocked, appLockSettings.enabled, appLockSettings.idleMinutes, lockApplication]);

  const saveDiarySettings = async (settings: DiarySettings) => {
    try {
      setSettingsLoading(true);
      const savedSettings = await repositoryService.saveDiarySettings(settings);
      setDiarySettings(savedSettings);
      setDiarySettingsOpen(false);

      if (repository && !repository.isMock && savedSettings.autoOpenToday) {
        const todayFile = await repositoryService.openTodayJournal(repository.id);
        const nextRepository = await repositoryService.loadRepositoryTree(repository.id);
        setRepository(nextRepository);
        await refreshCalendarStatus(nextRepository, calendarMonth);
        await refreshRecentFiles(nextRepository);
        await refreshTags(nextRepository);
        loadFileIntoEditor(todayFile);
        await persistWorkspaceState(nextRepository, todayFile.id, editorMode, null);
      }

      notify("日记设置已保存");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "保存日记设置失败");
    } finally {
      setSettingsLoading(false);
    }
  };

  const save = useCallback(
    async (reason: SaveReason = "manual", options: { skipConflictCheck?: boolean } = {}): Promise<boolean> => {
      if (!currentFile || !dirty) return true;

      try {
        setSaveStatus("saving");
        if (currentFile.modifiedAt && !options.skipConflictCheck) {
          const changeStatus = await repositoryService.checkFileChanged(currentFile.id, currentFile.modifiedAt);
          if (changeStatus.changed) {
            setSaveStatus("conflict");
            setConflictStatus(changeStatus);
            const text = "检测到文件已被外部修改，已暂停保存";
            message.warning(text);
            notify(text);
            return false;
          }
        }

        const saveResult = await repositoryService.saveFile(currentFile.id, draft);
        setCurrentFile((file) => file ? { ...file, raw: draft, modifiedAt: saveResult.modifiedAt ?? file.modifiedAt } : file);
        clearDraftBackup(currentFile.id);
        setConflictStatus(null);
        setDirty(false);
        setSaveStatus("saved");
        await persistWorkspaceState(repository, currentFile.id, editorMode, lastCursorPosition);
        await refreshRecentFiles(repository);
        await refreshTags(repository);
        if (searchResults.length) {
          void runSearch();
        }
        notify(reason === "auto" ? "已自动保存" : "文件已保存 ✓");
        return true;
      } catch (error) {
        setSaveStatus("failed");
        reportError(error, "保存文件失败", "保存当前文件", "保存失败");
        return false;
      }
    },
    [currentFile, dirty, draft, editorMode, lastCursorPosition, notify, persistWorkspaceState, refreshRecentFiles, refreshTags, reportError, repository, repositoryService, runSearch, searchResults.length],
  );

  const overwriteWithCurrentDraft = async () => {
    if (!currentFile) return;

    try {
      setConflictLoading(true);
      const saved = await save("manual", { skipConflictCheck: true });
      if (saved) {
        setConflictStatus(null);
        notify("已用当前内容覆盖磁盘版本");
      }
    } finally {
      setConflictLoading(false);
    }
  };

  const loadExternalVersion = async () => {
    if (!currentFile) return;

    try {
      setConflictLoading(true);
      const externalFile = await repositoryService.readFile(currentFile.id);
      clearDraftBackup(currentFile.id);
      loadFileIntoEditor(externalFile);
      setConflictStatus(null);
      await refreshRecentFiles(repository);
      await persistWorkspaceState(repository, externalFile.id, editorMode, lastCursorPosition);
      notify("已加载外部版本");
    } catch (error) {
      const text = error instanceof Error ? error.message : "加载外部版本失败";
      message.error(text);
      notify(`加载外部版本失败：${text}`);
    } finally {
      setConflictLoading(false);
    }
  };

  const saveCurrentDraftAsCopy = async () => {
    if (!currentFile) return;

    try {
      setConflictLoading(true);
      const originalFileId = currentFile.id;
      const copyFile = await repositoryService.saveFileAsCopy(currentFile.id, draft);
      clearDraftBackup(originalFileId);
      loadFileIntoEditor(copyFile);
      setConflictStatus(null);
      if (repository) {
        const nextRepository = await repositoryService.loadRepositoryTree(repository.id);
        setRepository(nextRepository);
        await refreshRecentFiles(nextRepository);
        await refreshCalendarStatus(nextRepository, calendarMonth);
        await refreshTags(nextRepository);
        await persistWorkspaceState(nextRepository, copyFile.id, editorMode, lastCursorPosition);
      }
      notify("已另存为副本");
    } catch (error) {
      const text = error instanceof Error ? error.message : "另存副本失败";
      message.error(text);
      notify(`另存副本失败：${text}`);
    } finally {
      setConflictLoading(false);
    }
  };

  const clearRecentFiles = async (listKind: "opened" | "edited") => {
    if (!repository) return;

    try {
      await repositoryService.clearRecentFiles(repository.id, listKind);
      await refreshRecentFiles(repository);
      notify(listKind === "opened" ? "最近打开已清空" : "最近编辑已清空");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "清空最近文件失败");
    }
  };

  const toggleFavorite = async (node: FileNode) => {
    if (!repository) return;

    try {
      const nextRepository = node.isFavorite
        ? await repositoryService.removeFavorite(repository.id, node.path)
        : await repositoryService.addFavorite(repository.id, node.path, node.type === "directory" ? "directory" : "markdown");
      setRepository(nextRepository);
      notify(node.isFavorite ? "已取消收藏" : "已添加收藏");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "更新收藏失败");
    }
  };

  const togglePinned = async (node: FileNode) => {
    if (!repository) return;

    try {
      const nextRepository = await repositoryService.setFilePinned(repository.id, node.path, !node.isPinned);
      setRepository(nextRepository);
      await refreshRecentFiles(nextRepository);
      notify(node.isPinned ? "已取消置顶" : "已置顶");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "更新置顶失败");
    }
  };

  const moveNodeToTrash = async (node: FileNode) => {
    if (!repository) return;

    try {
      const nextRepository = await repositoryService.moveToTrash(repository.id, node.path);
      setRepository(nextRepository);
      if (currentFile?.id === node.contentKey || currentFile?.path === node.path) {
        const nextFile = await openFirstMarkdownFile(nextRepository);
        await persistWorkspaceState(nextRepository, nextFile?.id ?? null, editorMode, null);
      }
      await refreshRecentFiles(nextRepository);
      await refreshCalendarStatus(nextRepository, calendarMonth);
      await refreshTags(nextRepository);
      notify("已移入回收站");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "移入回收站失败");
    }
  };

  const restoreTrashEntry = async (node: FileNode) => {
    if (!repository) return;

    try {
      const nextRepository = await repositoryService.restoreFromTrash(repository.id, node.id, "rename");
      setRepository(nextRepository);
      await refreshCalendarStatus(nextRepository, calendarMonth);
      await refreshTags(nextRepository);
      notify("已从回收站恢复");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "恢复失败");
    }
  };

  const deleteTrashEntry = async (node: FileNode) => {
    if (!repository) return;

    try {
      const nextRepository = await repositoryService.permanentlyDeleteTrashEntry(repository.id, node.id);
      setRepository(nextRepository);
      await refreshTags(nextRepository);
      notify("已彻底删除");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "彻底删除失败");
    }
  };

  const clearTrash = async () => {
    if (!repository) return;

    try {
      const nextRepository = await repositoryService.clearTrash(repository.id);
      setRepository(nextRepository);
      await refreshTags(nextRepository);
      notify("回收站已清空");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "清空回收站失败");
    }
  };

  const openRenameModal = (node: FileNode) => {
    setRenameTarget(node);
    setRenameValue(node.name);
  };

  const renameEntry = async () => {
    if (!repository || !renameTarget) return;

    try {
      const nextRepository = await repositoryService.renameEntry(repository.id, renameTarget.path, renameValue.trim());
      setRepository(nextRepository);
      setRenameTarget(null);
      setRenameValue("");
      await refreshRecentFiles(nextRepository);
      await refreshCalendarStatus(nextRepository, calendarMonth);
      await refreshTags(nextRepository);
      notify("已重命名");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "重命名失败");
    }
  };

  const showNodeInFolder = async (node: FileNode) => {
    if (!repository) return;

    try {
      await repositoryService.showInFolder(repository.id, node.path);
      notify("已打开系统文件夹");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "打开系统文件夹失败");
    }
  };

  const openBackupModal = () => {
    if (!repository) return;
    if (repository.isMock) {
      message.info("请先新建或打开一个真实仓库");
      setCreateRepositoryOpen(true);
      return;
    }
    if (dirty) {
      const text = "备份前请先保存当前未保存内容";
      message.warning(text);
      notify(text);
      return;
    }

    setBackupPath(defaultBackupPath(repository));
    setBackupExcludePrivateData(true);
    setBackupProgress(null);
    setBackupOpen(true);
  };

  const chooseBackupPath = async () => {
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
      setBackupPath(defaultBackupPath(repository));
      return;
    }

    const selected = await chooseSavePath({
      defaultPath: backupPath || defaultBackupPath(repository),
      filters: [{ name: "ZIP", extensions: ["zip"] }],
    });
    if (typeof selected === "string") {
      setBackupPath(selected);
    }
  };

  const backupRepository = async () => {
    if (!repository) return;
    if (!backupPath.trim()) {
      message.warning("请选择备份位置");
      return;
    }

    try {
      setActionLoading(true);
      setBackupProgress({ percent: 15, label: "正在检查仓库状态" });
      setBackupProgress({ percent: 45, label: backupExcludePrivateData ? "正在过滤隐私文件并打包" : "正在打包仓库文件" });
      const backup = await repositoryService.backupRepository(repository.id, {
        outputPath: backupPath.trim(),
        excludePrivateData: backupExcludePrivateData,
      });
      setBackupProgress({ percent: 100, label: "备份完成" });
      setBackupOpen(false);
      notify(`仓库已备份：${backup.fileName}`);
      const skippedText = backup.skippedPrivateFiles ? `，已跳过 ${backup.skippedPrivateFiles} 个隐私文件` : "";
      message.success(`备份完成：${backup.absolutePath}${skippedText}`);
    } catch (error) {
      reportError(error, "备份仓库失败", "备份当前仓库", "备份失败");
    } finally {
      setActionLoading(false);
      setBackupProgress(null);
    }
  };

  const loadRestorePreview = async (path = restoreBackupPath) => {
    if (!repository) return;
    try {
      setActionLoading(true);
      setRestoreProgress({ percent: 35, label: "正在读取备份并生成差异预览" });
      const preview = await repositoryService.previewRestoreBackup(repository.id, path.trim() || undefined);
      setRestorePreview(preview);
      setRestoreBackupPath(preview.backupPath);
      setRestoreProgress(null);
    } catch (error) {
      reportError(error, "预览恢复备份失败", "预览恢复备份", "恢复失败");
    } finally {
      setActionLoading(false);
    }
  };

  const openRestoreBackupModal = () => {
    if (!repository) return;
    if (repository.isMock) {
      message.info("请先新建或打开一个真实仓库");
      setCreateRepositoryOpen(true);
      return;
    }
    if (dirty) {
      const text = "恢复备份前请先保存当前未保存内容";
      message.warning(text);
      notify(text);
      return;
    }

    setRestoreBackupPath("");
    setRestoreStrategy("replace");
    setRestorePreview(null);
    setRestoreProgress(null);
    setRestoreOpen(true);
    void loadRestorePreview("");
  };

  const chooseRestoreBackupPath = async () => {
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
      const fallback = restoreBackupPath || `${repository?.rootPath ?? "."}/.moknow/backups/MoKnow-backup-latest.zip`;
      setRestoreBackupPath(fallback);
      void loadRestorePreview(fallback);
      return;
    }

    const selected = await chooseOpenPath({
      multiple: false,
      directory: false,
      filters: [{ name: "ZIP", extensions: ["zip"] }],
    });
    if (typeof selected === "string") {
      setRestoreBackupPath(selected);
      void loadRestorePreview(selected);
    }
  };

  const restoreBackup = async () => {
    if (!repository) return;
    if (!restorePreview) {
      message.warning("请先生成恢复预览");
      return;
    }
    const confirmed = window.confirm(restoreStrategy === "replace"
      ? "覆盖恢复会用备份内容替换当前仓库，继续吗？"
      : "合并恢复会保留当前已有文件，只补回备份中缺失的文件，继续吗？");
    if (!confirmed) return;

    try {
      setActionLoading(true);
      setRestoreProgress({ percent: 30, label: "正在恢复备份" });
      const restored = await repositoryService.restoreBackup(repository.id, {
        backupPath: restorePreview.backupPath,
        strategy: restoreStrategy,
      });
      setRestoreProgress({ percent: 100, label: "恢复完成" });
      const nextRepository = restored.repository;
      setRepository(nextRepository);
      await openFirstMarkdownFile(nextRepository);
      await refreshRecentFiles(nextRepository);
      await refreshCalendarStatus(nextRepository, calendarMonth);
      await refreshTags(nextRepository);
      await refreshOrganizeView(nextRepository);
      setRestoreOpen(false);
      notify(`已恢复备份：${restored.backupFileName}`);
      const skippedText = restored.skippedConflictingFiles ? `，保留 ${restored.skippedConflictingFiles} 个当前文件` : "";
      message.success(`恢复完成：${restored.restoredFiles} 个文件${skippedText}`);
    } catch (error) {
      reportError(error, "恢复备份失败", "恢复最近备份", "恢复失败");
    } finally {
      setActionLoading(false);
      setRestoreProgress(null);
    }
  };

  const exportCurrentFileAsHtml = async () => {
    if (!repository || !currentFile) return;
    if (repository.isMock) {
      message.info("请先新建或打开一个真实仓库");
      setCreateRepositoryOpen(true);
      return;
    }

    try {
      setActionLoading(true);
      const html = await markdownService.renderStandaloneHtmlAsync(draft, currentFile.name);
      const exported = await repositoryService.exportMarkdownHtml(currentFile.id, html);
      notify(`HTML 已导出：${exported.fileName}`);
      message.success(`导出完成：${exported.absolutePath}`);
    } catch (error) {
      reportError(error, "导出 HTML 失败", "导出当前文件为 HTML", "导出失败");
    } finally {
      setActionLoading(false);
    }
  };

  const exportCurrentFileAsPdf = async () => {
    if (!repository || !currentFile) return;
    if (repository.isMock) {
      message.info("请先新建或打开一个真实仓库");
      setCreateRepositoryOpen(true);
      return;
    }

    try {
      setActionLoading(true);
      const html = await markdownService.renderStandaloneHtmlAsync(draft, currentFile.name);
      const exported = await repositoryService.exportMarkdownPdf(currentFile.id, html, currentFile.name);
      notify(`PDF 已导出：${exported.fileName}`);
      message.success(`导出完成：${exported.absolutePath}`);
    } catch (error) {
      reportError(error, "导出 PDF 失败", "导出当前文件为 PDF", "导出失败");
    } finally {
      setActionLoading(false);
    }
  };

  const openJournalExportModal = (mode: JournalExportMode = "month") => {
    const range = mode === "month" ? monthRange(calendarMonth) : {
      from: journalExportFrom,
      to: journalExportTo,
    };
    setJournalExportMode(mode);
    setJournalExportFrom(range.from);
    setJournalExportTo(range.to);
    setJournalExportPath(defaultExportPath(repository, range.from, range.to));
    setJournalExportProgress(null);
    setJournalExportOpen(true);
  };

  const updateJournalExportRange = (from: string, to: string) => {
    setJournalExportFrom(from);
    setJournalExportTo(to);
    setJournalExportPath((currentPath) => currentPath || defaultExportPath(repository, from, to));
  };

  const chooseJournalExportPath = async () => {
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
      setJournalExportPath(defaultExportPath(repository, journalExportFrom, journalExportTo));
      return;
    }

    const selected = await chooseSavePath({
      defaultPath: journalExportPath || defaultExportPath(repository, journalExportFrom, journalExportTo),
      filters: [{ name: "HTML", extensions: ["html"] }],
    });
    if (typeof selected === "string") {
      setJournalExportPath(selected);
    }
  };

  const exportJournalRangeAsHtml = async () => {
    if (!repository) return;
    if (repository.isMock) {
      message.info("请先新建或打开一个真实仓库");
      setCreateRepositoryOpen(true);
      return;
    }
    if (dirty) {
      const text = "导出合集前请先保存当前未保存内容";
      message.warning(text);
      notify(text);
      return;
    }
    if (!journalExportFrom || !journalExportTo || journalExportFrom > journalExportTo) {
      message.warning("请选择有效的导出日期范围");
      return;
    }
    const outputPath = journalExportPath.trim();
    if (!outputPath) {
      message.warning("请选择导出位置");
      return;
    }

    try {
      setActionLoading(true);
      setJournalExportProgress({ percent: 8, label: "正在校验导出条件" });
      const results = await repositoryService.searchFiles(repository.id, {
        dateFrom: journalExportFrom,
        dateTo: journalExportTo,
        fileType: "journal",
      });
      setJournalExportProgress({ percent: 24, label: "正在搜索日期范围内的日记" });
      const sortedResults = [...results].sort((left, right) => String(left.diaryDate ?? left.relativePath).localeCompare(String(right.diaryDate ?? right.relativePath)));
      if (!sortedResults.length) {
        message.info("所选日期范围内没有可导出的日记");
        return;
      }

      const entries: MarkdownExportEntry[] = [];
      for (let index = 0; index < sortedResults.length; index += 1) {
        const result = sortedResults[index];
        const file = await repositoryService.readFile(result.fileId);
        entries.push({
          title: file.name,
          path: result.relativePath,
          content: file.raw,
          date: result.diaryDate,
        });
        const percent = 30 + Math.round(((index + 1) / sortedResults.length) * 36);
        setJournalExportProgress({ percent, label: `正在读取日记 ${index + 1}/${sortedResults.length}` });
      }
      const title = journalExportMode === "month" ? `MoKnow ${journalExportFrom.slice(0, 7)} 日记合集` : `MoKnow 日记合集 ${journalExportFrom} 至 ${journalExportTo}`;
      const description = `导出范围：${journalExportFrom} 至 ${journalExportTo}；包含 ${entries.length} 篇日记。`;
      setJournalExportProgress({ percent: 76, label: "正在生成导出 HTML" });
      const html = await markdownService.renderCollectionHtmlAsync(entries, title, description, {
        includeTableOfContents: journalExportIncludeToc,
        pageBreakBetweenEntries: journalExportPageBreaks,
        printFriendly: journalExportFormat === "print-html",
      });
      setJournalExportProgress({ percent: 92, label: "正在写入导出文件" });
      const exported = await repositoryService.exportHtmlToPath({ outputPath, html });

      setJournalExportProgress({ percent: 100, label: "导出完成" });
      setJournalExportOpen(false);
      notify(`日记合集已导出：${exported.fileName}`);
      message.success(`导出完成：${exported.absolutePath}`);
    } catch (error) {
      reportError(error, "导出日记合集失败", "导出日记合集", "导出失败");
    } finally {
      setActionLoading(false);
      setJournalExportProgress(null);
    }
  };

  const executeErrorRecoveryAction = async (action: ErrorRecoveryAction, diagnostic: ErrorDiagnostic) => {
    try {
      switch (action.id) {
        case "retry_save":
          await save("manual");
          break;
        case "open_backup":
          setErrorLogOpen(false);
          openBackupModal();
          break;
        case "open_restore":
          setErrorLogOpen(false);
          openRestoreBackupModal();
          break;
        case "retry_export_html":
          await exportCurrentFileAsHtml();
          break;
        case "retry_export_pdf":
          await exportCurrentFileAsPdf();
          break;
        case "open_journal_export":
          setErrorLogOpen(false);
          openJournalExportModal("range");
          break;
        case "open_repository_folder":
          if (!repository) {
            message.info("请先打开仓库");
            return;
          }
          await repositoryService.showInFolder(repository.id, "");
          notify("已打开仓库位置");
          break;
        default:
          message.info(`暂不支持恢复动作：${diagnostic.operation}`);
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : "执行恢复动作失败");
    }
  };

  const changeEditorMode = (mode: EditorMode) => {
    setEditorMode(mode);
    void persistWorkspaceState(repository, currentFile?.id ?? null, mode, lastCursorPosition);
  };

  const changeCursorPosition = (cursorPosition: CursorPosition) => {
    setLastCursorPosition(cursorPosition);
    void persistWorkspaceState(repository, currentFile?.id ?? null, editorMode, cursorPosition);
  };

  const updateDraftContent = (content: string) => {
    setDirty(true);
    setSaveStatus("dirty");
    setDraft(content);
    setCurrentFile((file) => file ? { ...file, raw: content } : file);
  };

  const appendAiOutputToDraft = (content: string) => {
    const separator = draft.trim() ? "\n\n" : "";
    updateDraftContent(`${draft}${separator}${content.trim()}\n`);
    notify("AI 输出已插入正文");
  };

  const loadAiContext = async (scope: AiContextScope, query?: string): Promise<Partial<AiContext>> => {
    if (!repository || !currentFile) return {};
    if (scope === "current_file") {
      return {
        currentContent: draft,
        entries: [{
          fileId: currentFile.id,
          title: currentFile.name,
          path: currentFile.path,
          content: draft,
          snippet: draft.trim().slice(0, 160),
        }],
        retrievalStatus: {
          mode: "current_file",
          state: "ready",
          documentCount: 1,
          message: "AI 已使用当前文件作为上下文。",
          query: query?.trim() || undefined,
        },
      };
    }

    const filters: SearchFilters = { fileType: scope === "repository" ? "all" : "journal" };
    const trimmedQuery = query?.trim();
    if (scope === "week") {
      const range = weekRange(new Date());
      filters.dateFrom = range.from;
      filters.dateTo = range.to;
    }
    if (scope === "month") {
      const range = monthRange(calendarMonth);
      filters.dateFrom = range.from;
      filters.dateTo = range.to;
    }

    type AiContextDocument = {
      fileId: string;
      name: string;
      relativePath: string;
      content: string;
      diaryDate?: string;
      tags: string[];
    };

    const candidateResults = await repositoryService.searchFiles(repository.id, filters);
    const candidateDocuments: AiContextDocument[] = await Promise.all(candidateResults.slice(0, 50).map(async (result) => {
      const file = await repositoryService.readFile(result.fileId);
      return {
        fileId: result.fileId,
        name: file.name,
        relativePath: result.relativePath,
        content: file.raw,
        diaryDate: result.diaryDate,
        tags: result.tags,
      };
    }));
    const candidateById = new Map<string, AiContextDocument>(candidateDocuments.map((document) => [document.fileId, document]));

    const entriesFromResults = async (results: SearchResult[]) => Promise.all(results.slice(0, 8).map(async (result) => {
      let file = candidateById.get(result.fileId);
      if (!file) {
        const readFile = await repositoryService.readFile(result.fileId);
        file = {
          fileId: result.fileId,
          name: readFile.name,
          relativePath: result.relativePath,
          content: readFile.raw,
          diaryDate: result.diaryDate,
          tags: result.tags,
        };
      }
      return {
        title: file.name,
        path: result.relativePath,
        content: file.content,
        date: result.diaryDate,
        fileId: result.fileId,
        snippet: stripSearchHighlight(result.highlightedSnippet || result.snippet),
        score: result.score,
      };
    }));

    let entries = await entriesFromResults(candidateResults);
    let retrievalStatus: AiContext["retrievalStatus"] = {
      mode: "full_text",
      state: entries.length ? "ready" : "empty",
      documentCount: candidateDocuments.length,
      message: entries.length
        ? `AI 已加载当前范围内 ${candidateDocuments.length} 篇 Markdown 作为上下文。`
        : "AI 向量索引未完成：当前范围没有可索引的 Markdown，已回退到当前文件。",
      query: trimmedQuery || undefined,
    };

    if (!trimmedQuery) {
      setAiIndexProgress(null);
    }

    if (trimmedQuery) {
      const embeddingSettings = aiVectorIndexService.loadEmbeddingSettings();
      const indexStatus = await aiVectorIndexService.buildIndexWithSettings(candidateDocuments, {
        settings: embeddingSettings,
        credentialStore: repositoryService,
        onProgress: setAiIndexProgress,
      });
      const vectorSearch = await aiVectorIndexService.searchWithSettings(trimmedQuery, 8, {
        settings: embeddingSettings,
        credentialStore: repositoryService,
        onProgress: setAiIndexProgress,
      });
      const vectorEntries = vectorSearch.results.map((result) => ({
        title: result.name,
        path: result.relativePath,
        content: result.content,
        date: result.diaryDate,
        fileId: result.fileId,
        snippet: result.snippet,
        score: Math.round(result.score * 1000),
      }));

      retrievalStatus = {
        mode: indexStatus.mode,
        state: indexStatus.state === "ready" ? "ready" : indexStatus.state === "empty" ? "empty" : indexStatus.state === "error" ? "error" : "not_ready",
        documentCount: indexStatus.documentCount,
        message: vectorSearch.warning
          ?? (vectorEntries.length
            ? `AI ${indexStatus.mode === "external_embedding" ? "外部 Embedding 向量库" : "本地向量索引"}已就绪，已用语义检索召回 ${vectorEntries.length} 篇相关笔记。`
            : `AI ${indexStatus.mode === "external_embedding" ? "外部 Embedding 向量库" : "本地向量索引"}已就绪，但没有命中“${trimmedQuery}”，已回退到全文搜索。`),
        query: trimmedQuery,
      };

      if (vectorEntries.length) {
        entries = vectorEntries;
      } else if (indexStatus.state === "ready") {
        entries = await entriesFromResults(await repositoryService.searchFiles(repository.id, { ...filters, query: trimmedQuery }));
      } else {
        entries = [];
      }
    }

    return {
      currentContent: draft,
      entries: entries.length ? entries : [{
        fileId: currentFile.id,
        title: currentFile.name,
        path: currentFile.path,
        content: draft,
        snippet: draft.trim().slice(0, 160),
      }],
      retrievalStatus,
    };
  };

  const runPluginAiTool = async (
    tool: { id: string; pluginId: string; pluginName: string },
    loadedContext: AiContext,
  ): Promise<AiMessage> => {
    const entries = loadedContext.entries?.length
      ? loadedContext.entries
      : loadedContext.currentContent
        ? [{
          title: loadedContext.fileName,
          path: loadedContext.filePath,
          content: loadedContext.currentContent,
          snippet: loadedContext.currentContent.trim().slice(0, 160),
        }]
        : [];
    const combinedText = entries.map((entry) => entry.content).join("\n\n").trim();
    const sources = entries.slice(0, 4).map((entry) => ({
      fileId: entry.fileId,
      title: entry.title,
      path: entry.path,
      snippet: entry.snippet ?? entry.content.trim().slice(0, 120),
    }));
    const toolId = tool.id.toLowerCase();
    const words = combinedText
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((word) => word.length >= 2)
      .slice(0, 80);
    const frequentWords = Array.from(new Set(words)).slice(0, 8);
    const sampleTitles = entries.slice(0, 3).map((entry) => `- ${entry.title}`).join("\n") || "- 当前文件";

    let content: string;
    if (toolId.includes("summary") || toolId.includes("summarize")) {
      content = `插件 ${tool.pluginName} / ${tool.id} 已读取 ${entries.length} 个上下文片段。\n\n摘要：\n- 当前内容约 ${combinedText.length} 个字符。\n- 主要参考：\n${sampleTitles}\n- 可继续让 AI 基于这些来源生成更细的复盘或行动清单。`;
    } else if (toolId.includes("prompt") || toolId.includes("question")) {
      content = `插件 ${tool.pluginName} / ${tool.id} 生成的追问：\n\n1. 这批记录里最值得继续推进的一件事是什么？\n2. 哪个反复出现的主题需要被整理成长期计划？\n3. 下一次写日记时，可以补充一个更具体的行动或感受证据。`;
    } else if (toolId.includes("tag") || toolId.includes("keyword")) {
      content = `插件 ${tool.pluginName} / ${tool.id} 建议标签：${frequentWords.length ? frequentWords.map((word) => `#${word}`).join(" ") : "#记录 #复盘 #行动"}`;
    } else {
      content = `插件 ${tool.pluginName} / ${tool.id} 已接入宿主 AI 工具运行时。\n\n已读取 ${entries.length} 个上下文片段，可用来源包括：\n${sampleTitles}`;
    }

    return {
      id: `assistant-plugin-${Date.now()}`,
      role: "assistant",
      content,
      sources,
      createdAt: "刚刚",
    };
  };

  const toggleTypewriterMode = () => {
    setTypewriterMode((current) => {
      const next = !current;
      if (next) setFocusMode(true);
      notify(next ? "已开启打字机模式" : "已关闭打字机模式");
      return next;
    });
  };

  const toggleFullscreenWriting = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen?.();
        setFullscreenWriting(false);
        notify("已退出全屏写作");
        return;
      }

      if (!document.documentElement.requestFullscreen) {
        message.warning("当前环境不支持全屏写作");
        notify("当前环境不支持全屏写作");
        return;
      }

      await document.documentElement.requestFullscreen();
      setFocusMode(true);
      setFullscreenWriting(true);
      notify("已进入全屏写作");
    } catch (error) {
      reportError(error, "切换全屏失败", "切换全屏写作", "全屏写作失败");
    }
  };

  const saveAttachmentFromEditor = async (file: File): Promise<string> => {
    if (!currentFile) {
      throw new Error("请先打开一个 Markdown 文件");
    }

    try {
      const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
      const attachment = await repositoryService.saveAttachment(currentFile.id, file.name || "image.png", bytes);
      notify("图片已保存到附件目录");
      return attachment.markdownText;
    } catch (error) {
      reportError(error, "保存图片附件失败", "保存图片附件", "保存图片失败");
      throw error;
    }
  };

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (appLocked) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "p") {
        event.preventDefault();
        openCommandPalette(event.shiftKey ? "commands" : "files");
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [appLocked, save, searchCommandPaletteFiles]);

  useEffect(() => {
    if (!dirty || !currentFile || saveStatus === "conflict" || conflictStatus) return;

    const timer = window.setTimeout(() => {
      void save("auto");
    }, 2000);

    return () => window.clearTimeout(timer);
  }, [conflictStatus, currentFile, dirty, draft, save, saveStatus]);

  const pluginPaletteCommands: PaletteCommand[] = pluginContributions.commands.map((command) => ({
    id: `plugin:${command.pluginId}:${command.id}`,
    label: command.title,
    category: command.category ? `插件 / ${command.category}` : `插件 / ${command.pluginName}`,
    action: () => {
      setCommandPaletteOpen(false);
      notify(`插件命令已触发：${command.title}`);
    },
  }));

  const paletteCommands: PaletteCommand[] = [
    { id: "save", label: "保存当前文件", category: "文件", shortcut: "Ctrl/Cmd+S", action: () => { setCommandPaletteOpen(false); void save(); } },
    { id: "new-journal", label: "新增日记", category: "文件", action: () => { setCommandPaletteOpen(false); void createJournal(); } },
    { id: "new-document", label: "新建文档", category: "文件", action: () => { setCommandPaletteOpen(false); setCreateDocumentOpen(true); } },
    { id: "backup", label: "备份当前仓库", category: "文件", action: () => { setCommandPaletteOpen(false); openBackupModal(); } },
    { id: "restore-backup", label: "恢复备份", category: "文件", action: () => { setCommandPaletteOpen(false); openRestoreBackupModal(); } },
    { id: "export-html", label: "导出当前文件为 HTML", category: "文件", action: () => { setCommandPaletteOpen(false); void exportCurrentFileAsHtml(); } },
    { id: "export-pdf", label: "导出当前文件为 PDF", category: "文件", action: () => { setCommandPaletteOpen(false); void exportCurrentFileAsPdf(); } },
    { id: "export-journal-month", label: "导出本月日记合集", category: "文件", action: () => { setCommandPaletteOpen(false); openJournalExportModal("month"); } },
    { id: "export-journal-range", label: "导出日期范围日记", category: "文件", action: () => { setCommandPaletteOpen(false); openJournalExportModal("range"); } },
    { id: "quick-capture", label: "快速记录到收件箱", category: "整理", action: () => { setCommandPaletteOpen(false); window.setTimeout(() => document.querySelector<HTMLTextAreaElement>("[aria-label='快速记录内容']")?.focus(), 0); } },
    { id: "quick-open", label: "快速打开文件", category: "搜索", shortcut: "Ctrl/Cmd+P", action: () => openCommandPalette("files") },
    { id: "source-mode", label: "切换到源码模式", category: "编辑器", action: () => { setCommandPaletteOpen(false); changeEditorMode("source"); } },
    { id: "split-mode", label: "切换到双视图模式", category: "编辑器", action: () => { setCommandPaletteOpen(false); changeEditorMode("split"); } },
    { id: "wysiwyg-mode", label: "切换到所见即所得模式", category: "编辑器", action: () => { setCommandPaletteOpen(false); changeEditorMode("wysiwyg"); } },
    { id: "focus-mode", label: focusMode ? "退出专注写作" : "进入专注写作", category: "视图", action: () => { setCommandPaletteOpen(false); setFocusMode((current) => !current); } },
    { id: "theme", label: themeName === "night" ? "切换到白天主题" : "切换到黑夜主题", category: "设置", action: () => { setCommandPaletteOpen(false); toggleThemePreference(); } },
    { id: "lock-now", label: "立即锁定", category: "安全", action: () => { setCommandPaletteOpen(false); lockNow(); } },
    { id: "lock-settings", label: "应用锁设置", category: "安全", action: () => { setCommandPaletteOpen(false); setAppLockSettingsOpen(true); } },
    { id: "plugin-manager", label: "插件管理", category: "插件", action: () => { setCommandPaletteOpen(false); setPluginManagerOpen(true); } },
    { id: "settings", label: "打开设置", category: "设置", action: () => { setCommandPaletteOpen(false); setAppSettingsOpen(true); } },
    { id: "diary-settings", label: "打开日记设置", category: "设置", action: () => { setCommandPaletteOpen(false); void openDiarySettings(); } },
    { id: "check-update", label: "检查应用更新", category: "发布", action: () => { setCommandPaletteOpen(false); void checkForAppUpdate(); } },
    { id: "copy-error-diagnostic", label: "复制最近错误诊断", category: "错误处理", action: () => { setCommandPaletteOpen(false); void copyLastErrorDiagnostic(); } },
    { id: "open-error-log", label: "查看错误日志", category: "错误处理", action: () => { setCommandPaletteOpen(false); openErrorLog(); } },
    ...pluginPaletteCommands,
  ];

  const wordCount = draft.replace(/\s/g, "").length;

  return (
    <ConfigProvider theme={themeResult.antdTheme}>
      <AntdApp>
          {effectiveUserSettings.customCss ? <style id="moknow-custom-css">{effectiveUserSettings.customCss}</style> : null}
          <div className={`app-root ${focusMode ? "focus-mode" : ""} ${appLocked ? "locked" : ""}`} data-theme={themeName} style={themeResult.cssVars as CSSProperties}>
          <div className={`notif ${showNotification ? "" : "hidden"}`} id="notif">
            <span>{notification}</span>
            {lastErrorDiagnostic ? (
              <button className="notif-action" type="button" onClick={() => void copyLastErrorDiagnostic()}>
                复制诊断
              </button>
            ) : null}
          </div>
          <TitleBar
            dirty={dirty}
            focusMode={focusMode}
            fullscreenWriting={fullscreenWriting}
            lockEnabled={appLockSettings.enabled}
            themeName={themeName}
            typewriterMode={typewriterMode}
	            onBackupRepository={openBackupModal}
	            onExportHtml={() => void exportCurrentFileAsHtml()}
	            onExportPdf={() => void exportCurrentFileAsPdf()}
	            onExportJournalCollection={() => openJournalExportModal("month")}
	            onRestoreBackup={openRestoreBackupModal}
            onLockNow={lockNow}
            onNotify={notify}
            onOpenCommandPalette={() => openCommandPalette("commands")}
            onOpenLockSettings={() => setAppLockSettingsOpen(true)}
            onOpenPluginManager={() => setPluginManagerOpen(true)}
            onOpenQuickOpen={() => openCommandPalette("files")}
            onOpenSettings={() => setAppSettingsOpen(true)}
            onToggleFullscreenWriting={() => void toggleFullscreenWriting()}
            onToggleFocusMode={() => {
              setFocusMode((current) => {
                notify(current ? "已退出专注写作" : "已进入专注写作");
                return !current;
              });
            }}
            onToggleTheme={toggleThemePreference}
            onToggleTypewriterMode={toggleTypewriterMode}
          />

          {!appLocked ? <main className="layout">
            {loading || !repository ? (
              <div className="loading-mask">
                <Spin description="正在加载 MoKnow 仓库..." />
              </div>
            ) : (
              <>
                {!focusMode ? (
                  <RepositoryTree
                    repository={repository}
                    activeFileId={currentFile?.id ?? ""}
                    calendarMonth={calendarMonth}
                    calendarStatuses={calendarStatuses}
                    calendarSelectedDate={calendarSelectedDate}
                    calendarLoading={calendarLoading}
                    recentOpenedFiles={recentOpenedFiles}
                    recentEditedFiles={recentEditedFiles}
                    onSelectFile={(fileId) => void selectFile(fileId)}
                    onCalendarMonthChange={(month) => {
                      setCalendarMonth(month);
                      setCalendarSelectedDate(null);
                    }}
                    onOpenCalendarDate={(date) => void openCalendarDate(date)}
                    onOpenRecentFile={(fileId) => void selectFile(fileId)}
                    onClearRecentFiles={(listKind) => void clearRecentFiles(listKind)}
                    onToggleFavorite={(node) => void toggleFavorite(node)}
                    onTogglePinned={(node) => void togglePinned(node)}
                    onMoveToTrash={(node) => void moveNodeToTrash(node)}
                    onRenameEntry={openRenameModal}
                    onShowInFolder={(node) => void showNodeInFolder(node)}
                    onRestoreTrashEntry={(node) => void restoreTrashEntry(node)}
                    onDeleteTrashEntry={(node) => void deleteTrashEntry(node)}
                    onClearTrash={() => void clearTrash()}
                    onCreateJournal={() => void createJournal()}
                    onCreateDocument={() => setCreateDocumentOpen(true)}
                    onCreateRepository={() => setCreateRepositoryOpen(true)}
                    onOpenRepository={(rootPath) => void openRepository(rootPath)}
                    recentRepositories={recentRepositories}
                    repositorySwitching={actionLoading}
                  />
                ) : null}
                {currentFile ? (
                  <Suspense fallback={<div className="empty-editor">正在加载编辑器...</div>}>
                    <EditorWorkspace
                      file={currentFile}
                      markdownService={markdownService}
                      mode={editorMode}
                      typewriterMode={focusMode && typewriterMode}
                      cursorPosition={lastCursorPosition}
                      wikiBacklinks={wikiBacklinks}
                      wikiCandidates={wikiCandidates}
                      onModeChange={changeEditorMode}
                      onCursorChange={changeCursorPosition}
                      onAttachmentPaste={(file) => saveAttachmentFromEditor(file)}
                      onDirtyChange={(nextDirty, content) => {
                        setDirty(nextDirty);
                        setSaveStatus(nextDirty ? "dirty" : "saved");
                        setDraft(content);
                      }}
                      onOpenBacklink={(fileId) => void selectFile(fileId)}
                      onOpenWikiLink={(title) => void openWikiLink(title)}
                    />
                  </Suspense>
                ) : (
                  <div className="empty-editor">选择或创建一个 Markdown 文件开始记录</div>
                )}
                {!focusMode ? (
                  <aside className="right-panel">
                    <InboxPanel
                      loading={organizeLoading}
                      view={organizeView}
                      onAddEntry={addInboxEntry}
                      onClearEntries={clearInboxEntries}
                      onMoveToToday={moveInboxEntriesToToday}
                      onOpenFile={(fileId) => void selectFile(fileId)}
                      onRefresh={() => void refreshOrganizeView(repository)}
                    />
                    <SearchPanel
                      filters={searchFilters}
                      history={searchHistory}
                      loading={searchLoading}
                      results={searchResults}
                      tags={globalTags}
                      onFiltersChange={setSearchFilters}
                      onDeleteTag={(tag) => void deleteGlobalTag(tag)}
                      onOpenResult={(fileId) => void selectFile(fileId)}
                      onRenameTag={(oldName, newName) => void renameGlobalTag(oldName, newName)}
                      onRunSearch={() => void runSearch()}
                      onSelectHistory={selectSearchHistory}
                      onSelectTag={selectSearchTag}
                      onSetTagColor={(tag, color) => void setGlobalTagColor(tag, color)}
                    />
                    {currentFile ? <MetadataPanel content={draft} onChange={updateDraftContent} /> : null}
                    {pluginContributions.sidebars.length ? (
                      <section className="plugin-sidebar-runtime" aria-label="插件侧边栏贡献">
                        <div className="plugin-sidebar-header">
                          <span>插件面板</span>
                          <small>{pluginContributions.sidebars.length}</small>
                        </div>
                        {pluginContributions.sidebars.map((sidebar) => (
                          <article className="plugin-sidebar-card" key={`${sidebar.pluginId}:${sidebar.id}`}>
                            <strong>{sidebar.title}</strong>
                            <span>{sidebar.pluginName}</span>
                            <p>已注册侧边栏贡献点，第三方入口执行将在沙箱能力完成后接入。</p>
                          </article>
                        ))}
                      </section>
                    ) : null}
                    <AiCockpit
                      aiService={aiService}
                      indexProgress={aiIndexProgress}
                      vectorIndexService={aiVectorIndexService}
                      context={{
                        fileName: currentFile?.name ?? "未选择文件",
                        filePath: currentFile?.path ?? "",
                        repositoryName: repository.name,
                        currentContent: draft,
                      }}
                      onInsertToDraft={appendAiOutputToDraft}
                      onLoadContext={(scope, query) => loadAiContext(scope, query)}
                      onOpenSource={(fileId) => void selectFile(fileId)}
                      onRunPluginAiTool={(tool, loadedContext) => runPluginAiTool(tool, loadedContext)}
                      pluginAiTools={pluginContributions.aiTools}
                    />
                  </aside>
                ) : null}
              </>
            )}
          </main> : <div className="locked-workspace-placeholder" aria-hidden="true" />}

          <CommandPalette
            commands={paletteCommands}
            fileResults={commandPaletteResults}
            loading={commandPaletteLoading}
            mode={commandPaletteMode}
            open={commandPaletteOpen}
            query={commandPaletteQuery}
            onClose={() => setCommandPaletteOpen(false)}
            onOpenFile={(fileId) => void openCommandPaletteFile(fileId)}
            onQueryChange={changeCommandPaletteQuery}
            onSwitchMode={(mode) => {
              setCommandPaletteMode(mode);
              setCommandPaletteQuery("");
              if (mode === "files") void searchCommandPaletteFiles("");
            }}
          />

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
          <AppSettingsModal
            open={appSettingsOpen}
            loading={settingsLoading}
            settings={userSettings}
            currentRepositoryId={repository?.id}
            currentRepositoryName={repository?.name}
            currentFileId={currentFile?.id}
            currentFileName={currentFile?.name}
            pluginThemes={pluginContributions.themes}
            onCancel={() => setAppSettingsOpen(false)}
            onExportSettings={exportSettingsFile}
            onImportSettingsJson={importSettingsJson}
            onOpenDiarySettings={() => {
              setAppSettingsOpen(false);
              window.setTimeout(() => void openDiarySettings(), 0);
            }}
            onOpenLockSettings={() => {
              setAppSettingsOpen(false);
              window.setTimeout(() => setAppLockSettingsOpen(true), 0);
            }}
            onSubmit={(settings) => void saveGeneralSettings(settings)}
          />
          <PluginManagerModal
            manifestDraft={pluginManifestDraft}
            officialPlugins={officialPlugins}
            open={pluginManagerOpen}
            plugins={pluginRegistry}
            onCancel={() => setPluginManagerOpen(false)}
            onInstallOfficialPlugin={installOfficialPlugin}
            onInstallManifest={installPluginManifest}
            onManifestDraftChange={setPluginManifestDraft}
            onRemovePlugin={removePlugin}
            onTogglePlugin={togglePluginEnabled}
          />
	          <Modal
	            title="备份仓库"
	            open={backupOpen}
	            okText="开始备份"
	            cancelText="取消"
	            confirmLoading={actionLoading}
	            cancelButtonProps={{ disabled: actionLoading }}
	            onCancel={() => {
	              if (actionLoading) return;
	              setBackupProgress(null);
	              setBackupOpen(false);
	            }}
	            onOk={() => void backupRepository()}
	          >
	            <div className="backup-form">
	              <label>
	                <span>备份位置</span>
	                <div className="backup-path">
	                  <Input
	                    aria-label="备份位置"
	                    value={backupPath}
	                    disabled={actionLoading}
	                    onChange={(event) => setBackupPath(event.target.value)}
	                  />
	                  <Button disabled={actionLoading} onClick={() => void chooseBackupPath()}>选择位置</Button>
	                </div>
	              </label>
	              <label className="backup-checkbox">
	                <input
	                  type="checkbox"
	                  checked={backupExcludePrivateData}
	                  disabled={actionLoading}
	                  onChange={(event) => setBackupExcludePrivateData(event.target.checked)}
	                />
	                <span>排除疑似隐私/凭据文件</span>
	              </label>
	              <div className="backup-preview" aria-label="备份预览">
	                <strong>备份预览</strong>
	                <p>输出到 {backupPath || "未选择位置"}。</p>
	                <p>{backupExcludePrivateData ? "会跳过 .env、*.key、*.pem、token、secret 等疑似隐私文件。" : "会完整备份仓库可读取文件，仍会跳过历史备份目录。"}</p>
	              </div>
	              {backupProgress ? (
	                <div className="backup-progress" role="status" aria-live="polite">
	                  <Progress percent={backupProgress.percent} size="small" />
	                  <span>{backupProgress.label}</span>
	                </div>
	              ) : null}
	            </div>
	          </Modal>
	          <Modal
	            title="恢复备份"
	            open={restoreOpen}
	            okText="执行恢复"
	            cancelText="取消"
	            confirmLoading={actionLoading}
	            cancelButtonProps={{ disabled: actionLoading }}
	            okButtonProps={{ disabled: !restorePreview }}
	            onCancel={() => {
	              if (actionLoading) return;
	              setRestoreProgress(null);
	              setRestoreOpen(false);
	            }}
	            onOk={() => void restoreBackup()}
	          >
	            <div className="restore-form">
	              <label>
	                <span>备份文件</span>
	                <div className="restore-path">
	                  <Input
	                    aria-label="恢复备份文件"
	                    value={restoreBackupPath}
	                    disabled={actionLoading}
	                    onChange={(event) => setRestoreBackupPath(event.target.value)}
	                    onBlur={() => void loadRestorePreview(restoreBackupPath)}
	                  />
	                  <Button disabled={actionLoading} onClick={() => void chooseRestoreBackupPath()}>选择文件</Button>
	                </div>
	              </label>
	              <label>
	                <span>恢复策略</span>
	                <select
	                  aria-label="恢复策略"
	                  value={restoreStrategy}
	                  disabled={actionLoading}
	                  onChange={(event) => setRestoreStrategy(event.target.value as BackupRestoreStrategy)}
	                >
	                  <option value="replace">覆盖恢复：以备份替换当前仓库</option>
	                  <option value="merge_keep_current">合并恢复：保留当前已有文件</option>
	                </select>
	              </label>
	              <div className="restore-preview" aria-label="恢复预览">
	                <strong>差异预览</strong>
	                {restorePreview ? (
	                  <>
	                    <p>{restorePreview.backupFileName}，共 {restorePreview.totalBackupFiles} 个备份文件。</p>
	                    <div className="restore-preview-grid">
	                      <span>新增 {restorePreview.addedFiles}</span>
	                      <span>修改 {restorePreview.modifiedFiles}</span>
	                      <span>不变 {restorePreview.unchangedFiles}</span>
	                      <span>覆盖时删除 {restorePreview.deletedFiles}</span>
	                    </div>
	                    {[restorePreview.sampleAdded, restorePreview.sampleModified, restorePreview.sampleDeleted].some((items) => items.length > 0) ? (
	                      <ul>
	                        {restorePreview.sampleAdded.map((path) => <li key={`added-${path}`}>新增：{path}</li>)}
	                        {restorePreview.sampleModified.map((path) => <li key={`modified-${path}`}>修改：{path}</li>)}
	                        {restorePreview.sampleDeleted.map((path) => <li key={`deleted-${path}`}>覆盖时删除：{path}</li>)}
	                      </ul>
	                    ) : null}
	                  </>
	                ) : (
	                  <p>正在等待备份预览。</p>
	                )}
	              </div>
	              {restoreProgress ? (
	                <div className="restore-progress" role="status" aria-live="polite">
	                  <Progress percent={restoreProgress.percent} size="small" />
	                  <span>{restoreProgress.label}</span>
	                </div>
	              ) : null}
	            </div>
	          </Modal>
	          <DiarySettingsModal
	            open={diarySettingsOpen}
	            loading={settingsLoading}
	            settings={diarySettings}
	            onCancel={() => setDiarySettingsOpen(false)}
	            onSubmit={(settings) => void saveDiarySettings(settings)}
	          />
	          <Modal
	            title="导出日记合集"
	            open={journalExportOpen}
	            okText="导出"
	            cancelText="取消"
	            confirmLoading={actionLoading}
	            cancelButtonProps={{ disabled: actionLoading }}
	            onCancel={() => {
	              if (actionLoading) return;
	              setJournalExportProgress(null);
	              setJournalExportOpen(false);
	            }}
	            onOk={() => void exportJournalRangeAsHtml()}
	          >
	            <div className="journal-export-form">
	              <label>
	                <span>导出类型</span>
	                <select
	                  aria-label="导出类型"
	                  value={journalExportMode}
	                  disabled={actionLoading}
	                  onChange={(event) => {
	                    const mode = event.target.value as JournalExportMode;
	                    setJournalExportMode(mode);
	                    if (mode === "month") {
	                      const range = monthRange(calendarMonth);
	                      updateJournalExportRange(range.from, range.to);
	                      setJournalExportPath(defaultExportPath(repository, range.from, range.to));
	                    }
	                  }}
	                >
	                  <option value="month">本月日记合集</option>
	                  <option value="range">日期范围日记</option>
	                </select>
	              </label>
	              <label>
	                <span>导出格式</span>
	                <select
	                  aria-label="导出格式"
	                  value={journalExportFormat}
	                  onChange={(event) => setJournalExportFormat(event.target.value as JournalExportFormat)}
	                  disabled={actionLoading}
	                >
	                  <option value="web-html">网页 HTML</option>
	                  <option value="print-html">打印友好 HTML</option>
	                </select>
	              </label>
	              <div className="journal-export-date-row">
	                <label>
	                  <span>开始日期</span>
	                  <Input
	                    aria-label="导出开始日期"
	                    type="date"
	                    value={journalExportFrom}
	                    disabled={actionLoading}
	                    onChange={(event) => updateJournalExportRange(event.target.value, journalExportTo)}
	                  />
	                </label>
	                <label>
	                  <span>结束日期</span>
	                  <Input
	                    aria-label="导出结束日期"
	                    type="date"
	                    value={journalExportTo}
	                    disabled={actionLoading}
	                    onChange={(event) => updateJournalExportRange(journalExportFrom, event.target.value)}
	                  />
	                </label>
	              </div>
	              <div className="journal-export-options" aria-label="导出选项">
	                <label className="journal-export-checkbox">
	                  <input
	                    type="checkbox"
	                    checked={journalExportIncludeToc}
	                    disabled={actionLoading}
	                    onChange={(event) => setJournalExportIncludeToc(event.target.checked)}
	                  />
	                  <span>包含合集目录</span>
	                </label>
	                <label className="journal-export-checkbox">
	                  <input
	                    type="checkbox"
	                    checked={journalExportPageBreaks}
	                    disabled={actionLoading}
	                    onChange={(event) => setJournalExportPageBreaks(event.target.checked)}
	                  />
	                  <span>每篇日记分页</span>
	                </label>
	              </div>
	              <label>
	                <span>导出位置</span>
	                <div className="journal-export-path">
	                  <Input
	                    aria-label="导出位置"
	                    value={journalExportPath}
	                    disabled={actionLoading}
	                    onChange={(event) => setJournalExportPath(event.target.value)}
	                  />
	                  <Button disabled={actionLoading} onClick={() => void chooseJournalExportPath()}>选择位置</Button>
	                </div>
	              </label>
	              <div className="journal-export-preview" aria-label="导出预览">
	                <strong>导出预览</strong>
	                <p>{journalExportFrom || "未选择"} 至 {journalExportTo || "未选择"}，{journalExportMode === "month" ? "本月合集" : "日期范围合集"}，{journalExportFormat === "print-html" ? "打印友好 HTML" : "网页 HTML"}。</p>
	                <p>{journalExportIncludeToc ? "包含目录" : "不包含目录"}；{journalExportPageBreaks ? "每篇日记分页" : "连续排版"}；输出到 {journalExportPath || "未选择位置"}。</p>
	              </div>
	              {journalExportProgress ? (
	                <div className="journal-export-progress" role="status" aria-live="polite">
	                  <Progress percent={journalExportProgress.percent} size="small" />
	                  <span>{journalExportProgress.label}</span>
	                </div>
	              ) : null}
	            </div>
	          </Modal>
	          <AppLockSettingsModal
	            open={appLockSettingsOpen}
            loading={appLockLoading}
            settings={appLockSettings}
            onCancel={() => setAppLockSettingsOpen(false)}
            onSubmit={(settings) => void saveLockSettings(settings)}
          />
	          <Modal
	            title="错误日志"
	            open={errorLogOpen}
	            footer={[
	              <Button key="export" disabled={!filteredErrorDiagnostics.length} onClick={exportFilteredErrorLog}>导出日志</Button>,
	              <Button key="clear" danger disabled={!errorDiagnostics.length} onClick={clearErrorLog}>清空日志</Button>,
	              <Button key="close" type="primary" onClick={() => setErrorLogOpen(false)}>关闭</Button>,
	            ]}
	            onCancel={() => setErrorLogOpen(false)}
	          >
	            <div className="error-log-controls">
	              <label>
	                <span>场景</span>
	                <select
	                  aria-label="错误场景筛选"
	                  value={errorLogScenario}
	                  onChange={(event) => setErrorLogScenario(event.target.value as ErrorScenarioFilter)}
	                >
	                  {Object.entries(errorScenarioLabels).map(([value, label]) => (
	                    <option key={value} value={value}>{label}</option>
	                  ))}
	                </select>
	              </label>
	              <label>
	                <span>搜索</span>
	                <Input
	                  aria-label="错误日志搜索"
	                  placeholder="搜索操作、错误、建议或文件"
	                  value={errorLogQuery}
	                  onChange={(event) => setErrorLogQuery(event.target.value)}
	                />
	              </label>
	            </div>
	            <div className="error-log-list">
	              {filteredErrorDiagnostics.length ? filteredErrorDiagnostics.map((diagnostic) => {
	                const recoveryActions = getErrorRecoveryActions(diagnostic);
	                return (
	                  <article className="error-log-item" key={diagnostic.id}>
	                    <div className="error-log-title">
	                      <strong>{diagnostic.operation}</strong>
	                      <span>{diagnostic.occurredAt}</span>
	                    </div>
	                    <p>场景：{errorScenarioLabels[diagnostic.scenario]}</p>
	                    <p>{diagnostic.message}</p>
	                    <p>{diagnostic.suggestion}</p>
	                    <div className="error-log-actions">
	                      {recoveryActions.map((action) => (
	                        <Button key={action.id} size="small" onClick={() => void executeErrorRecoveryAction(action, diagnostic)}>{action.label}</Button>
	                      ))}
	                      <Button size="small" onClick={() => navigator.clipboard.writeText(serializeErrorDiagnostic(diagnostic))}>复制诊断</Button>
	                    </div>
	                  </article>
	                );
	              }) : <p className="empty-note">{errorDiagnostics.length ? "没有匹配的错误日志" : "暂无错误日志"}</p>}
	            </div>
	          </Modal>
          <Modal
            title="重命名"
            open={Boolean(renameTarget)}
            okText="保存"
            cancelText="取消"
            confirmLoading={actionLoading}
            onCancel={() => {
              setRenameTarget(null);
              setRenameValue("");
            }}
            onOk={() => void renameEntry()}
          >
            <Input
              aria-label="新名称"
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              onPressEnter={() => void renameEntry()}
            />
          </Modal>
          <Modal
            title="检测到外部修改"
            open={Boolean(conflictStatus)}
            footer={[
              <Button key="later" onClick={() => setConflictStatus(null)}>
                稍后处理
              </Button>,
              <Button key="external" loading={conflictLoading} onClick={() => void loadExternalVersion()}>
                加载外部版本
              </Button>,
              <Button key="copy" loading={conflictLoading} onClick={() => void saveCurrentDraftAsCopy()}>
                另存副本
              </Button>,
              <Button key="overwrite" danger type="primary" loading={conflictLoading} onClick={() => void overwriteWithCurrentDraft()}>
                保留当前版本
              </Button>,
            ]}
            onCancel={() => setConflictStatus(null)}
          >
            <p>这个文件在你打开后被其它程序修改过。为避免覆盖外部改动，MoKnow 已暂停保存当前草稿。</p>
            <p>你可以保留当前版本并覆盖磁盘文件，加载磁盘上的外部版本，或把当前草稿另存为一个副本。</p>
            {conflictStatus?.currentModifiedAt ? <p>外部修改时间：{conflictStatus.currentModifiedAt}</p> : null}
          </Modal>

          {appLocked ? (
            <AppLockOverlay
              biometricEnabled={appLockSettings.biometricEnabled}
              error={unlockError}
              loading={unlockLoading}
              recoveryAvailable={Boolean(appLockSettings.recoveryCodeHash)}
              onBiometricUnlock={() => void unlockWithBiometric()}
              onResetPassword={(input) => void resetLockPassword(input)}
              onUnlock={(password) => void unlockApplication(password)}
            />
          ) : null}

          {!appLocked ? <StatusBar modeLabel={editorMode === "source" ? "代码模式" : editorMode === "split" ? "双视图模式" : "所见即所得"} repositoryName={repository?.name ?? "MoKnow 日记仓库"} wordCount={wordCount} dirty={dirty} saveStatus={saveStatus} /> : null}
        </div>
      </AntdApp>
    </ConfigProvider>
  );
}

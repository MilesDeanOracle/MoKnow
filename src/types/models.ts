import type { ThemeConfig as AntdThemeConfig } from "antd";

export type EditorMode = "source" | "split" | "wysiwyg";
export type ThemeName = "day" | "night";
export type PluginThemePreference = `plugin:${string}`;
export type ThemePreference = ThemeName | "system" | "custom" | PluginThemePreference;
export type ScopedThemePreference = ThemePreference | "inherit";
export type RepositoryCategory = "favorites" | "journal" | "documents" | "trash";
export type FileNodeType = "category" | "directory" | "markdown" | "asset";
export type FavoriteTargetKind = "directory" | "markdown";
export type RestoreStrategy = "abort" | "overwrite" | "rename";

export interface CommandResult<T> {
  success: boolean;
  data?: T;
  message?: string;
  errorCode?: string;
}

export interface FileNode {
  id: string;
  name: string;
  path: string;
  type: FileNodeType;
  depth: number;
  children?: FileNode[];
  contentKey?: string;
  category?: RepositoryCategory;
  isFavorite?: boolean;
  isPinned?: boolean;
  isVirtual?: boolean;
  deletedAt?: string;
}

export interface MarkdownFile {
  id: string;
  name: string;
  path: string;
  raw: string;
  modifiedAt?: string;
}

export interface DiaryDateStatus {
  date: string;
  exists: boolean;
  path: string;
}

export interface Repository {
  id: string;
  name: string;
  rootPath: string;
  files: FileNode[];
  isMock?: boolean;
}

export interface RecentRepository {
  name: string;
  rootPath: string;
  openedAt: string;
  missing?: boolean;
}

export interface RecentFile {
  fileId: string;
  name: string;
  relativePath: string;
  lastOpenedAt?: string;
  lastEditedAt?: string;
  isPinned: boolean;
}

export interface TagSummary {
  name: string;
  color?: string;
  count: number;
}

export interface SearchFilters {
  query?: string;
  tag?: string;
  dateFrom?: string;
  dateTo?: string;
  fileType?: "all" | "journal" | "document";
}

export interface SearchResult {
  fileId: string;
  name: string;
  relativePath: string;
  snippet: string;
  highlightedSnippet: string;
  diaryDate?: string;
  tags: string[];
  score: number;
}

export interface InboxItem {
  id: string;
  createdAt: string;
  content: string;
}

export interface OrganizeView {
  inbox: InboxItem[];
  untaggedJournals: SearchResult[];
  recentEdited: RecentFile[];
  favorites: RecentFile[];
}

export interface DiarySettings {
  autoOpenToday: boolean;
  diaryRoot: string;
  diaryPathPattern: string;
  diaryFileNamePattern: string;
  diaryTemplate: string;
}

export interface CursorPosition {
  line: number;
  column: number;
}

export interface WorkspaceState extends DiarySettings {
  repositoryId: string;
  lastOpenedFile?: string;
  lastEditMode?: EditorMode;
  lastCursorPosition?: CursorPosition;
}

export interface CreateRepositoryInput {
  name: string;
  basePath: string;
}

export interface SaveResult {
  fileId: string;
  saved: boolean;
  savedAt: string;
  modifiedAt?: string;
}

export interface FileChangeStatus {
  fileId: string;
  changed: boolean;
  currentModifiedAt?: string;
  knownModifiedAt?: string;
}

export interface AttachmentResult {
  fileName: string;
  absolutePath: string;
  relativePath: string;
  markdownText: string;
}

export interface BackupResult {
  fileName: string;
  absolutePath: string;
  includedFiles: number;
  skippedPrivateFiles?: number;
  sizeBytes: number;
  createdAt: string;
}

export interface BackupRepositoryInput {
  outputPath?: string;
  excludePrivateData?: boolean;
}

export interface RestoreBackupResult {
  repository: Repository;
  backupFileName: string;
  backupPath: string;
  restoredFiles: number;
  skippedConflictingFiles: number;
  strategy: BackupRestoreStrategy;
  restoredAt: string;
}

export type BackupRestoreStrategy = "replace" | "merge_keep_current";

export interface RestoreBackupInput {
  backupPath?: string;
  strategy?: BackupRestoreStrategy;
}

export interface RestorePreviewResult {
  backupFileName: string;
  backupPath: string;
  totalBackupFiles: number;
  addedFiles: number;
  modifiedFiles: number;
  unchangedFiles: number;
  deletedFiles: number;
  sampleAdded: string[];
  sampleModified: string[];
  sampleDeleted: string[];
}

export interface ExportResult {
  fileName: string;
  absolutePath: string;
  sizeBytes: number;
  createdAt: string;
}

export interface CredentialStatus {
  key: string;
  exists: boolean;
  storage: "system-keychain" | "mock-secure-store";
}

export interface ExportHtmlToPathInput {
  outputPath: string;
  html: string;
}

export interface AiContext {
  fileName: string;
  filePath: string;
  repositoryName: string;
  currentContent?: string;
  scope?: AiContextScope;
  entries?: AiContextEntry[];
  retrievalStatus?: AiRetrievalStatus;
}

export type AiContextScope = "current_file" | "week" | "month" | "repository";
export type AiDiaryAction = "today_summary" | "gentle_prompt" | "week_review" | "month_review";
export type AiProviderKind = "local" | "openai_compatible";

export interface AiRetrievalStatus {
  mode: "current_file" | "full_text" | "local_vector" | "external_embedding";
  state: "ready" | "empty" | "not_ready" | "building" | "error";
  documentCount: number;
  message: string;
  query?: string;
}

export interface AiProviderSettings {
  provider: AiProviderKind;
  presetId?: string;
  endpoint: string;
  model: string;
  streamEnabled: boolean;
  apiKeyRequired?: boolean;
  apiKeyCredentialKey: string;
}

export interface AiProviderStatus {
  configured: boolean;
  apiKeyStored: boolean;
  storage: CredentialStatus["storage"] | "unavailable";
}

export interface AiContextEntry {
  fileId?: string;
  title: string;
  path: string;
  content: string;
  date?: string;
  snippet?: string;
  score?: number;
}

export interface AiSourceReference {
  fileId?: string;
  title: string;
  path?: string;
  snippet?: string;
}

export interface AiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Array<string | AiSourceReference>;
  createdAt: string;
}

export interface AppThemeConfig {
  mode: "light" | "dark" | "system";
  primaryColor: string;
  compact: boolean;
  borderRadius: number;
  fontSize: number;
}

export interface UserSettings {
  themePreference: ThemePreference;
  customTheme: AppThemeConfig;
  customCss: string;
  repositorySettings?: Record<string, ScopedUserSettings>;
  fileSettings?: Record<string, ScopedUserSettings>;
}

export interface ScopedUserSettings {
  themePreference?: ScopedThemePreference;
  customCss?: string;
}

export interface ThemeBuildResult {
  antdTheme: AntdThemeConfig;
  cssVars: Record<string, string>;
}

export type PluginPermission =
  | "read_repository"
  | "write_repository"
  | "command"
  | "sidebar"
  | "markdown_render"
  | "ai"
  | "theme"
  | "network";

export type PluginRuntimeStatus = "enabled" | "disabled" | "failed";

export interface PluginCommandContribution {
  id: string;
  title: string;
  category?: string;
}

export interface PluginSidebarContribution {
  id: string;
  title: string;
}

export interface PluginThemeContribution {
  id: string;
  title?: string;
  theme?: Partial<AppThemeConfig>;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  entry?: string;
  permissions: PluginPermission[];
  contributes?: {
    commands?: PluginCommandContribution[];
    sidebars?: PluginSidebarContribution[];
    markdownRenderers?: string[];
    aiTools?: string[];
    themes?: Array<string | PluginThemeContribution>;
  };
}

export interface PluginRegistryItem {
  manifest: PluginManifest;
  status: PluginRuntimeStatus;
  installedAt: string;
  enabledAt?: string;
  error?: string;
  sandbox?: {
    lastRunAt?: string;
    contributionsRegistered?: number;
  };
}

export interface PluginContext {
  pluginId: string;
  permissions: PluginPermission[];
  hasPermission: (permission: PluginPermission) => boolean;
  registerCommand: (command: PluginCommandContribution) => void;
  registerSidebarPanel: (panel: PluginSidebarContribution) => void;
  registerMarkdownRenderer: (rendererId: string) => void;
  registerAiTool: (toolId: string) => void;
  registerTheme: (theme: string | PluginThemeContribution) => void;
}

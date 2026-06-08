import type { ThemeConfig as AntdThemeConfig } from "antd";

export type EditorMode = "source" | "split" | "wysiwyg";
export type ThemeName = "day" | "night";
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
  isVirtual?: boolean;
  deletedAt?: string;
}

export interface MarkdownFile {
  id: string;
  name: string;
  path: string;
  raw: string;
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

export interface CreateRepositoryInput {
  name: string;
  basePath: string;
}

export interface SaveResult {
  fileId: string;
  saved: boolean;
  savedAt: string;
}

export interface AiContext {
  fileName: string;
  filePath: string;
  repositoryName: string;
}

export interface AiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: string[];
  createdAt: string;
}

export interface AppThemeConfig {
  mode: "light" | "dark" | "system";
  primaryColor: string;
  compact: boolean;
  borderRadius: number;
  fontSize: number;
}

export interface ThemeBuildResult {
  antdTheme: AntdThemeConfig;
  cssVars: Record<string, string>;
}

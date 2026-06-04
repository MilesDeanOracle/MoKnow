import type { ThemeConfig as AntdThemeConfig } from "antd";

export type EditorMode = "source" | "split" | "wysiwyg";
export type ThemeName = "day" | "night";

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
  type: "directory" | "markdown" | "asset";
  depth: number;
  children?: FileNode[];
  contentKey?: string;
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

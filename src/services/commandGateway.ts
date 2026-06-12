import { invoke } from "@tauri-apps/api/core";
import type {
  CommandResult,
  AttachmentResult,
  BackupRepositoryInput,
  BackupResult,
  CredentialStatus,
  RestoreBackupInput,
  CursorPosition,
  DiaryDateStatus,
  DiarySettings,
  ExportHtmlToPathInput,
  ExportResult,
  FavoriteTargetKind,
  FileChangeStatus,
  FileNode,
  InboxItem,
  MarkdownFile,
  OrganizeView,
  RecentFile,
  RecentRepository,
  Repository,
  RestoreBackupResult,
  RestorePreviewResult,
  RestoreStrategy,
  SaveResult,
  SearchFilters,
  SearchResult,
  TagSummary,
  WorkspaceState,
} from "../types/models";

export interface CommandGateway {
  getMockRepository(): Promise<CommandResult<Repository>>;
  createRepository(name: string, basePath: string): Promise<CommandResult<Repository>>;
  openRepository(repositoryPath: string): Promise<CommandResult<Repository>>;
  openLastRepository(): Promise<CommandResult<Repository>>;
  listRecentRepositories(): Promise<CommandResult<RecentRepository[]>>;
  listRecentFiles(repositoryId: string, listKind: string): Promise<CommandResult<RecentFile[]>>;
  clearRecentFiles(repositoryId: string, listKind: string): Promise<CommandResult<boolean>>;
  listInboxEntries(repositoryId: string): Promise<CommandResult<InboxItem[]>>;
  appendInboxEntry(repositoryId: string, content: string): Promise<CommandResult<InboxItem[]>>;
  clearInboxEntries(repositoryId: string, entryIds: string[]): Promise<CommandResult<InboxItem[]>>;
  moveInboxEntriesToToday(repositoryId: string, entryIds: string[]): Promise<CommandResult<MarkdownFile>>;
  listOrganizeView(repositoryId: string): Promise<CommandResult<OrganizeView>>;
  listTags(repositoryId: string): Promise<CommandResult<TagSummary[]>>;
  setTagColor(repositoryId: string, tagName: string, color: string): Promise<CommandResult<TagSummary[]>>;
  renameTag(repositoryId: string, oldName: string, newName: string): Promise<CommandResult<TagSummary[]>>;
  deleteTag(repositoryId: string, tagName: string): Promise<CommandResult<TagSummary[]>>;
  searchFiles(repositoryId: string, filters: SearchFilters): Promise<CommandResult<SearchResult[]>>;
  getDiarySettings(): Promise<CommandResult<DiarySettings>>;
  saveDiarySettings(settings: DiarySettings): Promise<CommandResult<DiarySettings>>;
  getWorkspaceState(repositoryId: string): Promise<CommandResult<WorkspaceState>>;
  saveWorkspaceState(repositoryId: string, fileId: string | null, editMode: string, cursorPosition?: CursorPosition | null): Promise<CommandResult<WorkspaceState>>;
  loadRepositoryTree(repositoryId: string): Promise<CommandResult<Repository>>;
  readMarkdownFile(fileId: string): Promise<CommandResult<MarkdownFile>>;
  checkFileChanged(fileId: string, knownModifiedAt?: string | null): Promise<CommandResult<FileChangeStatus>>;
  saveMarkdownFile(fileId: string, content: string): Promise<CommandResult<SaveResult>>;
  saveMarkdownFileAsCopy(fileId: string, content: string): Promise<CommandResult<MarkdownFile>>;
  saveAttachment(markdownFileId: string, fileName: string, bytes: number[]): Promise<CommandResult<AttachmentResult>>;
  backupRepository(repositoryId: string, input?: BackupRepositoryInput): Promise<CommandResult<BackupResult>>;
  restoreLatestBackup(repositoryId: string): Promise<CommandResult<RestoreBackupResult>>;
  previewRestoreBackup(repositoryId: string, backupPath?: string): Promise<CommandResult<RestorePreviewResult>>;
  restoreBackup(repositoryId: string, input?: RestoreBackupInput): Promise<CommandResult<RestoreBackupResult>>;
  exportMarkdownHtml(fileId: string, html: string): Promise<CommandResult<ExportResult>>;
  exportMarkdownPdf(fileId: string, html: string, title: string): Promise<CommandResult<ExportResult>>;
  exportHtmlToPath(input: ExportHtmlToPathInput): Promise<CommandResult<ExportResult>>;
  saveSecureCredential(key: string, secret: string): Promise<CommandResult<CredentialStatus>>;
  readSecureCredential(key: string): Promise<CommandResult<string | null>>;
  deleteSecureCredential(key: string): Promise<CommandResult<CredentialStatus>>;
  getSecureCredentialStatus(key: string): Promise<CommandResult<CredentialStatus>>;
  openTodayJournal(repositoryId: string): Promise<CommandResult<MarkdownFile>>;
  openJournalByDate(repositoryId: string, date: string): Promise<CommandResult<MarkdownFile>>;
  listDiaryMonthStatus(repositoryId: string, year: number, month: number): Promise<CommandResult<DiaryDateStatus[]>>;
  createJournalEntry(repositoryId: string): Promise<CommandResult<MarkdownFile>>;
  createDocumentDirectory(repositoryId: string, parentPath: string, name: string): Promise<CommandResult<FileNode>>;
  createDocumentFile(repositoryId: string, parentPath: string, name: string): Promise<CommandResult<MarkdownFile>>;
  moveToTrash(repositoryId: string, relativePath: string): Promise<CommandResult<Repository>>;
  restoreFromTrash(repositoryId: string, trashRecordId: string, strategy: RestoreStrategy): Promise<CommandResult<Repository>>;
  permanentlyDeleteTrashEntry(repositoryId: string, trashRecordId: string): Promise<CommandResult<Repository>>;
  clearTrash(repositoryId: string): Promise<CommandResult<Repository>>;
  addFavorite(repositoryId: string, relativePath: string, targetKind: FavoriteTargetKind): Promise<CommandResult<Repository>>;
  setFilePinned(repositoryId: string, relativePath: string, pinned: boolean): Promise<CommandResult<Repository>>;
  removeFavorite(repositoryId: string, relativePath: string): Promise<CommandResult<Repository>>;
  renameEntry(repositoryId: string, relativePath: string, newName: string): Promise<CommandResult<Repository>>;
  showInFolder(repositoryId: string, relativePath: string): Promise<CommandResult<boolean>>;
}

/**
 * 设计模式：适配器模式。
 * 原因：前端业务服务只依赖 CommandGateway 接口，不直接依赖 Tauri invoke，
 * 后续可以在测试、浏览器预览和真实桌面环境之间切换实现。
 */
export class TauriCommandGateway implements CommandGateway {
  async getMockRepository(): Promise<CommandResult<Repository>> {
    return invoke<CommandResult<Repository>>("get_mock_repository");
  }

  async createRepository(name: string, basePath: string): Promise<CommandResult<Repository>> {
    return invoke<CommandResult<Repository>>("create_repository", { name, basePath });
  }

  async openRepository(repositoryPath: string): Promise<CommandResult<Repository>> {
    return invoke<CommandResult<Repository>>("open_repository", { repositoryPath });
  }

  async openLastRepository(): Promise<CommandResult<Repository>> {
    return invoke<CommandResult<Repository>>("open_last_repository");
  }

  async listRecentRepositories(): Promise<CommandResult<RecentRepository[]>> {
    return invoke<CommandResult<RecentRepository[]>>("list_recent_repositories");
  }

  async listRecentFiles(repositoryId: string, listKind: string): Promise<CommandResult<RecentFile[]>> {
    return invoke<CommandResult<RecentFile[]>>("list_recent_files", { repositoryId, listKind });
  }

  async clearRecentFiles(repositoryId: string, listKind: string): Promise<CommandResult<boolean>> {
    return invoke<CommandResult<boolean>>("clear_recent_files", { repositoryId, listKind });
  }

  async listInboxEntries(repositoryId: string): Promise<CommandResult<InboxItem[]>> {
    return invoke<CommandResult<InboxItem[]>>("list_inbox_entries", { repositoryId });
  }

  async appendInboxEntry(repositoryId: string, content: string): Promise<CommandResult<InboxItem[]>> {
    return invoke<CommandResult<InboxItem[]>>("append_inbox_entry", { repositoryId, content });
  }

  async clearInboxEntries(repositoryId: string, entryIds: string[]): Promise<CommandResult<InboxItem[]>> {
    return invoke<CommandResult<InboxItem[]>>("clear_inbox_entries", { repositoryId, entryIds });
  }

  async moveInboxEntriesToToday(repositoryId: string, entryIds: string[]): Promise<CommandResult<MarkdownFile>> {
    return invoke<CommandResult<MarkdownFile>>("move_inbox_entries_to_today", { repositoryId, entryIds });
  }

  async listOrganizeView(repositoryId: string): Promise<CommandResult<OrganizeView>> {
    return invoke<CommandResult<OrganizeView>>("list_organize_view", { repositoryId });
  }

  async listTags(repositoryId: string): Promise<CommandResult<TagSummary[]>> {
    return invoke<CommandResult<TagSummary[]>>("list_tags", { repositoryId });
  }

  async setTagColor(repositoryId: string, tagName: string, color: string): Promise<CommandResult<TagSummary[]>> {
    return invoke<CommandResult<TagSummary[]>>("set_tag_color", { repositoryId, tagName, color });
  }

  async renameTag(repositoryId: string, oldName: string, newName: string): Promise<CommandResult<TagSummary[]>> {
    return invoke<CommandResult<TagSummary[]>>("rename_tag", { repositoryId, oldName, newName });
  }

  async deleteTag(repositoryId: string, tagName: string): Promise<CommandResult<TagSummary[]>> {
    return invoke<CommandResult<TagSummary[]>>("delete_tag", { repositoryId, tagName });
  }

  async searchFiles(repositoryId: string, filters: SearchFilters): Promise<CommandResult<SearchResult[]>> {
    return invoke<CommandResult<SearchResult[]>>("search_files", { repositoryId, filters });
  }

  async getDiarySettings(): Promise<CommandResult<DiarySettings>> {
    return invoke<CommandResult<DiarySettings>>("get_diary_settings");
  }

  async saveDiarySettings(settings: DiarySettings): Promise<CommandResult<DiarySettings>> {
    return invoke<CommandResult<DiarySettings>>("save_diary_settings", { settings });
  }

  async getWorkspaceState(repositoryId: string): Promise<CommandResult<WorkspaceState>> {
    return invoke<CommandResult<WorkspaceState>>("get_workspace_state", { repositoryId });
  }

  async saveWorkspaceState(repositoryId: string, fileId: string | null, editMode: string, cursorPosition?: CursorPosition | null): Promise<CommandResult<WorkspaceState>> {
    return invoke<CommandResult<WorkspaceState>>("save_workspace_state", { repositoryId, fileId, editMode, cursorPosition });
  }

  async loadRepositoryTree(repositoryId: string): Promise<CommandResult<Repository>> {
    return invoke<CommandResult<Repository>>("load_repository_tree", { repositoryId });
  }

  async readMarkdownFile(fileId: string): Promise<CommandResult<MarkdownFile>> {
    return invoke<CommandResult<MarkdownFile>>("read_markdown_file", { fileId });
  }

  async checkFileChanged(fileId: string, knownModifiedAt?: string | null): Promise<CommandResult<FileChangeStatus>> {
    return invoke<CommandResult<FileChangeStatus>>("check_file_changed", { fileId, knownModifiedAt });
  }

  async saveMarkdownFile(fileId: string, content: string): Promise<CommandResult<SaveResult>> {
    return invoke<CommandResult<SaveResult>>("save_markdown_file", { fileId, content });
  }

  async saveMarkdownFileAsCopy(fileId: string, content: string): Promise<CommandResult<MarkdownFile>> {
    return invoke<CommandResult<MarkdownFile>>("save_markdown_file_as_copy", { fileId, content });
  }

  async saveAttachment(markdownFileId: string, fileName: string, bytes: number[]): Promise<CommandResult<AttachmentResult>> {
    return invoke<CommandResult<AttachmentResult>>("save_attachment", { markdownFileId, fileName, bytes });
  }

  async backupRepository(repositoryId: string, input: BackupRepositoryInput = {}): Promise<CommandResult<BackupResult>> {
    return invoke<CommandResult<BackupResult>>("backup_repository", {
      repositoryId,
      outputPath: input.outputPath,
      excludePrivateData: input.excludePrivateData,
    });
  }

  async restoreLatestBackup(repositoryId: string): Promise<CommandResult<RestoreBackupResult>> {
    return invoke<CommandResult<RestoreBackupResult>>("restore_latest_backup", { repositoryId });
  }

  async previewRestoreBackup(repositoryId: string, backupPath?: string): Promise<CommandResult<RestorePreviewResult>> {
    return invoke<CommandResult<RestorePreviewResult>>("preview_restore_backup", { repositoryId, backupPath });
  }

  async restoreBackup(repositoryId: string, input: RestoreBackupInput = {}): Promise<CommandResult<RestoreBackupResult>> {
    return invoke<CommandResult<RestoreBackupResult>>("restore_backup", {
      repositoryId,
      backupPath: input.backupPath,
      strategy: input.strategy,
    });
  }

  async exportMarkdownHtml(fileId: string, html: string): Promise<CommandResult<ExportResult>> {
    return invoke<CommandResult<ExportResult>>("export_markdown_html", { fileId, html });
  }

  async exportMarkdownPdf(fileId: string, html: string, title: string): Promise<CommandResult<ExportResult>> {
    return invoke<CommandResult<ExportResult>>("export_markdown_pdf", { fileId, html, title });
  }

  async exportHtmlToPath(input: ExportHtmlToPathInput): Promise<CommandResult<ExportResult>> {
    return invoke<CommandResult<ExportResult>>("export_html_to_path", {
      outputPath: input.outputPath,
      html: input.html,
    });
  }

  async saveSecureCredential(key: string, secret: string): Promise<CommandResult<CredentialStatus>> {
    return invoke<CommandResult<CredentialStatus>>("save_secure_credential", { key, secret });
  }

  async readSecureCredential(key: string): Promise<CommandResult<string | null>> {
    return invoke<CommandResult<string | null>>("read_secure_credential", { key });
  }

  async deleteSecureCredential(key: string): Promise<CommandResult<CredentialStatus>> {
    return invoke<CommandResult<CredentialStatus>>("delete_secure_credential", { key });
  }

  async getSecureCredentialStatus(key: string): Promise<CommandResult<CredentialStatus>> {
    return invoke<CommandResult<CredentialStatus>>("get_secure_credential_status", { key });
  }

  async openTodayJournal(repositoryId: string): Promise<CommandResult<MarkdownFile>> {
    return invoke<CommandResult<MarkdownFile>>("open_today_journal", { repositoryId });
  }

  async openJournalByDate(repositoryId: string, date: string): Promise<CommandResult<MarkdownFile>> {
    return invoke<CommandResult<MarkdownFile>>("open_journal_by_date", { repositoryId, date });
  }

  async listDiaryMonthStatus(repositoryId: string, year: number, month: number): Promise<CommandResult<DiaryDateStatus[]>> {
    return invoke<CommandResult<DiaryDateStatus[]>>("list_diary_month_status", { repositoryId, year, month });
  }

  async createJournalEntry(repositoryId: string): Promise<CommandResult<MarkdownFile>> {
    return invoke<CommandResult<MarkdownFile>>("create_journal_entry", { repositoryId });
  }

  async createDocumentDirectory(repositoryId: string, parentPath: string, name: string): Promise<CommandResult<FileNode>> {
    return invoke<CommandResult<FileNode>>("create_document_directory", { repositoryId, parentPath, name });
  }

  async createDocumentFile(repositoryId: string, parentPath: string, name: string): Promise<CommandResult<MarkdownFile>> {
    return invoke<CommandResult<MarkdownFile>>("create_document_file", { repositoryId, parentPath, name });
  }

  async moveToTrash(repositoryId: string, relativePath: string): Promise<CommandResult<Repository>> {
    return invoke<CommandResult<Repository>>("move_to_trash", { repositoryId, relativePath });
  }

  async restoreFromTrash(repositoryId: string, trashRecordId: string, strategy: RestoreStrategy): Promise<CommandResult<Repository>> {
    return invoke<CommandResult<Repository>>("restore_from_trash", { repositoryId, trashRecordId, strategy });
  }

  async permanentlyDeleteTrashEntry(repositoryId: string, trashRecordId: string): Promise<CommandResult<Repository>> {
    return invoke<CommandResult<Repository>>("permanently_delete_trash_entry", { repositoryId, trashRecordId });
  }

  async clearTrash(repositoryId: string): Promise<CommandResult<Repository>> {
    return invoke<CommandResult<Repository>>("clear_trash", { repositoryId });
  }

  async addFavorite(repositoryId: string, relativePath: string, targetKind: FavoriteTargetKind): Promise<CommandResult<Repository>> {
    return invoke<CommandResult<Repository>>("add_favorite", { repositoryId, relativePath, targetKind });
  }

  async setFilePinned(repositoryId: string, relativePath: string, pinned: boolean): Promise<CommandResult<Repository>> {
    return invoke<CommandResult<Repository>>("set_file_pinned", { repositoryId, relativePath, pinned });
  }

  async removeFavorite(repositoryId: string, relativePath: string): Promise<CommandResult<Repository>> {
    return invoke<CommandResult<Repository>>("remove_favorite", { repositoryId, relativePath });
  }

  async renameEntry(repositoryId: string, relativePath: string, newName: string): Promise<CommandResult<Repository>> {
    return invoke<CommandResult<Repository>>("rename_entry", { repositoryId, relativePath, newName });
  }

  async showInFolder(repositoryId: string, relativePath: string): Promise<CommandResult<boolean>> {
    return invoke<CommandResult<boolean>>("show_in_folder", { repositoryId, relativePath });
  }
}

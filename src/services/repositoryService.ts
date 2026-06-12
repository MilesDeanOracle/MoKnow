import type { CommandGateway } from "./commandGateway";
import { commandResultToError } from "./appErrorService";
import type {
  AttachmentResult,
  BackupRepositoryInput,
  BackupResult,
  CommandResult,
  CredentialStatus,
  DiarySettings,
  ExportResult,
  ExportHtmlToPathInput,
  CursorPosition,
  DiaryDateStatus,
  FavoriteTargetKind,
  FileChangeStatus,
  FileNode,
  InboxItem,
  MarkdownFile,
  OrganizeView,
  RecentFile,
  RecentRepository,
  Repository,
  RestoreBackupInput,
  RestoreBackupResult,
  RestorePreviewResult,
  RestoreStrategy,
  SaveResult,
  SearchFilters,
  SearchResult,
  TagSummary,
  WorkspaceState,
} from "../types/models";

/**
 * 设计模式：外观模式。
 * 原因：仓库加载、文件读取、文件保存都会经过 Tauri 命令或 mock 网关，
 * UI 只需要调用这个统一入口，避免组件直接处理命令返回结构和错误分支。
 */
export class RepositoryService {
  private readonly searchCache = new Map<string, SearchResult[]>();
  private readonly tagCache = new Map<string, TagSummary[]>();
  private readonly searchIndexVersions = new Map<string, number>();

  constructor(private readonly gateway: CommandGateway) {}

  async loadRepository(): Promise<Repository> {
    const lastRepository = await this.gateway.openLastRepository();
    if (lastRepository.success && lastRepository.data) {
      return lastRepository.data;
    }

    const result = await this.gateway.getMockRepository();
    return this.unwrap(result, "加载仓库失败");
  }

  async createRepository(name: string, basePath: string): Promise<Repository> {
    const result = await this.gateway.createRepository(name, basePath);
    const repository = this.unwrap(result, "创建仓库失败");
    this.invalidateSearchIndex(repository.id);
    return repository;
  }

  async openRepository(repositoryPath: string): Promise<Repository> {
    const result = await this.gateway.openRepository(repositoryPath);
    const repository = this.unwrap(result, "打开仓库失败");
    this.invalidateSearchIndex(repository.id);
    return repository;
  }

  async openLastRepository(): Promise<Repository> {
    const result = await this.gateway.openLastRepository();
    return this.unwrap(result, "打开上次仓库失败");
  }

  async listRecentRepositories(): Promise<RecentRepository[]> {
    const result = await this.gateway.listRecentRepositories();
    return this.unwrap(result, "加载最近仓库失败");
  }

  async listRecentFiles(repositoryId: string, listKind: "opened" | "edited"): Promise<RecentFile[]> {
    const result = await this.gateway.listRecentFiles(repositoryId, listKind);
    return this.unwrap(result, "加载最近文件失败");
  }

  async clearRecentFiles(repositoryId: string, listKind: "opened" | "edited" | "all"): Promise<boolean> {
    const result = await this.gateway.clearRecentFiles(repositoryId, listKind);
    return this.unwrap(result, "清空最近文件失败");
  }

  async listInboxEntries(repositoryId: string): Promise<InboxItem[]> {
    const result = await this.gateway.listInboxEntries(repositoryId);
    return this.unwrap(result, "加载收件箱失败");
  }

  async appendInboxEntry(repositoryId: string, content: string): Promise<InboxItem[]> {
    const result = await this.gateway.appendInboxEntry(repositoryId, content);
    const entries = this.unwrap(result, "写入收件箱失败");
    this.invalidateSearchIndex(repositoryId);
    return entries;
  }

  async clearInboxEntries(repositoryId: string, entryIds: string[]): Promise<InboxItem[]> {
    const result = await this.gateway.clearInboxEntries(repositoryId, entryIds);
    const entries = this.unwrap(result, "清空收件箱失败");
    this.invalidateSearchIndex(repositoryId);
    return entries;
  }

  async moveInboxEntriesToToday(repositoryId: string, entryIds: string[]): Promise<MarkdownFile> {
    const result = await this.gateway.moveInboxEntriesToToday(repositoryId, entryIds);
    const file = this.unwrap(result, "整理到今日日记失败");
    this.invalidateSearchIndex(repositoryId);
    return file;
  }

  async listOrganizeView(repositoryId: string): Promise<OrganizeView> {
    const result = await this.gateway.listOrganizeView(repositoryId);
    return this.unwrap(result, "加载整理视图失败");
  }

  async listTags(repositoryId: string): Promise<TagSummary[]> {
    const cached = this.tagCache.get(repositoryId);
    if (cached) return cached.map((tag) => ({ ...tag }));

    const result = await this.gateway.listTags(repositoryId);
    const tags = this.unwrap(result, "加载标签失败");
    this.tagCache.set(repositoryId, tags.map((tag) => ({ ...tag })));
    return tags;
  }

  async setTagColor(repositoryId: string, tagName: string, color: string): Promise<TagSummary[]> {
    const result = await this.gateway.setTagColor(repositoryId, tagName, color);
    const tags = this.unwrap(result, "更新标签颜色失败");
    this.tagCache.set(repositoryId, tags.map((tag) => ({ ...tag })));
    return tags;
  }

  async renameTag(repositoryId: string, oldName: string, newName: string): Promise<TagSummary[]> {
    const result = await this.gateway.renameTag(repositoryId, oldName, newName);
    const tags = this.unwrap(result, "重命名标签失败");
    this.invalidateSearchIndex(repositoryId);
    this.tagCache.set(repositoryId, tags.map((tag) => ({ ...tag })));
    return tags;
  }

  async deleteTag(repositoryId: string, tagName: string): Promise<TagSummary[]> {
    const result = await this.gateway.deleteTag(repositoryId, tagName);
    const tags = this.unwrap(result, "删除标签失败");
    this.invalidateSearchIndex(repositoryId);
    this.tagCache.set(repositoryId, tags.map((tag) => ({ ...tag })));
    return tags;
  }

  async searchFiles(repositoryId: string, filters: SearchFilters): Promise<SearchResult[]> {
    const cacheKey = this.searchCacheKey(repositoryId, filters);
    const cached = this.searchCache.get(cacheKey);
    if (cached) return cached.map((result) => ({ ...result, tags: [...result.tags] }));

    const result = await this.gateway.searchFiles(repositoryId, filters);
    const results = this.unwrap(result, "搜索失败");
    this.searchCache.set(cacheKey, results.map((item) => ({ ...item, tags: [...item.tags] })));
    return results;
  }

  async getDiarySettings(): Promise<DiarySettings> {
    const result = await this.gateway.getDiarySettings();
    return this.unwrap(result, "加载日记设置失败");
  }

  async saveDiarySettings(settings: DiarySettings): Promise<DiarySettings> {
    const result = await this.gateway.saveDiarySettings(settings);
    return this.unwrap(result, "保存日记设置失败");
  }

  async getWorkspaceState(repositoryId: string): Promise<WorkspaceState> {
    const result = await this.gateway.getWorkspaceState(repositoryId);
    return this.unwrap(result, "加载工作区状态失败");
  }

  async saveWorkspaceState(repositoryId: string, fileId: string | null, editMode: string, cursorPosition?: CursorPosition | null): Promise<WorkspaceState> {
    const result = await this.gateway.saveWorkspaceState(repositoryId, fileId, editMode, cursorPosition);
    return this.unwrap(result, "保存工作区状态失败");
  }

  async loadRepositoryTree(repositoryId: string): Promise<Repository> {
    const result = await this.gateway.loadRepositoryTree(repositoryId);
    return this.unwrap(result, "加载文件树失败");
  }

  async readFile(fileId: string): Promise<MarkdownFile> {
    const result = await this.gateway.readMarkdownFile(fileId);
    return this.unwrap(result, "读取文件失败");
  }

  async checkFileChanged(fileId: string, knownModifiedAt?: string | null): Promise<FileChangeStatus> {
    const result = await this.gateway.checkFileChanged(fileId, knownModifiedAt);
    return this.unwrap(result, "检查外部修改失败");
  }

  async saveFile(fileId: string, content: string): Promise<SaveResult> {
    const result = await this.gateway.saveMarkdownFile(fileId, content);
    const saved = this.unwrap(result, "保存文件失败");
    this.invalidateSearchIndexForFileId(fileId);
    return saved;
  }

  async saveFileAsCopy(fileId: string, content: string): Promise<MarkdownFile> {
    const result = await this.gateway.saveMarkdownFileAsCopy(fileId, content);
    const file = this.unwrap(result, "另存副本失败");
    this.invalidateSearchIndexForFileId(fileId);
    return file;
  }

  async saveAttachment(markdownFileId: string, fileName: string, bytes: number[]): Promise<AttachmentResult> {
    const result = await this.gateway.saveAttachment(markdownFileId, fileName, bytes);
    return this.unwrap(result, "保存附件失败");
  }

  async backupRepository(repositoryId: string, input?: BackupRepositoryInput): Promise<BackupResult> {
    const result = await this.gateway.backupRepository(repositoryId, input);
    return this.unwrap(result, "备份仓库失败");
  }

  async restoreLatestBackup(repositoryId: string): Promise<RestoreBackupResult> {
    const result = await this.gateway.restoreLatestBackup(repositoryId);
    const restored = this.unwrap(result, "恢复备份失败");
    this.invalidateSearchIndex(repositoryId);
    return restored;
  }

  async previewRestoreBackup(repositoryId: string, backupPath?: string): Promise<RestorePreviewResult> {
    const result = await this.gateway.previewRestoreBackup(repositoryId, backupPath);
    return this.unwrap(result, "预览恢复备份失败");
  }

  async restoreBackup(repositoryId: string, input?: RestoreBackupInput): Promise<RestoreBackupResult> {
    const result = await this.gateway.restoreBackup(repositoryId, input);
    const restored = this.unwrap(result, "恢复备份失败");
    this.invalidateSearchIndex(repositoryId);
    return restored;
  }

  async exportMarkdownHtml(fileId: string, html: string): Promise<ExportResult> {
    const result = await this.gateway.exportMarkdownHtml(fileId, html);
    return this.unwrap(result, "导出 HTML 失败");
  }

  async exportMarkdownPdf(fileId: string, html: string, title: string): Promise<ExportResult> {
    const result = await this.gateway.exportMarkdownPdf(fileId, html, title);
    return this.unwrap(result, "导出 PDF 失败");
  }

  async exportHtmlToPath(input: ExportHtmlToPathInput): Promise<ExportResult> {
    const result = await this.gateway.exportHtmlToPath(input);
    return this.unwrap(result, "导出 HTML 失败");
  }

  async saveSecureCredential(key: string, secret: string): Promise<CredentialStatus> {
    const result = await this.gateway.saveSecureCredential(key, secret);
    return this.unwrap(result, "保存安全凭据失败");
  }

  async readSecureCredential(key: string): Promise<string | null> {
    const result = await this.gateway.readSecureCredential(key);
    return this.unwrap(result, "读取安全凭据失败");
  }

  async deleteSecureCredential(key: string): Promise<CredentialStatus> {
    const result = await this.gateway.deleteSecureCredential(key);
    return this.unwrap(result, "删除安全凭据失败");
  }

  async getSecureCredentialStatus(key: string): Promise<CredentialStatus> {
    const result = await this.gateway.getSecureCredentialStatus(key);
    return this.unwrap(result, "查询安全凭据失败");
  }

  async openTodayJournal(repositoryId: string): Promise<MarkdownFile> {
    const result = await this.gateway.openTodayJournal(repositoryId);
    const file = this.unwrap(result, "打开今日日记失败");
    this.invalidateSearchIndex(repositoryId);
    return file;
  }

  async openJournalByDate(repositoryId: string, date: string): Promise<MarkdownFile> {
    const result = await this.gateway.openJournalByDate(repositoryId, date);
    const file = this.unwrap(result, "打开指定日期日记失败");
    this.invalidateSearchIndex(repositoryId);
    return file;
  }

  async listDiaryMonthStatus(repositoryId: string, year: number, month: number): Promise<DiaryDateStatus[]> {
    const result = await this.gateway.listDiaryMonthStatus(repositoryId, year, month);
    return this.unwrap(result, "加载日历状态失败");
  }

  async createJournalEntry(repositoryId: string): Promise<MarkdownFile> {
    const result = await this.gateway.createJournalEntry(repositoryId);
    const file = this.unwrap(result, "创建日记失败");
    this.invalidateSearchIndex(repositoryId);
    return file;
  }

  async createDocumentDirectory(repositoryId: string, parentPath: string, name: string): Promise<FileNode> {
    const result = await this.gateway.createDocumentDirectory(repositoryId, parentPath, name);
    const node = this.unwrap(result, "创建目录失败");
    this.invalidateSearchIndex(repositoryId);
    return node;
  }

  async createDocumentFile(repositoryId: string, parentPath: string, name: string): Promise<MarkdownFile> {
    const result = await this.gateway.createDocumentFile(repositoryId, parentPath, name);
    const file = this.unwrap(result, "创建文档失败");
    this.invalidateSearchIndex(repositoryId);
    return file;
  }

  async moveToTrash(repositoryId: string, relativePath: string): Promise<Repository> {
    const result = await this.gateway.moveToTrash(repositoryId, relativePath);
    const repository = this.unwrap(result, "移入回收站失败");
    this.invalidateSearchIndex(repositoryId);
    return repository;
  }

  async restoreFromTrash(repositoryId: string, trashRecordId: string, strategy: RestoreStrategy): Promise<Repository> {
    const result = await this.gateway.restoreFromTrash(repositoryId, trashRecordId, strategy);
    const repository = this.unwrap(result, "恢复回收站条目失败");
    this.invalidateSearchIndex(repositoryId);
    return repository;
  }

  async permanentlyDeleteTrashEntry(repositoryId: string, trashRecordId: string): Promise<Repository> {
    const result = await this.gateway.permanentlyDeleteTrashEntry(repositoryId, trashRecordId);
    const repository = this.unwrap(result, "永久删除失败");
    this.invalidateSearchIndex(repositoryId);
    return repository;
  }

  async clearTrash(repositoryId: string): Promise<Repository> {
    const result = await this.gateway.clearTrash(repositoryId);
    const repository = this.unwrap(result, "清空回收站失败");
    this.invalidateSearchIndex(repositoryId);
    return repository;
  }

  async addFavorite(repositoryId: string, relativePath: string, targetKind: FavoriteTargetKind): Promise<Repository> {
    const result = await this.gateway.addFavorite(repositoryId, relativePath, targetKind);
    return this.unwrap(result, "添加收藏失败");
  }

  async setFilePinned(repositoryId: string, relativePath: string, pinned: boolean): Promise<Repository> {
    const result = await this.gateway.setFilePinned(repositoryId, relativePath, pinned);
    return this.unwrap(result, "更新置顶状态失败");
  }

  async removeFavorite(repositoryId: string, relativePath: string): Promise<Repository> {
    const result = await this.gateway.removeFavorite(repositoryId, relativePath);
    return this.unwrap(result, "取消收藏失败");
  }

  async renameEntry(repositoryId: string, relativePath: string, newName: string): Promise<Repository> {
    const result = await this.gateway.renameEntry(repositoryId, relativePath, newName);
    const repository = this.unwrap(result, "重命名失败");
    this.invalidateSearchIndex(repositoryId);
    return repository;
  }

  async showInFolder(repositoryId: string, relativePath: string): Promise<boolean> {
    const result = await this.gateway.showInFolder(repositoryId, relativePath);
    return this.unwrap(result, "在系统文件夹中显示失败");
  }

  private unwrap<T>(result: CommandResult<T>, fallbackMessage: string): T {
    if (!result.success || result.data === undefined) {
      throw commandResultToError(result, fallbackMessage);
    }

    return result.data;
  }

  private searchCacheKey(repositoryId: string, filters: SearchFilters): string {
    const version = this.searchIndexVersions.get(repositoryId) ?? 0;
    const normalized = {
      query: filters.query?.trim() || "",
      tag: filters.tag?.trim() || "",
      dateFrom: filters.dateFrom || "",
      dateTo: filters.dateTo || "",
      fileType: filters.fileType ?? "all",
    };
    return JSON.stringify({ repositoryId, version, ...normalized });
  }

  private invalidateSearchIndex(repositoryId?: string): void {
    if (!repositoryId) {
      this.searchCache.clear();
      this.tagCache.clear();
      this.searchIndexVersions.clear();
      return;
    }

    this.searchIndexVersions.set(repositoryId, (this.searchIndexVersions.get(repositoryId) ?? 0) + 1);
    for (const key of this.searchCache.keys()) {
      if (key.includes(`"repositoryId":"${repositoryId}"`)) this.searchCache.delete(key);
    }
    this.tagCache.delete(repositoryId);
  }

  private invalidateSearchIndexForFileId(fileId: string): void {
    for (const repositoryId of this.searchIndexVersions.keys()) {
      this.invalidateSearchIndex(repositoryId);
    }
    if (!this.searchIndexVersions.size) {
      this.invalidateSearchIndex();
    }
    if (fileId) {
      this.tagCache.clear();
    }
  }
}

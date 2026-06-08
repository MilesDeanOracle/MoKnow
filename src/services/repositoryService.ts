import type { CommandGateway } from "./commandGateway";
import type {
  FavoriteTargetKind,
  FileNode,
  MarkdownFile,
  RecentRepository,
  Repository,
  RestoreStrategy,
  SaveResult,
} from "../types/models";

/**
 * 设计模式：外观模式。
 * 原因：仓库加载、文件读取、文件保存都会经过 Tauri 命令或 mock 网关，
 * UI 只需要调用这个统一入口，避免组件直接处理命令返回结构和错误分支。
 */
export class RepositoryService {
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
    return this.unwrap(result, "创建仓库失败");
  }

  async openRepository(repositoryPath: string): Promise<Repository> {
    const result = await this.gateway.openRepository(repositoryPath);
    return this.unwrap(result, "打开仓库失败");
  }

  async openLastRepository(): Promise<Repository> {
    const result = await this.gateway.openLastRepository();
    return this.unwrap(result, "打开上次仓库失败");
  }

  async listRecentRepositories(): Promise<RecentRepository[]> {
    const result = await this.gateway.listRecentRepositories();
    return this.unwrap(result, "加载最近仓库失败");
  }

  async loadRepositoryTree(repositoryId: string): Promise<Repository> {
    const result = await this.gateway.loadRepositoryTree(repositoryId);
    return this.unwrap(result, "加载文件树失败");
  }

  async readFile(fileId: string): Promise<MarkdownFile> {
    const result = await this.gateway.readMarkdownFile(fileId);
    return this.unwrap(result, "读取文件失败");
  }

  async saveFile(fileId: string, content: string): Promise<SaveResult> {
    const result = await this.gateway.saveMarkdownFile(fileId, content);
    return this.unwrap(result, "保存文件失败");
  }

  async createJournalEntry(repositoryId: string): Promise<MarkdownFile> {
    const result = await this.gateway.createJournalEntry(repositoryId);
    return this.unwrap(result, "创建日记失败");
  }

  async createDocumentDirectory(repositoryId: string, parentPath: string, name: string): Promise<FileNode> {
    const result = await this.gateway.createDocumentDirectory(repositoryId, parentPath, name);
    return this.unwrap(result, "创建目录失败");
  }

  async createDocumentFile(repositoryId: string, parentPath: string, name: string): Promise<MarkdownFile> {
    const result = await this.gateway.createDocumentFile(repositoryId, parentPath, name);
    return this.unwrap(result, "创建文档失败");
  }

  async moveToTrash(repositoryId: string, relativePath: string): Promise<Repository> {
    const result = await this.gateway.moveToTrash(repositoryId, relativePath);
    return this.unwrap(result, "移入回收站失败");
  }

  async restoreFromTrash(repositoryId: string, trashRecordId: string, strategy: RestoreStrategy): Promise<Repository> {
    const result = await this.gateway.restoreFromTrash(repositoryId, trashRecordId, strategy);
    return this.unwrap(result, "恢复回收站条目失败");
  }

  async permanentlyDeleteTrashEntry(repositoryId: string, trashRecordId: string): Promise<Repository> {
    const result = await this.gateway.permanentlyDeleteTrashEntry(repositoryId, trashRecordId);
    return this.unwrap(result, "永久删除失败");
  }

  async clearTrash(repositoryId: string): Promise<Repository> {
    const result = await this.gateway.clearTrash(repositoryId);
    return this.unwrap(result, "清空回收站失败");
  }

  async addFavorite(repositoryId: string, relativePath: string, targetKind: FavoriteTargetKind): Promise<Repository> {
    const result = await this.gateway.addFavorite(repositoryId, relativePath, targetKind);
    return this.unwrap(result, "添加收藏失败");
  }

  async removeFavorite(repositoryId: string, relativePath: string): Promise<Repository> {
    const result = await this.gateway.removeFavorite(repositoryId, relativePath);
    return this.unwrap(result, "取消收藏失败");
  }

  async renameEntry(repositoryId: string, relativePath: string, newName: string): Promise<Repository> {
    const result = await this.gateway.renameEntry(repositoryId, relativePath, newName);
    return this.unwrap(result, "重命名失败");
  }

  async showInFolder(repositoryId: string, relativePath: string): Promise<boolean> {
    const result = await this.gateway.showInFolder(repositoryId, relativePath);
    return this.unwrap(result, "在系统文件夹中显示失败");
  }

  private unwrap<T>(result: { success: boolean; data?: T; message?: string }, fallbackMessage: string): T {
    if (!result.success || !result.data) {
      throw new Error(result.message ?? fallbackMessage);
    }

    return result.data;
  }
}

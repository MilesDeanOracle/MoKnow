import { invoke } from "@tauri-apps/api/core";
import type {
  CommandResult,
  FavoriteTargetKind,
  FileNode,
  MarkdownFile,
  RecentRepository,
  Repository,
  RestoreStrategy,
  SaveResult,
} from "../types/models";

export interface CommandGateway {
  getMockRepository(): Promise<CommandResult<Repository>>;
  createRepository(name: string, basePath: string): Promise<CommandResult<Repository>>;
  openRepository(repositoryPath: string): Promise<CommandResult<Repository>>;
  openLastRepository(): Promise<CommandResult<Repository>>;
  listRecentRepositories(): Promise<CommandResult<RecentRepository[]>>;
  loadRepositoryTree(repositoryId: string): Promise<CommandResult<Repository>>;
  readMarkdownFile(fileId: string): Promise<CommandResult<MarkdownFile>>;
  saveMarkdownFile(fileId: string, content: string): Promise<CommandResult<SaveResult>>;
  createJournalEntry(repositoryId: string): Promise<CommandResult<MarkdownFile>>;
  createDocumentDirectory(repositoryId: string, parentPath: string, name: string): Promise<CommandResult<FileNode>>;
  createDocumentFile(repositoryId: string, parentPath: string, name: string): Promise<CommandResult<MarkdownFile>>;
  moveToTrash(repositoryId: string, relativePath: string): Promise<CommandResult<Repository>>;
  restoreFromTrash(repositoryId: string, trashRecordId: string, strategy: RestoreStrategy): Promise<CommandResult<Repository>>;
  permanentlyDeleteTrashEntry(repositoryId: string, trashRecordId: string): Promise<CommandResult<Repository>>;
  clearTrash(repositoryId: string): Promise<CommandResult<Repository>>;
  addFavorite(repositoryId: string, relativePath: string, targetKind: FavoriteTargetKind): Promise<CommandResult<Repository>>;
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

  async loadRepositoryTree(repositoryId: string): Promise<CommandResult<Repository>> {
    return invoke<CommandResult<Repository>>("load_repository_tree", { repositoryId });
  }

  async readMarkdownFile(fileId: string): Promise<CommandResult<MarkdownFile>> {
    return invoke<CommandResult<MarkdownFile>>("read_markdown_file", { fileId });
  }

  async saveMarkdownFile(fileId: string, content: string): Promise<CommandResult<SaveResult>> {
    return invoke<CommandResult<SaveResult>>("save_markdown_file", { fileId, content });
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

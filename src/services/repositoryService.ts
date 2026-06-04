import type { CommandGateway } from "./commandGateway";
import type { MarkdownFile, Repository, SaveResult } from "../types/models";

/**
 * 设计模式：外观模式。
 * 原因：仓库加载、文件读取、文件保存都会经过 Tauri 命令或 mock 网关，
 * UI 只需要调用这个统一入口，避免组件直接处理命令返回结构和错误分支。
 */
export class RepositoryService {
  constructor(private readonly gateway: CommandGateway) {}

  async loadRepository(): Promise<Repository> {
    const result = await this.gateway.getMockRepository();
    return this.unwrap(result, "加载仓库失败");
  }

  async readFile(fileId: string): Promise<MarkdownFile> {
    const result = await this.gateway.readMarkdownFile(fileId);
    return this.unwrap(result, "读取文件失败");
  }

  async saveFile(fileId: string, content: string): Promise<SaveResult> {
    const result = await this.gateway.saveMarkdownFile(fileId, content);
    return this.unwrap(result, "保存文件失败");
  }

  private unwrap<T>(result: { success: boolean; data?: T; message?: string }, fallbackMessage: string): T {
    if (!result.success || !result.data) {
      throw new Error(result.message ?? fallbackMessage);
    }

    return result.data;
  }
}

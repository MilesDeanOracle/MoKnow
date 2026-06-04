import { invoke } from "@tauri-apps/api/core";
import type { CommandResult, MarkdownFile, Repository, SaveResult } from "../types/models";

export interface CommandGateway {
  getMockRepository(): Promise<CommandResult<Repository>>;
  readMarkdownFile(fileId: string): Promise<CommandResult<MarkdownFile>>;
  saveMarkdownFile(fileId: string, content: string): Promise<CommandResult<SaveResult>>;
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

  async readMarkdownFile(fileId: string): Promise<CommandResult<MarkdownFile>> {
    return invoke<CommandResult<MarkdownFile>>("read_markdown_file", { fileId });
  }

  async saveMarkdownFile(fileId: string, content: string): Promise<CommandResult<SaveResult>> {
    return invoke<CommandResult<SaveResult>>("save_markdown_file", { fileId, content });
  }
}

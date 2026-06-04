import { mockFiles, mockRepository } from "../data/mockRepository";
import type { CommandGateway } from "./commandGateway";
import type { CommandResult, MarkdownFile, Repository, SaveResult } from "../types/models";

export function createMockCommandGateway(): CommandGateway {
  return {
    async getMockRepository(): Promise<CommandResult<Repository>> {
      return { success: true, data: mockRepository };
    },

    async readMarkdownFile(fileId: string): Promise<CommandResult<MarkdownFile>> {
      const file = mockFiles[fileId] ?? mockFiles.source;
      return { success: true, data: file };
    },

    async saveMarkdownFile(fileId: string, content: string): Promise<CommandResult<SaveResult>> {
      if (mockFiles[fileId]) {
        mockFiles[fileId] = { ...mockFiles[fileId], raw: content };
      }

      return {
        success: true,
        data: {
          fileId,
          saved: true,
          savedAt: new Date().toISOString(),
        },
      };
    },
  };
}

import { describe, expect, it } from "vitest";
import { AiCockpitService } from "./aiCockpitService";

describe("AiCockpitService", () => {
  it("creates a repository-aware assistant reply with source references", async () => {
    const service = new AiCockpitService();

    const reply = await service.sendMessage("生成摘要", {
      fileName: "2024-06-04-日记.md",
      filePath: "2024 › 06月",
      repositoryName: "MoKnow 日记仓库",
    });

    expect(reply.role).toBe("assistant");
    expect(reply.content).toContain("2024-06-04-日记.md");
    expect(reply.sources).toContain("2024-06-04-日记.md");
  });
});

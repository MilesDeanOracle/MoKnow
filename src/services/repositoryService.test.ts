import { describe, expect, it } from "vitest";
import { createMockCommandGateway } from "./mockCommandGateway";
import { RepositoryService } from "./repositoryService";

describe("RepositoryService", () => {
  it("loads the MoKnow mock repository through an async gateway", async () => {
    const service = new RepositoryService(createMockCommandGateway());

    const repository = await service.loadRepository();

    expect(repository.name).toBe("MoKnow 日记仓库");
    expect(repository.files.length).toBeGreaterThan(0);
    expect(repository.files.map((node) => node.name)).toEqual(["收藏", "日记", "文档", "回收站"]);
  });

  it("reads and saves markdown files using one unified result shape", async () => {
    const service = new RepositoryService(createMockCommandGateway());

    const file = await service.readFile("source");
    const saved = await service.saveFile("source", `${file.raw}\n\n## 测试保存`);

    expect(file.name).toBe("2024-06-04-日记.md");
    expect(saved.saved).toBe(true);
    expect(saved.fileId).toBe("source");
  });

  it("creates repositories with fixed virtual and physical categories", async () => {
    const service = new RepositoryService(createMockCommandGateway());

    const repository = await service.createRepository("个人日记", "D:/Notes");

    expect(repository.name).toBe("个人日记");
    expect(repository.rootPath).toBe("D:/Notes/个人日记");
    expect(repository.files.map((node) => [node.name, node.category, node.isVirtual])).toEqual([
      ["收藏", "favorites", true],
      ["日记", "journal", false],
      ["文档", "documents", false],
      ["回收站", "trash", false],
    ]);
  });

  it("creates duplicate same-day journal entries with an incrementing suffix", async () => {
    const service = new RepositoryService(createMockCommandGateway());

    const first = await service.createJournalEntry("daily");
    const second = await service.createJournalEntry("daily");

    expect(first.name).toBe("2026-06-04.md");
    expect(second.name).toBe("2026-06-04-2.md");
    expect(second.path).toBe("日记/2026/06/2026-06-04-2.md");
  });

  it("keeps favorite paths synchronized when a favorited directory is renamed", async () => {
    const service = new RepositoryService(createMockCommandGateway());

    await service.addFavorite("daily", "文档/项目/规划.md", "markdown");
    await service.renameEntry("daily", "文档/项目", "归档");
    const repository = await service.loadRepository();
    const favorites = repository.files.find((node) => node.category === "favorites");

    expect(favorites?.children?.[0].path).toBe("文档/归档/规划.md");
  });
});

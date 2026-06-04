import { describe, expect, it } from "vitest";
import { createMockCommandGateway } from "./mockCommandGateway";
import { RepositoryService } from "./repositoryService";

describe("RepositoryService", () => {
  it("loads the MoKnow mock repository through an async gateway", async () => {
    const service = new RepositoryService(createMockCommandGateway());

    const repository = await service.loadRepository();

    expect(repository.name).toBe("MoKnow 日记仓库");
    expect(repository.files.length).toBeGreaterThan(0);
    expect(repository.files[0].name).toBe("2024");
  });

  it("reads and saves markdown files using one unified result shape", async () => {
    const service = new RepositoryService(createMockCommandGateway());

    const file = await service.readFile("source");
    const saved = await service.saveFile("source", `${file.raw}\n\n## 测试保存`);

    expect(file.name).toBe("2024-06-04-日记.md");
    expect(saved.saved).toBe(true);
    expect(saved.fileId).toBe("source");
  });
});

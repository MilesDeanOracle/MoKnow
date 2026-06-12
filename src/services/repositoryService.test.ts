import { describe, expect, it, vi } from "vitest";
import { AppError } from "./appErrorService";
import { createMockCommandGateway } from "./mockCommandGateway";
import { RepositoryService } from "./repositoryService";
import type { FileNode } from "../types/models";

function findNode(nodes: FileNode[], path: string): FileNode | undefined {
  for (const node of nodes) {
    if (node.path === path || node.contentKey === path) return node;
    const child = node.children ? findNode(node.children, path) : undefined;
    if (child) return child;
  }
  return undefined;
}

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

  it("detects changed markdown files by modified timestamp", async () => {
    const service = new RepositoryService(createMockCommandGateway());

    const file = await service.readFile("source");
    const unchanged = await service.checkFileChanged(file.id, file.modifiedAt);
    const saved = await service.saveFile(file.id, `${file.raw}\n\n## 外部更新`);
    const changed = await service.checkFileChanged(file.id, file.modifiedAt);

    expect(unchanged.changed).toBe(false);
    expect(saved.modifiedAt).toBeTruthy();
    expect(changed.changed).toBe(true);
    expect(changed.knownModifiedAt).toBe(file.modifiedAt);
  });

  it("saves the current draft as a separate markdown copy", async () => {
    const service = new RepositoryService(createMockCommandGateway());

    const copy = await service.saveFileAsCopy("source", "# 副本内容");
    const repository = await service.loadRepositoryTree("daily");
    const copyNode = findNode(repository.files, copy.id);

    expect(copy.name).toContain("副本");
    expect(copy.raw).toBe("# 副本内容");
    expect(copyNode?.contentKey).toBe(copy.id);
  });

  it("saves image attachments and returns markdown image links", async () => {
    const service = new RepositoryService(createMockCommandGateway());

    const attachment = await service.saveAttachment("source", "daily image.png", [1, 2, 3]);

    expect(attachment.relativePath).toBe("assets/source/daily-image.png");
    expect(attachment.markdownText).toBe("![daily-image.png](assets/source/daily-image.png)");
  });

  it("stores sensitive credentials behind the command gateway", async () => {
    const service = new RepositoryService(createMockCommandGateway());

    const saved = await service.saveSecureCredential("ai.openai-api-key", "sk-test");
    const secret = await service.readSecureCredential("ai.openai-api-key");
    const status = await service.getSecureCredentialStatus("ai.openai-api-key");
    const deleted = await service.deleteSecureCredential("ai.openai-api-key");

    expect(saved).toMatchObject({ exists: true, storage: "mock-secure-store" });
    expect(secret).toBe("sk-test");
    expect(status.exists).toBe(true);
    expect(deleted.exists).toBe(false);
    await expect(service.readSecureCredential("ai.openai-api-key")).resolves.toBeNull();
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

  it("opens today's journal without creating duplicate entries", async () => {
    const service = new RepositoryService(createMockCommandGateway());

    const repository = await service.createRepository("个人日记", "D:/Notes");
    const first = await service.openTodayJournal(repository.id);
    const second = await service.openTodayJournal(repository.id);

    expect(first.name).toBe("2026-06-04.md");
    expect(second.id).toBe(first.id);
    expect(second.raw).toContain("## 明天要做");
  });

  it("saves diary settings and uses them when creating today's journal", async () => {
    const service = new RepositoryService(createMockCommandGateway());

    const repository = await service.createRepository("个人日记", "D:/Notes");
    await service.saveDiarySettings({
      autoOpenToday: true,
      diaryRoot: "Journal",
      diaryPathPattern: "{diaryRoot}/{YYYY}",
      diaryFileNamePattern: "{YYYY-MM-DD}-daily.md",
      diaryTemplate: "# {{date}}\n\n自定义模板",
    });
    const today = await service.openTodayJournal(repository.id);

    expect(today.name).toBe("2026-06-04-daily.md");
    expect(today.path).toBe("Journal/2026/2026-06-04-daily.md");
    expect(today.raw).toContain("自定义模板");
  });

  it("opens journals by date and marks written dates in month status", async () => {
    const service = new RepositoryService(createMockCommandGateway());

    const repository = await service.createRepository("个人日记", "D:/Notes");
    const opened = await service.openJournalByDate(repository.id, "2026-06-12");
    const statuses = await service.listDiaryMonthStatus(repository.id, 2026, 6);

    expect(opened.name).toBe("2026-06-12.md");
    expect(opened.raw).toContain("# 2026-06-12");
    expect(statuses.find((status) => status.date === "2026-06-12")).toMatchObject({
      exists: true,
      path: "日记/2026/06/2026-06-12.md",
    });
    expect(statuses.find((status) => status.date === "2026-06-13")?.exists).toBe(false);
  });

  it("tracks recent opened and edited files and clears recent lists", async () => {
    const service = new RepositoryService(createMockCommandGateway());

    const file = await service.readFile("source");
    await service.saveFile(file.id, `${file.raw}\n\n更新`);

    expect((await service.listRecentFiles("daily", "opened")).map((item) => item.fileId)).toContain("source");
    expect((await service.listRecentFiles("daily", "edited")).map((item) => item.fileId)).toContain("source");

    await service.clearRecentFiles("daily", "opened");
    expect(await service.listRecentFiles("daily", "opened")).toEqual([]);
    expect((await service.listRecentFiles("daily", "edited")).map((item) => item.fileId)).toContain("source");
  });

  it("pins files and keeps pinned files first in recent lists", async () => {
    const service = new RepositoryService(createMockCommandGateway());

    await service.readFile("source");
    await service.readFile("readme");
    const repository = await service.setFilePinned("daily", "source", true);
    const recentOpened = await service.listRecentFiles("daily", "opened");
    const pinnedNode = findNode(repository.files, "source");

    expect(recentOpened[0]).toMatchObject({ fileId: "source", isPinned: true });
    expect(pinnedNode?.isPinned).toBe(true);
  });

  it("persists the last opened file and edit mode", async () => {
    const service = new RepositoryService(createMockCommandGateway());

    await service.saveWorkspaceState("daily", "source", "split", { line: 5, column: 8 });
    const state = await service.getWorkspaceState("daily");

    expect(state.lastOpenedFile).toBe("source");
    expect(state.lastEditMode).toBe("split");
    expect(state.lastCursorPosition).toEqual({ line: 5, column: 8 });
  });

  it("keeps favorite paths synchronized when a favorited directory is renamed", async () => {
    const service = new RepositoryService(createMockCommandGateway());

    await service.addFavorite("daily", "文档/项目/规划.md", "markdown");
    await service.renameEntry("daily", "文档/项目", "归档");
    const repository = await service.loadRepository();
    const favorites = repository.files.find((node) => node.category === "favorites");

    expect(favorites?.children?.[0].path).toBe("文档/归档/规划.md");
  });

  it("moves files to trash then restores or permanently deletes them", async () => {
    const service = new RepositoryService(createMockCommandGateway());

    let repository = await service.moveToTrash("daily", "文档/项目/README.md");
    let trash = repository.files.find((node) => node.category === "trash");
    const trashEntry = trash?.children?.[0];

    expect(trashEntry?.deletedAt).toBeTruthy();
    expect(findNode(repository.files, "文档/项目/README.md")).toBeUndefined();

    repository = await service.restoreFromTrash("daily", trashEntry?.id ?? "", "rename");
    expect(findNode(repository.files, "文档/项目/README.md")).toBeTruthy();

    repository = await service.moveToTrash("daily", "文档/项目/README.md");
    trash = repository.files.find((node) => node.category === "trash");
    await service.permanentlyDeleteTrashEntry("daily", trash?.children?.[0]?.id ?? "");
    repository = await service.loadRepository();
    trash = repository.files.find((node) => node.category === "trash");

    expect(trash?.children).toEqual([]);
  });

  it("adds actionable advice for permission failures", async () => {
    const gateway = createMockCommandGateway();
    gateway.saveMarkdownFile = async () => ({
      success: false,
      message: "保存 Markdown 文件失败：Permission denied",
      errorCode: "SAVE_MARKDOWN_FILE_FAILED",
    });
    const service = new RepositoryService(gateway);

    await expect(service.saveFile("source", "content")).rejects.toMatchObject({
      name: "AppError",
      scenario: "permission",
      suggestion: "请检查目标文件或目录的读写权限，或换一个你有权限的仓库位置后重试。",
    });
  });

  it("adds actionable advice for missing files and disk space failures", async () => {
    const missingGateway = createMockCommandGateway();
    missingGateway.readMarkdownFile = async () => ({
      success: false,
      message: "读取 Markdown 文件失败：No such file or directory",
      errorCode: "READ_MARKDOWN_FILE_FAILED",
    });
    const missingService = new RepositoryService(missingGateway);

    await expect(missingService.readFile("missing")).rejects.toMatchObject({
      scenario: "missing_path",
      suggestion: "请确认文件或目录仍然存在；如果是同步盘，请等待同步完成后重新打开仓库。",
    });

    const diskGateway = createMockCommandGateway();
    diskGateway.saveMarkdownFile = async () => ({
      success: false,
      message: "保存 Markdown 文件失败：No space left on device",
      errorCode: "SAVE_MARKDOWN_FILE_FAILED",
    });
    const diskService = new RepositoryService(diskGateway);

    await expect(diskService.saveFile("source", "content")).rejects.toMatchObject({
      scenario: "disk_space",
      suggestion: "请释放磁盘空间，或将仓库移动到剩余空间更充足的位置后重试。",
    });
  });

  it("adds actionable advice for attachment failures", async () => {
    const gateway = createMockCommandGateway();
    gateway.saveAttachment = async () => ({
      success: false,
      message: "保存附件失败：文件名无效",
      errorCode: "SAVE_ATTACHMENT_FAILED",
    });
    const service = new RepositoryService(gateway);

    await expect(service.saveAttachment("source", "bad?.png", [1])).rejects.toBeInstanceOf(AppError);
    await expect(service.saveAttachment("source", "bad?.png", [1])).rejects.toMatchObject({
      scenario: "attachment",
      suggestion: "请确认当前笔记所在目录可写，并检查附件文件名是否合法后重试。",
    });
  });

  it("caches repeated searches and invalidates the cache after content changes", async () => {
    const gateway = createMockCommandGateway();
    const searchSpy = vi.spyOn(gateway, "searchFiles");
    const service = new RepositoryService(gateway);

    const filters = { query: "MoKnow", fileType: "all" as const };
    const first = await service.searchFiles("daily", filters);
    const second = await service.searchFiles("daily", { query: "  MoKnow  ", fileType: "all" });

    expect(second).toEqual(first);
    expect(searchSpy).toHaveBeenCalledTimes(1);

    await service.saveFile("source", `${(await service.readFile("source")).raw}\n\n缓存失效`);
    await service.searchFiles("daily", filters);

    expect(searchSpy).toHaveBeenCalledTimes(2);
  });

  it("caches tag lists and refreshes them after global tag maintenance", async () => {
    const gateway = createMockCommandGateway();
    const listTagsSpy = vi.spyOn(gateway, "listTags");
    const service = new RepositoryService(gateway);

    await service.listTags("daily");
    await service.listTags("daily");

    expect(listTagsSpy).toHaveBeenCalledTimes(1);

    await service.renameTag("daily", "工作", "事业");
    expect(listTagsSpy).toHaveBeenCalledTimes(2);
    const tags = await service.listTags("daily");

    expect(listTagsSpy).toHaveBeenCalledTimes(2);
    expect(tags.some((tag) => tag.name === "事业")).toBe(true);
  });
});

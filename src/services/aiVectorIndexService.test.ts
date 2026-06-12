import { afterEach, describe, expect, it, vi } from "vitest";
import { AI_EMBEDDING_SETTINGS_STORAGE_KEY, AI_VECTOR_INDEX_STORAGE_KEY, AiVectorIndexService, tokenizeForAiVectorIndex } from "./aiVectorIndexService";

describe("AiVectorIndexService", () => {
  afterEach(() => {
    window.localStorage.removeItem(AI_VECTOR_INDEX_STORAGE_KEY);
    window.localStorage.removeItem(AI_EMBEDDING_SETTINGS_STORAGE_KEY);
    vi.unstubAllGlobals();
  });

  it("reports a not-ready warning before the index is built", () => {
    const service = new AiVectorIndexService();

    const response = service.search("许可证");

    expect(response.results).toEqual([]);
    expect(response.status.state).toBe("not_ready");
    expect(response.warning).toContain("向量索引未完成");
  });

  it("retrieves related notes with local vector similarity and query expansion", () => {
    const service = new AiVectorIndexService();
    service.buildIndex([
      {
        fileId: "readme",
        name: "README.md",
        relativePath: "文档/项目/README.md",
        content: "## 技术栈\n\nMoKnow 使用 CodeMirror 6 提供源码编辑体验。\n\n## 许可证\n\nMIT License",
        tags: ["项目"],
      },
      {
        fileId: "daily",
        name: "2026-06-09.md",
        relativePath: "日记/2026/06/2026-06-09.md",
        content: "今天做了备份恢复和 HTML 导出。",
        tags: ["日记"],
      },
    ]);

    const response = service.search("代码编辑器");

    expect(response.status.state).toBe("ready");
    expect(response.results[0]).toEqual(expect.objectContaining({
      fileId: "readme",
      name: "README.md",
    }));
    expect(response.results[0].matchedTerms).toEqual(expect.arrayContaining(["codemirror"]));
    expect(response.results[0].snippet).toContain("CodeMirror");
  });

  it("tokenizes Chinese phrases into reusable n-grams", () => {
    expect(tokenizeForAiVectorIndex("语义检索和向量索引")).toEqual(expect.arrayContaining([
      "语义",
      "检索",
      "向量",
      "索引",
    ]));
  });

  it("persists and restores the local vector index for the same document set", async () => {
    const documents = [
      {
        fileId: "readme",
        name: "README.md",
        relativePath: "文档/项目/README.md",
        content: "CodeMirror 和 TipTap 编辑器支持 Markdown。",
      },
    ];
    const service = new AiVectorIndexService();

    await service.buildIndexWithSettings(documents);
    expect(window.localStorage.getItem(AI_VECTOR_INDEX_STORAGE_KEY)).toContain("README.md");

    const restoredService = new AiVectorIndexService();
    const status = await restoredService.buildIndexWithSettings(documents);
    const response = restoredService.search("代码编辑器");

    expect(status.persisted).toBe(true);
    expect(status.message).toContain("持久化缓存");
    expect(response.results[0].fileId).toBe("readme");
  });

  it("builds and searches with an external embedding provider", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { input: string[] };
      return new Response(JSON.stringify({
        data: body.input.map((input, index) => ({
          index,
          embedding: input.includes("代码") || input.includes("CodeMirror") ? [1, 0] : [0, 1],
        })),
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const service = new AiVectorIndexService();
    const progress = vi.fn();
    const status = await service.buildIndexWithSettings([
      {
        fileId: "readme",
        name: "README.md",
        relativePath: "文档/项目/README.md",
        content: "CodeMirror 提供源码编辑体验。",
      },
      {
        fileId: "daily",
        name: "2026-06-09.md",
        relativePath: "日记/2026/06/2026-06-09.md",
        content: "今天做了备份恢复。",
      },
    ], {
      settings: {
        provider: "openai_compatible",
        endpoint: "https://api.example.com/v1/embeddings",
        model: "test-embedding",
        apiKeyRequired: false,
        apiKeyCredentialKey: "embedding-key",
        persistIndex: true,
        batchSize: 2,
      },
      onProgress: progress,
    });

    const response = await service.searchWithSettings("代码编辑器", 2, {
      settings: {
        provider: "openai_compatible",
        endpoint: "https://api.example.com/v1/embeddings",
        model: "test-embedding",
        apiKeyRequired: false,
        apiKeyCredentialKey: "embedding-key",
        persistIndex: true,
        batchSize: 2,
      },
    });

    expect(status.mode).toBe("external_embedding");
    expect(response.results[0].fileId).toBe("readme");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({
      mode: "external_embedding",
      state: "ready",
      percent: 100,
    }));
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { AI_PROVIDER_CREDENTIAL_KEY, AI_PROVIDER_SETTINGS_STORAGE_KEY, AiCockpitService } from "./aiCockpitService";
import type { CredentialStatus } from "../types/models";

describe("AiCockpitService", () => {
  afterEach(() => {
    window.localStorage.removeItem(AI_PROVIDER_SETTINGS_STORAGE_KEY);
    vi.restoreAllMocks();
  });

  it("creates a repository-aware assistant reply with source references", async () => {
    const service = new AiCockpitService();

    const reply = await service.sendMessage("生成摘要", {
      fileName: "2024-06-04-日记.md",
      filePath: "2024 › 06月",
      repositoryName: "MoKnow 日记仓库",
    });

    expect(reply.role).toBe("assistant");
    expect(reply.content).toContain("2024-06-04-日记.md");
    expect(reply.sources).toContainEqual(expect.objectContaining({ title: "2024-06-04-日记.md" }));
  });

  it("surfaces retrieval status in local assistant replies", async () => {
    const service = new AiCockpitService();

    const reply = await service.sendMessage("查一下代码编辑器", {
      fileName: "项目规划.md",
      filePath: "文档/项目/项目规划.md",
      repositoryName: "MoKnow",
      currentContent: "# MoKnow 项目规划",
      retrievalStatus: {
        mode: "local_vector",
        state: "ready",
        documentCount: 4,
        message: "AI 本地向量索引已就绪，已用语义检索召回 2 篇相关笔记。",
        query: "代码编辑器",
      },
    });

    expect(reply.content).toContain("检索状态");
    expect(reply.content).toContain("语义检索召回 2 篇");
  });

  it("creates diary assistant outputs from explicit context entries", async () => {
    const service = new AiCockpitService();

    const reply = await service.runDiaryAction("gentle_prompt", {
      fileName: "2026-06-09.md",
      filePath: "日记/2026/06/2026-06-09.md",
      repositoryName: "MoKnow 日记仓库",
      currentContent: "# 今天\n\n完成了 PDF 导出。",
      entries: [
        {
          title: "2026-06-09.md",
          path: "日记/2026/06/2026-06-09.md",
          content: "# 今天\n\n完成了 PDF 导出。",
        },
      ],
    });

    expect(reply.content).toContain("温柔追问");
    expect(reply.content).toContain("完成了 PDF 导出");
    expect(reply.sources).toContainEqual(expect.objectContaining({ title: "2026-06-09.md" }));
  });

  it("stores provider settings with the API key in the secure credential store", async () => {
    const credentials = new Map<string, string>();
    const credentialStore = {
      saveSecureCredential: vi.fn(async (key: string, secret: string): Promise<CredentialStatus> => {
        credentials.set(key, secret);
        return { key, exists: true, storage: "mock-secure-store" };
      }),
      readSecureCredential: vi.fn(async (key: string) => credentials.get(key) ?? null),
      deleteSecureCredential: vi.fn(async (key: string): Promise<CredentialStatus> => {
        credentials.delete(key);
        return { key, exists: false, storage: "mock-secure-store" };
      }),
      getSecureCredentialStatus: vi.fn(async (key: string): Promise<CredentialStatus> => ({
        key,
        exists: credentials.has(key),
        storage: "mock-secure-store",
      })),
    };
    const service = new AiCockpitService(credentialStore);

    const result = await service.saveProviderSettings({
      provider: "openai_compatible",
      endpoint: " https://api.example.com/v1/chat/completions ",
      model: "test-model",
      streamEnabled: false,
      apiKeyCredentialKey: AI_PROVIDER_CREDENTIAL_KEY,
    }, "sk-test");

    expect(result.status.configured).toBe(true);
    expect(credentialStore.saveSecureCredential).toHaveBeenCalledWith(AI_PROVIDER_CREDENTIAL_KEY, "sk-test");
    expect(window.localStorage.getItem(AI_PROVIDER_SETTINGS_STORAGE_KEY)).toContain("test-model");
    expect(window.localStorage.getItem(AI_PROVIDER_SETTINGS_STORAGE_KEY)).not.toContain("sk-test");
  });

  it("calls an OpenAI-compatible provider with secure credentials", async () => {
    const service = new AiCockpitService({
      saveSecureCredential: vi.fn(),
      readSecureCredential: vi.fn(async () => "sk-test"),
      deleteSecureCredential: vi.fn(),
      getSecureCredentialStatus: vi.fn(async (key: string) => ({ key, exists: true, storage: "mock-secure-store" as const })),
    });
    await service.saveProviderSettings({
      provider: "openai_compatible",
      endpoint: "https://api.example.com/v1/chat/completions",
      model: "test-model",
      streamEnabled: false,
      apiKeyCredentialKey: AI_PROVIDER_CREDENTIAL_KEY,
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "真实模型回答：引用 2026-06-09.md" } }],
    }), { status: 200 }));

    const reply = await service.sendMessage("总结", {
      fileName: "2026-06-09.md",
      filePath: "日记/2026/06/2026-06-09.md",
      repositoryName: "MoKnow",
      currentContent: "# 今天\n\n配置 AI Provider。",
    });

    expect(reply.content).toContain("真实模型回答");
    expect(fetchMock).toHaveBeenCalledWith("https://api.example.com/v1/chat/completions", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ Authorization: "Bearer sk-test" }),
    }));
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).model).toBe("test-model");
  });

  it("streams OpenAI-compatible provider tokens into partial content", async () => {
    const service = new AiCockpitService({
      saveSecureCredential: vi.fn(),
      readSecureCredential: vi.fn(async () => "sk-test"),
      deleteSecureCredential: vi.fn(),
      getSecureCredentialStatus: vi.fn(async (key: string) => ({ key, exists: true, storage: "mock-secure-store" as const })),
    });
    await service.saveProviderSettings({
      provider: "openai_compatible",
      endpoint: "https://api.example.com/v1/chat/completions",
      model: "test-model",
      streamEnabled: true,
      apiKeyCredentialKey: AI_PROVIDER_CREDENTIAL_KEY,
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode("data: {\"choices\":[{\"delta\":{\"content\":\"流式\"}}]}\n\n"));
        controller.enqueue(encoder.encode("data: {\"choices\":[{\"delta\":{\"content\":\"回答\"}}]}\n\n"));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    }), { status: 200 }));
    const partials: string[] = [];

    const reply = await service.sendMessage("总结", {
      fileName: "2026-06-09.md",
      filePath: "日记/2026/06/2026-06-09.md",
      repositoryName: "MoKnow",
      currentContent: "# 今天\n\n配置 AI Provider。",
    }, {
      onToken: (content) => partials.push(content),
    });

    expect(partials).toEqual(["流式", "流式回答"]);
    expect(reply.content).toBe("流式回答");
  });

  it("truncates oversized context before sending it to the provider", async () => {
    const service = new AiCockpitService({
      saveSecureCredential: vi.fn(),
      readSecureCredential: vi.fn(async () => "sk-test"),
      deleteSecureCredential: vi.fn(),
      getSecureCredentialStatus: vi.fn(async (key: string) => ({ key, exists: true, storage: "mock-secure-store" as const })),
    });
    await service.saveProviderSettings({
      provider: "openai_compatible",
      endpoint: "https://api.example.com/v1/chat/completions",
      model: "test-model",
      streamEnabled: false,
      apiKeyCredentialKey: AI_PROVIDER_CREDENTIAL_KEY,
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "已基于截断上下文回答。" } }],
    }), { status: 200 }));

    const reply = await service.sendMessage("总结", {
      fileName: "long.md",
      filePath: "long.md",
      repositoryName: "MoKnow",
      currentContent: "很长的内容".repeat(900),
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const prompt = body.messages[1].content as string;
    expect(prompt).toContain("上下文已截断");
    expect(prompt.length).toBeLessThanOrEqual(7300);
    expect(reply.content).toContain("上下文较长");
  });

  it("retries transient provider failures before falling back", async () => {
    const service = new AiCockpitService({
      saveSecureCredential: vi.fn(),
      readSecureCredential: vi.fn(async () => "sk-test"),
      deleteSecureCredential: vi.fn(),
      getSecureCredentialStatus: vi.fn(async (key: string) => ({ key, exists: true, storage: "mock-secure-store" as const })),
    });
    await service.saveProviderSettings({
      provider: "openai_compatible",
      endpoint: "https://api.example.com/v1/chat/completions",
      model: "test-model",
      streamEnabled: false,
      apiKeyCredentialKey: AI_PROVIDER_CREDENTIAL_KEY,
    });
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "第二次请求成功。" } }],
      }), { status: 200 }));

    const reply = await service.sendMessage("总结", {
      fileName: "2026-06-09.md",
      filePath: "日记/2026/06/2026-06-09.md",
      repositoryName: "MoKnow",
      currentContent: "# 今天\n\n配置 AI Provider。",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(reply.content).toContain("第 2 次请求成功");
    expect(reply.content).toContain("第二次请求成功");
  });

  it("supports keyless OpenAI-compatible local providers", async () => {
    const service = new AiCockpitService({
      saveSecureCredential: vi.fn(),
      readSecureCredential: vi.fn(async () => null),
      deleteSecureCredential: vi.fn(),
      getSecureCredentialStatus: vi.fn(async (key: string) => ({ key, exists: false, storage: "mock-secure-store" as const })),
    });
    await service.saveProviderSettings({
      provider: "openai_compatible",
      presetId: "ollama",
      endpoint: "http://localhost:11434/v1/chat/completions",
      model: "llama3.1",
      streamEnabled: false,
      apiKeyRequired: false,
      apiKeyCredentialKey: AI_PROVIDER_CREDENTIAL_KEY,
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "本地模型回答。" } }],
    }), { status: 200 }));

    const reply = await service.sendMessage("总结", {
      fileName: "2026-06-09.md",
      filePath: "日记/2026/06/2026-06-09.md",
      repositoryName: "MoKnow",
      currentContent: "# 今天\n\n配置本地模型。",
    });

    expect(reply.content).toContain("本地模型回答");
    expect(fetchMock.mock.calls[0][1]?.headers).not.toHaveProperty("Authorization");
  });
});

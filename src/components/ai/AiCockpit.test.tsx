import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiCockpit } from "./AiCockpit";
import { AI_PROVIDER_SETTINGS_STORAGE_KEY, AiCockpitService } from "../../services/aiCockpitService";
import { AI_EMBEDDING_SETTINGS_STORAGE_KEY, AI_VECTOR_INDEX_STORAGE_KEY, AiVectorIndexService } from "../../services/aiVectorIndexService";
import type { CredentialStatus } from "../../types/models";

describe("AiCockpit", () => {
  afterEach(() => {
    window.localStorage.removeItem(AI_PROVIDER_SETTINGS_STORAGE_KEY);
    window.localStorage.removeItem(AI_EMBEDDING_SETTINGS_STORAGE_KEY);
    window.localStorage.removeItem(AI_VECTOR_INDEX_STORAGE_KEY);
  });

  it("adds user and assistant messages when asking a question", async () => {
    render(
      <AiCockpit
        aiService={new AiCockpitService()}
        context={{
          fileName: "2024-06-04-日记.md",
          filePath: "2024 › 06月",
          repositoryName: "MoKnow 日记仓库",
        }}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("问我任何关于你笔记的问题..."), {
      target: { value: "生成摘要" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送 ↑" }));

    expect(screen.getAllByText("生成摘要").length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getAllByText(/2024-06-04-日记\.md/).length).toBeGreaterThan(0));
  });

  it("runs diary assistant actions with selected context and inserts output", async () => {
    const insert = vi.fn();
    const loadContext = vi.fn(async () => ({
      entries: [
        {
          title: "2026-06-09.md",
          path: "日记/2026/06/2026-06-09.md",
          content: "# 今天\n\n推进了 AI 日记助手。",
        },
      ],
    }));

    render(
      <AiCockpit
        aiService={new AiCockpitService()}
        context={{
          fileName: "2026-06-09.md",
          filePath: "日记/2026/06/2026-06-09.md",
          repositoryName: "MoKnow 日记仓库",
          currentContent: "# 今天\n\n推进了 AI 日记助手。",
        }}
        onInsertToDraft={insert}
        onLoadContext={loadContext}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "最近 7 天" }));
    fireEvent.click(screen.getByRole("button", { name: "周回顾" }));

    await waitFor(() => expect(screen.getByText(/范围：1 篇记录/)).toBeInTheDocument());
    expect(loadContext).toHaveBeenCalledWith("week", "周回顾");

    fireEvent.click(screen.getAllByRole("button", { name: "插入正文" }).at(-1)!);
    expect(insert).toHaveBeenCalledWith(expect.stringContaining("周回顾"));
  });

  it("saves OpenAI-compatible provider settings from the panel", async () => {
    const credentials = new Map<string, string>();
    const aiService = new AiCockpitService({
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
    });

    render(
      <AiCockpit
        aiService={aiService}
        context={{
          fileName: "2026-06-09.md",
          filePath: "日记/2026/06/2026-06-09.md",
          repositoryName: "MoKnow 日记仓库",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "AI 设置" }));
    fireEvent.change(screen.getByLabelText("AI Provider"), { target: { value: "openai_compatible" } });
    fireEvent.change(screen.getByLabelText("AI Endpoint"), { target: { value: "https://api.example.com/v1/chat/completions" } });
    fireEvent.change(screen.getByLabelText("AI 模型"), { target: { value: "test-model" } });
    fireEvent.change(screen.getByLabelText("AI API Key"), { target: { value: "sk-test" } });
    fireEvent.click(screen.getByRole("button", { name: "保存 AI 设置" }));

    await waitFor(() => expect(screen.getByText("AI Provider 设置已保存")).toBeInTheDocument());
    expect(window.localStorage.getItem(AI_PROVIDER_SETTINGS_STORAGE_KEY)).toContain("test-model");
    expect(window.localStorage.getItem(AI_PROVIDER_SETTINGS_STORAGE_KEY)).not.toContain("sk-test");
    expect(screen.getByText(/API Key 已保存/)).toBeInTheDocument();
  });

  it("renders structured AI sources and opens the selected source", async () => {
    const openSource = vi.fn();
    render(
      <AiCockpit
        aiService={new AiCockpitService()}
        context={{
          fileName: "2026-06-09.md",
          filePath: "日记/2026/06/2026-06-09.md",
          repositoryName: "MoKnow 日记仓库",
        }}
        onLoadContext={vi.fn(async () => ({
          entries: [
            {
              fileId: "readme",
              title: "README.md",
              path: "文档/项目/README.md",
              content: "# README\n\n许可证 MIT",
              snippet: "许可证 MIT",
            },
          ],
        }))}
        onOpenSource={openSource}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "全仓库" }));
    fireEvent.change(screen.getByPlaceholderText("问我任何关于你笔记的问题..."), {
      target: { value: "许可证是什么？" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送 ↑" }));

    const sourceButton = await screen.findByRole("button", { name: "打开来源 README.md" });
    expect(screen.getByText("文档/项目/README.md")).toBeInTheDocument();
    expect(screen.getByText("许可证 MIT")).toBeInTheDocument();

    fireEvent.click(sourceButton);
    expect(openSource).toHaveBeenCalledWith("readme");
  });

  it("applies a provider preset and marks keyless local providers as complete", async () => {
    const aiService = new AiCockpitService({
      saveSecureCredential: vi.fn(),
      readSecureCredential: vi.fn(async () => null),
      deleteSecureCredential: vi.fn(),
      getSecureCredentialStatus: vi.fn(async (key: string): Promise<CredentialStatus> => ({
        key,
        exists: false,
        storage: "mock-secure-store",
      })),
    });

    render(
      <AiCockpit
        aiService={aiService}
        context={{
          fileName: "2026-06-09.md",
          filePath: "日记/2026/06/2026-06-09.md",
          repositoryName: "MoKnow 日记仓库",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "AI 设置" }));
    fireEvent.change(screen.getByLabelText("AI Provider 预设"), { target: { value: "ollama" } });

    expect(screen.getByLabelText("AI Endpoint")).toHaveValue("http://localhost:11434/v1/chat/completions");
    expect(screen.getByLabelText("AI 模型")).toHaveValue("llama3.1");
    expect(screen.getByLabelText("需要 API Key")).not.toBeChecked();
    await waitFor(() => expect(screen.getByText("当前预设不要求 API Key")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "保存 AI 设置" }));
    await waitFor(() => expect(screen.getByText("AI Provider 设置已保存")).toBeInTheDocument());
    expect(window.localStorage.getItem(AI_PROVIDER_SETTINGS_STORAGE_KEY)).toContain('"presetId":"ollama"');
  });

  it("saves embedding settings and shows vector index progress", async () => {
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
    const vectorIndexService = new AiVectorIndexService(credentialStore);

    render(
      <AiCockpit
        aiService={new AiCockpitService()}
        vectorIndexService={vectorIndexService}
        indexProgress={{
          state: "building",
          mode: "external_embedding",
          phase: "embedding",
          completed: 1,
          total: 2,
          percent: 50,
          message: "外部 Embedding 已处理 1/2 篇 Markdown。",
          updatedAt: "2026-06-09T00:00:00.000Z",
        }}
        context={{
          fileName: "2026-06-09.md",
          filePath: "日记/2026/06/2026-06-09.md",
          repositoryName: "MoKnow 日记仓库",
        }}
      />,
    );

    expect(screen.getByText("外部 Embedding 向量库")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "AI 设置" }));
    fireEvent.change(screen.getByLabelText("Embedding Provider"), { target: { value: "openai_compatible" } });
    fireEvent.change(screen.getByLabelText("Embedding Endpoint"), { target: { value: "https://api.example.com/v1/embeddings" } });
    fireEvent.change(screen.getByLabelText("Embedding 模型"), { target: { value: "test-embedding" } });
    fireEvent.change(screen.getByLabelText("Embedding API Key"), { target: { value: "embed-key" } });
    fireEvent.click(screen.getByRole("button", { name: "保存 Embedding 设置" }));

    await waitFor(() => expect(screen.getByText("Embedding 设置已保存")).toBeInTheDocument());
    expect(window.localStorage.getItem(AI_EMBEDDING_SETTINGS_STORAGE_KEY)).toContain("test-embedding");
    expect(window.localStorage.getItem(AI_EMBEDDING_SETTINGS_STORAGE_KEY)).not.toContain("embed-key");
    expect(credentialStore.saveSecureCredential).toHaveBeenCalledWith("moknow.ai.embedding.api-key", "embed-key");
  });
});

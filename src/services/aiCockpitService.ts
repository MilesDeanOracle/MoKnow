import type {
  AiContext,
  AiDiaryAction,
  AiMessage,
  AiSourceReference,
  AiProviderSettings,
  AiProviderStatus,
  CredentialStatus,
} from "../types/models";

export const AI_PROVIDER_SETTINGS_STORAGE_KEY = "moknow:ai-provider-settings";
export const AI_PROVIDER_CREDENTIAL_KEY = "moknow.ai.provider.api-key";

export const defaultAiProviderSettings: AiProviderSettings = {
  provider: "local",
  endpoint: "https://api.openai.com/v1/chat/completions",
  model: "",
  streamEnabled: true,
  apiKeyRequired: true,
  apiKeyCredentialKey: AI_PROVIDER_CREDENTIAL_KEY,
};

export const AI_CONTEXT_ENTRY_CHAR_LIMIT = 1200;
export const AI_PROMPT_CHAR_LIMIT = 7000;
export const AI_PROVIDER_MAX_RETRIES = 2;

export const AI_PROVIDER_PRESETS = [
  {
    id: "openai",
    label: "OpenAI",
    endpoint: "https://api.openai.com/v1/chat/completions",
    model: "gpt-4o-mini",
    apiKeyRequired: true,
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    endpoint: "https://api.deepseek.com/chat/completions",
    model: "deepseek-chat",
    apiKeyRequired: true,
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    model: "openai/gpt-4o-mini",
    apiKeyRequired: true,
  },
  {
    id: "ollama",
    label: "Ollama 本地",
    endpoint: "http://localhost:11434/v1/chat/completions",
    model: "llama3.1",
    apiKeyRequired: false,
  },
] as const;

interface AiCredentialStore {
  saveSecureCredential: (key: string, secret: string) => Promise<CredentialStatus>;
  readSecureCredential: (key: string) => Promise<string | null>;
  deleteSecureCredential: (key: string) => Promise<CredentialStatus>;
  getSecureCredentialStatus: (key: string) => Promise<CredentialStatus>;
}

interface AiRequestOptions {
  onToken?: (content: string) => void;
}

interface OpenAiMessageResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

interface ProviderPrompt {
  prompt: string;
  truncated: boolean;
}

class AiProviderRequestError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "AiProviderRequestError";
  }
}

const responses: Record<string, string> = {
  续写当前日记:
    "好的，这是续写建议：\n\n临睡前又翻了翻今天写的代码，忽然想到了一个优化方案。明天可以把它记在项目规划里，避免细节散落。",
  对当前文档润色:
    "已为你润色当前文档：将工作记录改得更清晰，并保留日记本身的轻松语气。",
  生成摘要:
    "本文摘要：记录了今天围绕 MoKnow 的产品设计、Markdown 编辑器、AI Cockpit 和后续开发计划。",
  查找相关笔记:
    "找到 3 篇相关笔记：项目规划.md、2024-06-03-随笔.md、README.md。",
};

const diaryActionLabels: Record<AiDiaryAction, string> = {
  today_summary: "今日总结",
  gentle_prompt: "温柔追问",
  week_review: "周回顾",
  month_review: "月回顾",
};

function compactMarkdown(content: string): string {
  return content
    .replace(/^---[\s\S]*?---\s*/m, "")
    .replace(/[#>*_`[\]-]/g, "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8)
    .join("；");
}

function summarizeEntries(context: AiContext): string {
  const entries = context.entries?.length ? context.entries : [{
    title: context.fileName,
    path: context.filePath,
    content: context.currentContent ?? "",
  }];
  const titles = entries.map((entry) => entry.title).slice(0, 5).join("、");
  const fragments = entries.map((entry) => compactMarkdown(entry.content)).filter(Boolean).slice(0, 3);

  return [
    context.retrievalStatus?.message ? `检索：${context.retrievalStatus.message}` : "",
    `范围：${entries.length} 篇记录${titles ? `（${titles}）` : ""}。`,
    fragments.length ? `线索：${fragments.join(" / ")}` : "线索：当前范围内可用内容较少，可以先补几句今天发生了什么。",
  ].filter(Boolean).join("\n");
}

function sourceReferencesFromContext(context: AiContext): AiSourceReference[] {
  if (context.entries?.length) {
    return context.entries.slice(0, 5).map((entry) => ({
      fileId: entry.fileId,
      title: entry.title,
      path: entry.path,
      snippet: entry.snippet,
    }));
  }

  return [{
    title: context.fileName,
    path: context.filePath,
    snippet: context.currentContent ? compactMarkdown(context.currentContent).slice(0, 120) : undefined,
  }];
}

function createAssistantMessage(content: string, context: AiContext): AiMessage {
  return {
    id: `assistant-${Date.now()}`,
    role: "assistant",
    content,
    sources: sourceReferencesFromContext(context),
    createdAt: "刚刚",
  };
}

function normalizeAiProviderSettings(settings: Partial<AiProviderSettings>): AiProviderSettings {
  const provider = settings.provider === "openai_compatible" ? "openai_compatible" : "local";
  const preset = AI_PROVIDER_PRESETS.find((item) => item.id === settings.presetId);
  return {
    provider,
    presetId: typeof settings.presetId === "string" ? settings.presetId : undefined,
    endpoint: typeof settings.endpoint === "string" && settings.endpoint.trim()
      ? settings.endpoint.trim()
      : preset?.endpoint ?? defaultAiProviderSettings.endpoint,
    model: typeof settings.model === "string" && settings.model.trim()
      ? settings.model.trim()
      : preset?.model ?? "",
    streamEnabled: typeof settings.streamEnabled === "boolean" ? settings.streamEnabled : defaultAiProviderSettings.streamEnabled,
    apiKeyRequired: typeof settings.apiKeyRequired === "boolean" ? settings.apiKeyRequired : preset?.apiKeyRequired ?? defaultAiProviderSettings.apiKeyRequired,
    apiKeyCredentialKey: typeof settings.apiKeyCredentialKey === "string" && settings.apiKeyCredentialKey.trim()
      ? settings.apiKeyCredentialKey.trim()
      : AI_PROVIDER_CREDENTIAL_KEY,
  };
}

function loadStoredAiProviderSettings(): AiProviderSettings {
  try {
    const raw = window.localStorage.getItem(AI_PROVIDER_SETTINGS_STORAGE_KEY);
    if (!raw) return defaultAiProviderSettings;
    return normalizeAiProviderSettings(JSON.parse(raw) as Partial<AiProviderSettings>);
  } catch {
    return defaultAiProviderSettings;
  }
}

function saveStoredAiProviderSettings(settings: AiProviderSettings): AiProviderSettings {
  const normalized = normalizeAiProviderSettings(settings);
  window.localStorage.setItem(AI_PROVIDER_SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

function truncateWithNotice(value: string, maxChars: number): { text: string; truncated: boolean } {
  if (value.length <= maxChars) {
    return { text: value, truncated: false };
  }

  return {
    text: `${value.slice(0, maxChars)}\n[上下文已截断，已保留最前面的 ${maxChars} 个字符。]`,
    truncated: true,
  };
}

function createProviderPrompt(question: string, context: AiContext): ProviderPrompt {
  const entries = context.entries?.length ? context.entries : [{
    title: context.fileName,
    path: context.filePath,
    content: context.currentContent ?? "",
  }];
  let truncated = false;
  const contextText = entries
    .slice(0, 8)
    .map((entry, index) => {
      const content = truncateWithNotice(compactMarkdown(entry.content), AI_CONTEXT_ENTRY_CHAR_LIMIT);
      truncated ||= content.truncated;
      return [
        `片段 ${index + 1}: ${entry.title}`,
        `路径：${entry.path}`,
        content.text,
      ].join("\n");
    })
    .join("\n\n");
  const prompt = [
    `仓库：${context.repositoryName}`,
    `当前文件：${context.fileName}`,
    context.scope ? `上下文范围：${context.scope}` : "",
    context.retrievalStatus?.message ? `检索状态：${context.retrievalStatus.message}` : "",
    truncated ? "注意：部分上下文过长，已自动截断。回答时请说明依据可能不完整。" : "",
    "请用中文回答，保留对来源文件名的引用。不要编造不存在的文件。",
    "可用上下文：",
    contextText || "当前没有可用正文。",
    `用户问题：${question}`,
  ].filter(Boolean).join("\n\n");
  const limitedPrompt = truncateWithNotice(prompt, AI_PROMPT_CHAR_LIMIT);

  return {
    prompt: limitedPrompt.text,
    truncated: truncated || limitedPrompt.truncated,
  };
}

async function readStreamContent(response: Response, onToken: (content: string) => void): Promise<string> {
  if (!response.body) {
    const json = await response.json() as OpenAiMessageResponse;
    return json.choices?.[0]?.message?.content?.trim() ?? "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const event of events) {
      const dataLines = event
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.replace(/^data:\s*/, ""));

      for (const data of dataLines) {
        if (!data || data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
          const token = parsed.choices?.[0]?.delta?.content ?? "";
          if (token) {
            content += token;
            onToken(content);
          }
        } catch {
          // OpenAI-compatible providers may send keep-alive lines.
        }
      }
    }
  }

  return content.trim();
}

function shouldRetryProviderRequest(error: unknown, attempt: number) {
  if (attempt >= AI_PROVIDER_MAX_RETRIES) return false;
  if (error instanceof AiProviderRequestError) {
    return error.status === undefined || error.status === 429 || error.status >= 500;
  }

  return error instanceof TypeError;
}

async function requestProviderWithRetry(
  settings: AiProviderSettings,
  apiKey: string | null,
  prompt: string,
  onToken: (content: string) => void,
): Promise<{ content: string; attempts: number }> {
  let attempt = 0;
  let lastError: unknown;

  while (attempt < AI_PROVIDER_MAX_RETRIES) {
    attempt += 1;
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
      }

      const response = await fetch(settings.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: settings.model,
          stream: settings.streamEnabled,
          messages: [
            {
              role: "system",
              content: "你是 MoKnow 的中文笔记和日记助手。回答要简洁、可执行，并明确引用可用来源。",
            },
            {
              role: "user",
              content: prompt,
            },
          ],
        }),
      });

      if (!response.ok) {
        throw new AiProviderRequestError(`AI Provider 请求失败：HTTP ${response.status}`, response.status);
      }

      const content = settings.streamEnabled
        ? await readStreamContent(response, onToken)
        : ((await response.json()) as OpenAiMessageResponse).choices?.[0]?.message?.content?.trim() ?? "";

      if (!content) {
        throw new AiProviderRequestError("AI Provider 返回内容为空");
      }

      return { content, attempts: attempt };
    } catch (error) {
      lastError = error;
      if (!shouldRetryProviderRequest(error, attempt)) break;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("AI Provider 请求失败");
}

/**
 * 设计模式：外观模式。
 * 原因：AI Cockpit 组合配置、凭据、模型调用和本地规则回退，
 * 组件只需要发送问题并接收统一消息对象。
 */
export class AiCockpitService {
  constructor(private readonly credentialStore?: AiCredentialStore) {}

  loadProviderSettings(): AiProviderSettings {
    return loadStoredAiProviderSettings();
  }

  async getProviderStatus(settings: AiProviderSettings = this.loadProviderSettings()): Promise<AiProviderStatus> {
    if (settings.provider === "local") {
      return { configured: true, apiKeyStored: false, storage: "unavailable" };
    }

    if (!this.credentialStore) {
      return { configured: false, apiKeyStored: false, storage: "unavailable" };
    }

    const keyRequired = settings.apiKeyRequired !== false;
    const status = keyRequired
      ? await this.credentialStore.getSecureCredentialStatus(settings.apiKeyCredentialKey)
      : { key: settings.apiKeyCredentialKey, exists: false, storage: "mock-secure-store" as const };
    return {
      configured: Boolean(settings.endpoint && settings.model && (!keyRequired || status.exists)),
      apiKeyStored: status.exists,
      storage: status.storage,
    };
  }

  async saveProviderSettings(settings: AiProviderSettings, apiKey?: string): Promise<{ settings: AiProviderSettings; status: AiProviderStatus }> {
    const normalized = saveStoredAiProviderSettings(settings);
    if (apiKey?.trim()) {
      if (!this.credentialStore) {
        throw new Error("当前环境不支持系统凭据存储，无法保存 AI API Key");
      }
      await this.credentialStore.saveSecureCredential(normalized.apiKeyCredentialKey, apiKey.trim());
    }

    return {
      settings: normalized,
      status: await this.getProviderStatus(normalized),
    };
  }

  async deleteProviderApiKey(settings: AiProviderSettings = this.loadProviderSettings()): Promise<AiProviderStatus> {
    if (!this.credentialStore) {
      return { configured: false, apiKeyStored: false, storage: "unavailable" };
    }

    await this.credentialStore.deleteSecureCredential(settings.apiKeyCredentialKey);
    return this.getProviderStatus(settings);
  }

  async sendMessage(question: string, context: AiContext, options: AiRequestOptions = {}): Promise<AiMessage> {
    const settings = this.loadProviderSettings();
    if (settings.provider === "openai_compatible") {
      return this.sendProviderMessage(question, context, settings, options);
    }

    return this.sendLocalMessage(question, context);
  }

  private async sendLocalMessage(question: string, context: AiContext): Promise<AiMessage> {
    const base = responses[question] ?? `收到你的问题：“${question}”。我会基于 ${context.repositoryName} 的索引继续检索。`;
    const retrievalNotice = context.retrievalStatus?.message ? `\n\n检索状态：${context.retrievalStatus.message}` : "";

    return {
      id: `assistant-${Date.now()}`,
      role: "assistant",
      content: `${base}\n\n当前上下文：${context.fileName}${retrievalNotice}`,
      sources: sourceReferencesFromContext(context),
      createdAt: "刚刚",
    };
  }

  private async sendProviderMessage(question: string, context: AiContext, settings: AiProviderSettings, options: AiRequestOptions): Promise<AiMessage> {
    if (!this.credentialStore) {
      return this.createProviderFallbackMessage("当前环境不支持系统凭据读取，已回退到本地规则回答。", await this.sendLocalMessage(question, context), context);
    }

    if (!settings.endpoint || !settings.model) {
      return this.createProviderFallbackMessage("AI Provider 尚未配置 endpoint 或模型，已回退到本地规则回答。", await this.sendLocalMessage(question, context), context);
    }

    const keyRequired = settings.apiKeyRequired !== false;
    const apiKey = keyRequired ? await this.credentialStore.readSecureCredential(settings.apiKeyCredentialKey) : await this.credentialStore.readSecureCredential(settings.apiKeyCredentialKey).catch(() => null);
    if (keyRequired && !apiKey) {
      return this.createProviderFallbackMessage("AI API Key 尚未保存到系统凭据，已回退到本地规则回答。", await this.sendLocalMessage(question, context), context);
    }

    try {
      const prompt = createProviderPrompt(question, context);
      const result = await requestProviderWithRetry(settings, apiKey, prompt.prompt, options.onToken ?? (() => undefined));
      const content = [
        prompt.truncated ? "（上下文较长，已自动截断后发送给模型。）\n\n" : "",
        result.attempts > 1 ? `（第 ${result.attempts} 次请求成功。）\n\n` : "",
        result.content,
      ].join("");

      return createAssistantMessage(content, context);
    } catch (error) {
      const fallback = await this.sendLocalMessage(question, context);
      const reason = error instanceof Error ? error.message : "AI Provider 请求失败";
      return this.createProviderFallbackMessage(`${reason}，重试 ${AI_PROVIDER_MAX_RETRIES} 次后已回退到本地规则回答。`, fallback, context);
    }
  }

  private createProviderFallbackMessage(reason: string, fallback: AiMessage, context: AiContext): AiMessage {
    return createAssistantMessage(`${reason}\n\n${fallback.content}`, context);
  }

  async runDiaryAction(action: AiDiaryAction, context: AiContext): Promise<AiMessage> {
    const sourceSummary = summarizeEntries(context);
    const contentByAction: Record<AiDiaryAction, string> = {
      today_summary: `## 今日总结\n\n${sourceSummary}\n\n- 今天最值得保留的是那些已经被你写下来的具体片段。\n- 当前情绪可以先标记为“持续推进”，后续再补充更细的感受。\n- 明天可以从一个最小行动开始，让记录继续往前走。`,
      gentle_prompt: `## 温柔追问\n\n${sourceSummary}\n\n1. 今天哪个瞬间最像“我真的在生活里”？\n2. 有什么情绪还没被好好命名？\n3. 如果给明天的自己留一句话，你想写什么？`,
      week_review: `## 周回顾\n\n${sourceSummary}\n\n- 本周主题：把零散记录收束成可继续推进的线索。\n- 稳定出现的内容：工作推进、写作节奏、生活观察。\n- 可以延续的行动：挑一件已经出现三次的事，给它一个明确的下一步。`,
      month_review: `## 月回顾\n\n${sourceSummary}\n\n- 本月关键词：积累、整理、回看。\n- 变化：记录不只是存档，也在帮助你看见重复出现的关心。\n- 下月建议：保留一个固定回顾日，把重要片段整理成月末总结。`,
    };

    return createAssistantMessage(contentByAction[action], {
      ...context,
      fileName: context.fileName || diaryActionLabels[action],
    });
  }
}

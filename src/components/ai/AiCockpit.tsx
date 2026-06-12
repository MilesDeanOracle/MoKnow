import { useEffect, useMemo, useState } from "react";
import type { AiContext, AiContextScope, AiDiaryAction, AiMessage, AiProviderSettings, AiProviderStatus, AiSourceReference } from "../../types/models";
import type { AiCockpitService } from "../../services/aiCockpitService";
import { AI_PROVIDER_PRESETS } from "../../services/aiCockpitService";
import { AI_EMBEDDING_PRESETS, AiVectorIndexService } from "../../services/aiVectorIndexService";
import type { AiEmbeddingSettings, AiEmbeddingStatus, AiVectorIndexProgress } from "../../services/aiVectorIndexService";

interface AiCockpitProps {
  aiService: AiCockpitService;
  context: AiContext;
  indexProgress?: AiVectorIndexProgress | null;
  onInsertToDraft?: (content: string) => void;
  onLoadContext?: (scope: AiContextScope, query?: string) => Promise<Partial<AiContext>>;
  onOpenSource?: (fileId: string) => void;
  onRunPluginAiTool?: (tool: PluginAiToolRuntimeContribution, context: AiContext) => Promise<AiMessage>;
  pluginAiTools?: PluginAiToolRuntimeContribution[];
  vectorIndexService?: AiVectorIndexService;
}

interface PluginAiToolRuntimeContribution {
  id: string;
  pluginId: string;
  pluginName: string;
}

const contextScopeLabels: Record<AiContextScope, string> = {
  current_file: "当前文件",
  week: "最近 7 天",
  month: "本月日记",
  repository: "全仓库",
};

const diaryActions: Array<{ id: AiDiaryAction; label: string }> = [
  { id: "today_summary", label: "今日总结" },
  { id: "gentle_prompt", label: "温柔追问" },
  { id: "week_review", label: "周回顾" },
  { id: "month_review", label: "月回顾" },
];

const initialMessages: AiMessage[] = [
  {
    id: "welcome",
    role: "assistant",
    content: "你好！我已加载 MoKnow 日记仓库的文件索引。你可以让我总结最近日记、续写当前文件、查找相关笔记或润色内容。",
    createdAt: "刚刚",
  },
  {
    id: "sample-user",
    role: "user",
    content: "总结一下我最近一个月的日记",
    createdAt: "10:32",
  },
  {
    id: "sample-assistant",
    role: "assistant",
    content: "根据 5月到6月 的日记，你最近的记录集中在 MoKnow 项目推进、写作习惯和月末复盘。整体情绪积极，近期有更多反思型记录。",
    sources: ["05-31-月末复盘.md", "05-15-旅行记录.md", "06-01-月初总结.md"],
    createdAt: "10:32",
  },
];

function normalizeSource(source: string | AiSourceReference): AiSourceReference {
  return typeof source === "string" ? { title: source } : source;
}

export function AiCockpit({
  aiService,
  context,
  indexProgress,
  onInsertToDraft,
  onLoadContext,
  onOpenSource,
  onRunPluginAiTool,
  pluginAiTools = [],
  vectorIndexService,
}: AiCockpitProps) {
  const localVectorIndexService = useMemo(() => vectorIndexService ?? new AiVectorIndexService(), [vectorIndexService]);
  const [messages, setMessages] = useState<AiMessage[]>(initialMessages);
  const [question, setQuestion] = useState("");
  const [thinking, setThinking] = useState(false);
  const [contextScope, setContextScope] = useState<AiContextScope>("current_file");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [providerSettings, setProviderSettings] = useState<AiProviderSettings>(() => aiService.loadProviderSettings());
  const [providerStatus, setProviderStatus] = useState<AiProviderStatus | null>(null);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [embeddingSettings, setEmbeddingSettings] = useState<AiEmbeddingSettings>(() => localVectorIndexService.loadEmbeddingSettings());
  const [embeddingStatus, setEmbeddingStatus] = useState<AiEmbeddingStatus | null>(null);
  const [embeddingKeyDraft, setEmbeddingKeyDraft] = useState("");
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState("");

  useEffect(() => {
    let active = true;
    void aiService.getProviderStatus(providerSettings).then((status) => {
      if (active) setProviderStatus(status);
    });
    return () => {
      active = false;
    };
  }, [aiService, providerSettings]);

  useEffect(() => {
    let active = true;
    void localVectorIndexService.getEmbeddingStatus(embeddingSettings).then((status) => {
      if (active) setEmbeddingStatus(status);
    });
    return () => {
      active = false;
    };
  }, [localVectorIndexService, embeddingSettings]);

  const buildContext = async (scope: AiContextScope, query?: string): Promise<AiContext> => {
    const loaded = await onLoadContext?.(scope, query);
    return {
      ...context,
      scope,
      ...loaded,
    };
  };

  const send = async (nextQuestion: string) => {
    const trimmed = nextQuestion.trim();
    if (!trimmed) return;

    const userMessage: AiMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: trimmed,
      createdAt: "刚刚",
    };

    setMessages((current) => [...current, userMessage]);
    setQuestion("");
    setThinking(true);

    const streamId = `assistant-stream-${Date.now()}`;
    let streamed = false;
    try {
      const assistantMessage = await aiService.sendMessage(trimmed, await buildContext(contextScope, trimmed), {
        onToken: (partialContent) => {
          streamed = true;
          setThinking(false);
          setMessages((current) => {
            const nextMessage: AiMessage = {
              id: streamId,
              role: "assistant",
              content: partialContent,
              sources: [{ title: context.fileName, path: context.filePath }],
              createdAt: "刚刚",
            };
            return current.some((message) => message.id === streamId)
              ? current.map((message) => (message.id === streamId ? nextMessage : message))
              : [...current, nextMessage];
          });
        },
      });
      setMessages((current) => streamed
        ? current.map((message) => (message.id === streamId ? assistantMessage : message))
        : [...current, assistantMessage]);
    } catch (error) {
      const errorMessage: AiMessage = {
        id: `assistant-error-${Date.now()}`,
        role: "assistant",
        content: error instanceof Error ? error.message : "AI 请求失败",
        sources: [{ title: context.fileName, path: context.filePath }],
        createdAt: "刚刚",
      };
      setMessages((current) => [...current, errorMessage]);
    } finally {
      setThinking(false);
    }
  };

  const runDiaryAction = async (action: AiDiaryAction) => {
    const label = diaryActions.find((item) => item.id === action)?.label ?? "日记助手";
    const userMessage: AiMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: `${label}（${contextScopeLabels[contextScope]}）`,
      createdAt: "刚刚",
    };
    setMessages((current) => [...current, userMessage]);
    setThinking(true);
    const assistantMessage = await aiService.runDiaryAction(action, await buildContext(contextScope, label));
    setMessages((current) => [...current, assistantMessage]);
    setThinking(false);
  };

  const runPluginAiTool = async (tool: PluginAiToolRuntimeContribution) => {
    const userMessage: AiMessage = {
      id: `user-plugin-${Date.now()}`,
      role: "user",
      content: `插件 AI 工具：${tool.id}（${tool.pluginName}）`,
      createdAt: "刚刚",
    };
    setMessages((current) => [...current, userMessage]);
    setThinking(true);
    try {
      const loadedContext = await buildContext(contextScope, tool.id);
      const assistantMessage = await onRunPluginAiTool?.(tool, loadedContext);
      setMessages((current) => [...current, assistantMessage ?? {
        id: `assistant-plugin-${Date.now()}`,
        role: "assistant",
        content: `插件 ${tool.pluginName} 的 AI 工具 ${tool.id} 已触发，但宿主尚未提供对应处理器。`,
        createdAt: "刚刚",
      }]);
    } catch (error) {
      setMessages((current) => [...current, {
        id: `assistant-plugin-error-${Date.now()}`,
        role: "assistant",
        content: error instanceof Error ? error.message : "插件 AI 工具执行失败",
        createdAt: "刚刚",
      }]);
    } finally {
      setThinking(false);
    }
  };

  const saveProviderSettings = async () => {
    setSettingsSaving(true);
    setSettingsMessage("");
    try {
      const result = await aiService.saveProviderSettings(providerSettings, apiKeyDraft);
      setProviderSettings(result.settings);
      setProviderStatus(result.status);
      setApiKeyDraft("");
      setSettingsMessage("AI Provider 设置已保存");
    } catch (error) {
      setSettingsMessage(error instanceof Error ? error.message : "保存 AI Provider 设置失败");
    } finally {
      setSettingsSaving(false);
    }
  };

  const applyProviderPreset = (presetId: string) => {
    const preset = AI_PROVIDER_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;

    setProviderSettings((current) => ({
      ...current,
      provider: "openai_compatible",
      presetId: preset.id,
      endpoint: preset.endpoint,
      model: preset.model,
      apiKeyRequired: preset.apiKeyRequired,
    }));
  };

  const deleteProviderApiKey = async () => {
    setSettingsSaving(true);
    setSettingsMessage("");
    try {
      setProviderStatus(await aiService.deleteProviderApiKey(providerSettings));
      setSettingsMessage("AI API Key 已删除");
    } catch (error) {
      setSettingsMessage(error instanceof Error ? error.message : "删除 AI API Key 失败");
    } finally {
      setSettingsSaving(false);
    }
  };

  const applyEmbeddingPreset = (presetId: string) => {
    const preset = AI_EMBEDDING_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;

    setEmbeddingSettings((current) => ({
      ...current,
      provider: "openai_compatible",
      endpoint: preset.endpoint,
      model: preset.model,
      apiKeyRequired: preset.apiKeyRequired,
    }));
  };

  const saveEmbeddingSettings = async () => {
    setSettingsSaving(true);
    setSettingsMessage("");
    try {
      const result = await localVectorIndexService.saveEmbeddingSettings(embeddingSettings, embeddingKeyDraft);
      setEmbeddingSettings(result.settings);
      setEmbeddingStatus(result.status);
      setEmbeddingKeyDraft("");
      setSettingsMessage("Embedding 设置已保存");
    } catch (error) {
      setSettingsMessage(error instanceof Error ? error.message : "保存 Embedding 设置失败");
    } finally {
      setSettingsSaving(false);
    }
  };

  const deleteEmbeddingApiKey = async () => {
    setSettingsSaving(true);
    setSettingsMessage("");
    try {
      setEmbeddingStatus(await localVectorIndexService.deleteEmbeddingApiKey(embeddingSettings));
      setSettingsMessage("Embedding API Key 已删除");
    } catch (error) {
      setSettingsMessage(error instanceof Error ? error.message : "删除 Embedding API Key 失败");
    } finally {
      setSettingsSaving(false);
    }
  };

  return (
    <aside className="ai-panel" id="aiPanel">
      <div className="ai-header">
        <div className="ai-icon">✦</div>
        <div>
          <div className="ai-title">AI Cockpit</div>
          <div className="ai-subtitle">
            {providerSettings.provider === "local" ? "本地规则模式" : providerStatus?.configured ? `真实模型：${providerSettings.model}` : "Provider 未配置完整"}
          </div>
        </div>
        <button className="icon-btn ai-settings-toggle" type="button" aria-label="AI 设置" onClick={() => setSettingsOpen((open) => !open)}>
          ⚙
        </button>
        <button className="icon-btn ai-close" type="button">✕</button>
      </div>

      {settingsOpen ? (
        <section className="ai-provider-settings" aria-label="AI Provider 设置">
          <label>
            <span>Provider</span>
            <select
              aria-label="AI Provider"
              value={providerSettings.provider}
              onChange={(event) => setProviderSettings((current) => ({ ...current, provider: event.target.value as AiProviderSettings["provider"] }))}
            >
              <option value="local">本地规则</option>
              <option value="openai_compatible">OpenAI-compatible</option>
            </select>
          </label>
          <label>
            <span>Provider 预设</span>
            <select
              aria-label="AI Provider 预设"
              value={providerSettings.presetId ?? ""}
              onChange={(event) => applyProviderPreset(event.target.value)}
            >
              <option value="">自定义</option>
              {AI_PROVIDER_PRESETS.map((preset) => (
                <option value={preset.id} key={preset.id}>{preset.label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Endpoint</span>
            <input
              aria-label="AI Endpoint"
              value={providerSettings.endpoint}
              onChange={(event) => setProviderSettings((current) => ({ ...current, presetId: undefined, endpoint: event.target.value }))}
              placeholder="https://api.example.com/v1/chat/completions"
            />
          </label>
          <label>
            <span>模型</span>
            <input
              aria-label="AI 模型"
              value={providerSettings.model}
              onChange={(event) => setProviderSettings((current) => ({ ...current, presetId: undefined, model: event.target.value }))}
              placeholder="输入模型名称"
            />
          </label>
          <label>
            <span>API Key</span>
            <input
              aria-label="AI API Key"
              type="password"
              value={apiKeyDraft}
              onChange={(event) => setApiKeyDraft(event.target.value)}
              placeholder={providerStatus?.apiKeyStored ? "已保存，留空则不修改" : "保存到系统凭据"}
            />
          </label>
          <label className="ai-stream-row">
            <input
              aria-label="启用流式响应"
              type="checkbox"
              checked={providerSettings.streamEnabled}
              onChange={(event) => setProviderSettings((current) => ({ ...current, streamEnabled: event.target.checked }))}
            />
            <span>启用流式响应</span>
          </label>
          <label className="ai-stream-row">
            <input
              aria-label="需要 API Key"
              type="checkbox"
              checked={providerSettings.apiKeyRequired !== false}
              onChange={(event) => setProviderSettings((current) => ({ ...current, presetId: undefined, apiKeyRequired: event.target.checked }))}
            />
            <span>需要 API Key</span>
          </label>
          <div className="ai-provider-status">
            <span>{providerSettings.apiKeyRequired === false ? "当前预设不要求 API Key" : providerStatus?.apiKeyStored ? `API Key 已保存到 ${providerStatus.storage}` : "API Key 未保存"}</span>
            <span>{providerStatus?.configured ? "配置完整" : providerSettings.provider === "local" ? "本地可用" : providerSettings.apiKeyRequired === false ? "需要 endpoint 和模型" : "需要 endpoint、模型和 Key"}</span>
          </div>
          <div className="ai-provider-actions">
            <button type="button" className="quick-action" disabled={settingsSaving} onClick={() => void saveProviderSettings()}>
              保存 AI 设置
            </button>
            <button type="button" className="quick-action" disabled={settingsSaving || !providerStatus?.apiKeyStored} onClick={() => void deleteProviderApiKey()}>
              删除 Key
            </button>
          </div>
          <div className="ai-settings-divider" />
          <label>
            <span>Embedding Provider</span>
            <select
              aria-label="Embedding Provider"
              value={embeddingSettings.provider}
              onChange={(event) => setEmbeddingSettings((current) => ({ ...current, provider: event.target.value as AiEmbeddingSettings["provider"] }))}
            >
              <option value="local">本地轻量向量</option>
              <option value="openai_compatible">外部 Embedding</option>
            </select>
          </label>
          <label>
            <span>Embedding 预设</span>
            <select
              aria-label="Embedding 预设"
              value=""
              onChange={(event) => applyEmbeddingPreset(event.target.value)}
            >
              <option value="">自定义</option>
              {AI_EMBEDDING_PRESETS.map((preset) => (
                <option value={preset.id} key={preset.id}>{preset.label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Embedding Endpoint</span>
            <input
              aria-label="Embedding Endpoint"
              value={embeddingSettings.endpoint}
              onChange={(event) => setEmbeddingSettings((current) => ({ ...current, endpoint: event.target.value }))}
              placeholder="https://api.example.com/v1/embeddings"
            />
          </label>
          <label>
            <span>Embedding 模型</span>
            <input
              aria-label="Embedding 模型"
              value={embeddingSettings.model}
              onChange={(event) => setEmbeddingSettings((current) => ({ ...current, model: event.target.value }))}
              placeholder="text-embedding-3-small"
            />
          </label>
          <label>
            <span>Embedding API Key</span>
            <input
              aria-label="Embedding API Key"
              type="password"
              value={embeddingKeyDraft}
              onChange={(event) => setEmbeddingKeyDraft(event.target.value)}
              placeholder={embeddingStatus?.apiKeyStored ? "已保存，留空则不修改" : "保存到系统凭据"}
            />
          </label>
          <label className="ai-stream-row">
            <input
              aria-label="需要 Embedding API Key"
              type="checkbox"
              checked={embeddingSettings.apiKeyRequired !== false}
              onChange={(event) => setEmbeddingSettings((current) => ({ ...current, apiKeyRequired: event.target.checked }))}
            />
            <span>需要 Embedding API Key</span>
          </label>
          <label className="ai-stream-row">
            <input
              aria-label="持久化向量库"
              type="checkbox"
              checked={embeddingSettings.persistIndex}
              onChange={(event) => setEmbeddingSettings((current) => ({ ...current, persistIndex: event.target.checked }))}
            />
            <span>持久化向量库</span>
          </label>
          <div className="ai-provider-status">
            <span>{embeddingSettings.provider === "local" ? "使用本地词频向量" : embeddingStatus?.apiKeyStored ? `Embedding Key 已保存到 ${embeddingStatus.storage}` : "Embedding Key 未保存"}</span>
            <span>{embeddingStatus?.configured ? "Embedding 配置完整" : embeddingSettings.provider === "local" ? "本地索引可用" : "需要 endpoint、模型和 Key"}</span>
          </div>
          <div className="ai-provider-actions">
            <button type="button" className="quick-action" disabled={settingsSaving} onClick={() => void saveEmbeddingSettings()}>
              保存 Embedding 设置
            </button>
            <button type="button" className="quick-action" disabled={settingsSaving || !embeddingStatus?.apiKeyStored} onClick={() => void deleteEmbeddingApiKey()}>
              删除 Embedding Key
            </button>
          </div>
          {settingsMessage ? <div className="ai-provider-message">{settingsMessage}</div> : null}
        </section>
      ) : null}

      <div className="ai-context-pills">
        {(Object.keys(contextScopeLabels) as AiContextScope[]).map((scope) => (
          <button
            key={scope}
            className={`pill ${contextScope === scope ? "active" : "inactive"}`}
            type="button"
            aria-pressed={contextScope === scope}
            onClick={() => setContextScope(scope)}
          >
            {contextScopeLabels[scope]}
          </button>
        ))}
      </div>

      {indexProgress ? (
        <div className="ai-index-progress" role="status" aria-live="polite">
          <div className="ai-index-progress-title">
            <span>{indexProgress.mode === "external_embedding" ? "外部 Embedding 向量库" : "本地向量索引"}</span>
            <small>{indexProgress.percent}%</small>
          </div>
          <div className="ai-index-progress-bar" aria-hidden="true">
            <span style={{ width: `${indexProgress.percent}%` }} />
          </div>
          <p>{indexProgress.message}</p>
        </div>
      ) : null}

      <div className="ai-diary-actions" aria-label="AI 日记助手">
        {diaryActions.map((action) => (
          <button key={action.id} className="quick-action" type="button" onClick={() => void runDiaryAction(action.id)}>
            {action.label}
          </button>
        ))}
        {pluginAiTools.map((tool) => (
          <button key={`${tool.pluginId}:${tool.id}`} className="quick-action" type="button" onClick={() => void runPluginAiTool(tool)}>
            插件：{tool.id}
          </button>
        ))}
      </div>

      <div className="ai-messages" id="aiMessages">
        {messages.map((message) => (
          <div key={message.id} className={`ai-msg ${message.role === "user" ? "user" : "assistant"}`}>
            <div className="ai-msg-bubble">
              {message.content.split("\n").map((line, index) => (
                <span key={`${message.id}-${index}`}>
                  {line}
                  {index < message.content.split("\n").length - 1 ? <br /> : null}
                </span>
              ))}
            </div>
            {message.sources?.length ? (
              <div className="ai-source-refs">
                {message.sources.map((source) => {
                  const reference = normalizeSource(source);
                  const sourceBody = (
                    <>
                      <span className="source-ref-title">📄 {reference.title}</span>
                      {reference.path ? <span className="source-ref-path">{reference.path}</span> : null}
                      {reference.snippet ? <span className="source-ref-snippet">{reference.snippet}</span> : null}
                    </>
                  );

                  return reference.fileId && onOpenSource ? (
                    <button
                      className="source-ref"
                      key={`${message.id}-${reference.fileId}`}
                      type="button"
                      onClick={() => onOpenSource(reference.fileId!)}
                      aria-label={`打开来源 ${reference.title}`}
                    >
                      {sourceBody}
                    </button>
                  ) : (
                    <span className="source-ref" key={`${message.id}-${reference.title}`}>
                      {sourceBody}
                    </span>
                  );
                })}
              </div>
            ) : null}
            {message.role === "assistant" && onInsertToDraft ? (
              <button className="ai-insert-btn" type="button" onClick={() => onInsertToDraft(message.content)}>
                插入正文
              </button>
            ) : null}
            <div className="ai-msg-meta">{message.role === "user" ? "你" : "AI Cockpit"} · {message.createdAt}</div>
          </div>
        ))}

        {thinking ? (
          <div className="ai-msg assistant">
            <div className="ai-thinking-box">
              <div className="ai-thinking"><span /><span /><span /></div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="ai-quick-actions">
        {["续写当前日记", "对当前文档润色", "生成摘要", "查找相关笔记"].map((action) => (
          <button key={action} className="quick-action" type="button" onClick={() => send(action)}>
            {action.replace("当前文档", "").replace("当前", "")}
          </button>
        ))}
      </div>

      <form
        className="ai-input-area"
        onSubmit={(event) => {
          event.preventDefault();
          void send(question);
        }}
      >
        <div className="ai-input-box">
          <textarea
            id="aiInput"
            placeholder="问我任何关于你笔记的问题..."
            rows={2}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send(question);
              }
            }}
          />
          <div className="ai-input-footer">
            <span className="ai-input-hint">Enter 发送 · Shift+Enter 换行</span>
            <button className="ai-send-btn" type="submit">发送 ↑</button>
          </div>
        </div>
      </form>
    </aside>
  );
}

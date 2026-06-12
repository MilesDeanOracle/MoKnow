import type { CredentialStatus } from "../types/models";

export interface AiVectorDocument {
  fileId: string;
  name: string;
  relativePath: string;
  content: string;
  diaryDate?: string;
  tags?: string[];
}

export type AiVectorIndexState = "not_ready" | "building" | "ready" | "empty" | "error";
export type AiVectorIndexMode = "local_vector" | "external_embedding";

export interface AiVectorIndexStatus {
  state: AiVectorIndexState;
  mode: AiVectorIndexMode;
  documentCount: number;
  updatedAt?: string;
  persisted?: boolean;
  message: string;
}

export interface AiVectorIndexProgress {
  state: AiVectorIndexState;
  mode: AiVectorIndexMode;
  phase: string;
  completed: number;
  total: number;
  percent: number;
  message: string;
  updatedAt: string;
}

export interface AiVectorSearchResult extends AiVectorDocument {
  score: number;
  snippet: string;
  matchedTerms: string[];
}

export interface AiVectorSearchResponse {
  status: AiVectorIndexStatus;
  results: AiVectorSearchResult[];
  warning?: string;
}

export type AiEmbeddingProviderKind = "local" | "openai_compatible";

export interface AiEmbeddingSettings {
  provider: AiEmbeddingProviderKind;
  endpoint: string;
  model: string;
  apiKeyRequired?: boolean;
  apiKeyCredentialKey: string;
  persistIndex: boolean;
  batchSize: number;
}

export interface AiEmbeddingStatus {
  configured: boolean;
  apiKeyStored: boolean;
  storage: CredentialStatus["storage"] | "unavailable";
}

export interface AiEmbeddingCredentialStore {
  saveSecureCredential: (key: string, secret: string) => Promise<CredentialStatus | unknown>;
  readSecureCredential: (key: string) => Promise<string | null>;
  deleteSecureCredential: (key: string) => Promise<CredentialStatus | unknown>;
  getSecureCredentialStatus: (key: string) => Promise<CredentialStatus>;
}

export const AI_VECTOR_INDEX_STORAGE_KEY = "moknow:ai-vector-index:v1";
export const AI_EMBEDDING_SETTINGS_STORAGE_KEY = "moknow:ai-embedding-settings";
export const AI_EMBEDDING_CREDENTIAL_KEY = "moknow.ai.embedding.api-key";

export const defaultAiEmbeddingSettings: AiEmbeddingSettings = {
  provider: "local",
  endpoint: "https://api.openai.com/v1/embeddings",
  model: "text-embedding-3-small",
  apiKeyRequired: true,
  apiKeyCredentialKey: AI_EMBEDDING_CREDENTIAL_KEY,
  persistIndex: true,
  batchSize: 16,
};

export const AI_EMBEDDING_PRESETS = [
  {
    id: "openai",
    label: "OpenAI Embeddings",
    endpoint: "https://api.openai.com/v1/embeddings",
    model: "text-embedding-3-small",
    apiKeyRequired: true,
  },
  {
    id: "ollama",
    label: "Ollama 本地 Embedding",
    endpoint: "http://localhost:11434/v1/embeddings",
    model: "nomic-embed-text",
    apiKeyRequired: false,
  },
] as const;

interface IndexedDocument extends AiVectorDocument {
  vector?: Map<string, number>;
  embedding?: number[];
  plainText: string;
}

interface PersistedIndexedDocument extends AiVectorDocument {
  vectorEntries?: Array<[string, number]>;
  embedding?: number[];
  plainText: string;
}

interface PersistedVectorIndex {
  version: 1;
  mode: AiVectorIndexMode;
  sourceKey: string;
  settingsKey: string;
  updatedAt: string;
  documents: PersistedIndexedDocument[];
  idfEntries?: Array<[string, number]>;
}

interface BuildOptions {
  settings?: AiEmbeddingSettings;
  credentialStore?: AiEmbeddingCredentialStore;
  onProgress?: (progress: AiVectorIndexProgress) => void;
}

const stopWords = new Set([
  "the",
  "and",
  "for",
  "with",
  "this",
  "that",
  "from",
  "你的",
  "我的",
  "一个",
  "这个",
  "那个",
  "可以",
  "以及",
  "关于",
]);

const semanticExpansions: Record<string, string[]> = {
  "许可证": ["许可", "license", "mit"],
  "许可": ["许可证", "license", "mit"],
  "代码编辑器": ["代码", "编辑器", "codemirror", "source editor"],
  "编辑器": ["代码编辑器", "codemirror", "source editor"],
  "所见即所得": ["wysiwyg", "tiptap", "编辑器"],
  "语义检索": ["向量", "索引", "embedding", "rag", "检索"],
  "向量检索": ["语义检索", "embedding", "rag", "索引"],
  "模型": ["ai", "llm", "provider", "openai", "ollama"],
  "插件": ["plugin", "extension", "扩展"],
};

function cleanMarkdown(content: string): string {
  return content
    .replace(/^---[\s\S]*?---\s*/m, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[[^\]]+\]\(([^)]+)\)/g, " $1 ")
    .replace(/[#>*_[\]-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function addCjkTokens(chunk: string, tokens: string[]) {
  if (chunk.length <= 12) tokens.push(chunk);
  for (let size = 1; size <= 3; size += 1) {
    if (chunk.length < size) continue;
    for (let index = 0; index <= chunk.length - size; index += 1) {
      tokens.push(chunk.slice(index, index + size));
    }
  }
}

export function tokenizeForAiVectorIndex(content: string): string[] {
  const normalized = cleanMarkdown(content).toLowerCase();
  const tokens: string[] = [];

  for (const match of normalized.matchAll(/[a-z0-9_]{2,}/g)) {
    const token = match[0];
    if (!stopWords.has(token)) tokens.push(token);
  }

  for (const match of normalized.matchAll(/[\u3400-\u9fff]{1,}/g)) {
    addCjkTokens(match[0], tokens);
  }

  return tokens.filter((token) => token && !stopWords.has(token));
}

function expandedQueryTokens(query: string): string[] {
  const tokens = tokenizeForAiVectorIndex(query);
  const normalized = query.toLowerCase();
  const expansions = Object.entries(semanticExpansions)
    .filter(([term]) => normalized.includes(term.toLowerCase()))
    .flatMap(([, values]) => values);

  return [...tokens, ...tokenizeForAiVectorIndex(expansions.join(" "))];
}

function termFrequency(tokens: string[]): Map<string, number> {
  const frequency = new Map<string, number>();
  for (const token of tokens) {
    frequency.set(token, (frequency.get(token) ?? 0) + 1);
  }
  return frequency;
}

function createVector(tokens: string[], idf: Map<string, number>): Map<string, number> {
  const frequency = termFrequency(tokens);
  const vector = new Map<string, number>();
  let length = 0;

  for (const [token, count] of frequency) {
    const weight = (1 + Math.log(count)) * (idf.get(token) ?? 1);
    vector.set(token, weight);
    length += weight * weight;
  }

  const magnitude = Math.sqrt(length) || 1;
  for (const [token, weight] of vector) {
    vector.set(token, weight / magnitude);
  }

  return vector;
}

function cosineSimilarity(left: Map<string, number>, right: Map<string, number>): number {
  let score = 0;
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  for (const [token, weight] of small) {
    score += weight * (large.get(token) ?? 0);
  }
  return score;
}

function numericCosineSimilarity(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length);
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] * left[index];
    rightMagnitude += right[index] * right[index];
  }

  if (!leftMagnitude || !rightMagnitude) return 0;
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function normalizeNumericVector(vector: number[]) {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / magnitude);
}

function createSnippet(content: string, terms: string[]): string {
  const plainText = cleanMarkdown(content);
  const usefulTerms = terms
    .filter((term) => term.length > 1)
    .sort((left, right) => right.length - left.length);
  const sentences = plainText.split(/[。！？!?；;\n]/).map((line) => line.trim()).filter(Boolean);
  const matched = sentences.find((sentence) => usefulTerms.some((term) => sentence.toLowerCase().includes(term.toLowerCase())));
  const snippet = matched || plainText;
  return snippet.length > 180 ? `${snippet.slice(0, 180)}...` : snippet;
}

function fallbackHash(text: string) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function documentsSourceKey(documents: AiVectorDocument[]) {
  return fallbackHash(JSON.stringify(documents.map((document) => ({
    fileId: document.fileId,
    relativePath: document.relativePath,
    contentHash: fallbackHash(document.content),
    tags: document.tags ?? [],
  }))));
}

function normalizeAiEmbeddingSettings(settings: Partial<AiEmbeddingSettings>): AiEmbeddingSettings {
  const provider = settings.provider === "openai_compatible" ? "openai_compatible" : "local";
  return {
    provider,
    endpoint: typeof settings.endpoint === "string" && settings.endpoint.trim()
      ? settings.endpoint.trim()
      : defaultAiEmbeddingSettings.endpoint,
    model: typeof settings.model === "string" && settings.model.trim()
      ? settings.model.trim()
      : defaultAiEmbeddingSettings.model,
    apiKeyRequired: typeof settings.apiKeyRequired === "boolean" ? settings.apiKeyRequired : defaultAiEmbeddingSettings.apiKeyRequired,
    apiKeyCredentialKey: typeof settings.apiKeyCredentialKey === "string" && settings.apiKeyCredentialKey.trim()
      ? settings.apiKeyCredentialKey.trim()
      : AI_EMBEDDING_CREDENTIAL_KEY,
    persistIndex: typeof settings.persistIndex === "boolean" ? settings.persistIndex : defaultAiEmbeddingSettings.persistIndex,
    batchSize: Number.isFinite(settings.batchSize)
      ? Math.min(Math.max(Math.floor(settings.batchSize ?? defaultAiEmbeddingSettings.batchSize), 1), 64)
      : defaultAiEmbeddingSettings.batchSize,
  };
}

function statusMessage(state: AiVectorIndexState, count: number, mode: AiVectorIndexMode, persisted = false): string {
  const modeLabel = mode === "external_embedding" ? "外部 Embedding 向量库" : "本地向量索引";
  if (state === "ready") return `AI ${modeLabel}${persisted ? "已从持久化缓存恢复" : "已就绪"}，已索引 ${count} 篇 Markdown。`;
  if (state === "empty") return "AI 向量索引未完成：当前范围没有可索引的 Markdown，已回退到当前文件。";
  if (state === "building") return `AI ${modeLabel}正在构建，请稍后重试。`;
  if (state === "error") return `AI ${modeLabel}构建失败，已回退到本地规则或全文搜索。`;
  return "AI 向量索引未完成：尚未构建索引，已回退到全文搜索或当前文件。";
}

function createEmbeddingInput(document: AiVectorDocument) {
  return [
    document.name,
    document.relativePath,
    document.tags?.join(" ") ?? "",
    cleanMarkdown(document.content),
  ].filter(Boolean).join("\n");
}

function modeForSettings(settings: AiEmbeddingSettings): AiVectorIndexMode {
  return settings.provider === "openai_compatible" ? "external_embedding" : "local_vector";
}

function settingsKey(settings: AiEmbeddingSettings) {
  return `${modeForSettings(settings)}:${settings.endpoint}:${settings.model}:${settings.batchSize}`;
}

function emitProgress(
  onProgress: BuildOptions["onProgress"],
  progress: Omit<AiVectorIndexProgress, "updatedAt" | "percent">,
) {
  onProgress?.({
    ...progress,
    percent: progress.total ? Math.round((progress.completed / progress.total) * 100) : 0,
    updatedAt: new Date().toISOString(),
  });
}

async function requestEmbeddingBatch(settings: AiEmbeddingSettings, credentialStore: AiEmbeddingCredentialStore | undefined, inputs: string[]): Promise<number[][]> {
  const keyRequired = settings.apiKeyRequired !== false;
  const apiKey = keyRequired ? await credentialStore?.readSecureCredential(settings.apiKeyCredentialKey) : await credentialStore?.readSecureCredential(settings.apiKeyCredentialKey).catch(() => null);
  if (keyRequired && !apiKey) {
    throw new Error("外部 Embedding API Key 尚未保存到系统凭据");
  }

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
      input: inputs,
    }),
  });

  if (!response.ok) {
    throw new Error(`外部 Embedding 请求失败：HTTP ${response.status}`);
  }

  const json = await response.json() as {
    data?: Array<{ embedding?: number[]; index?: number }>;
  };
  const data = [...(json.data ?? [])].sort((left, right) => (left.index ?? 0) - (right.index ?? 0));
  const embeddings = data.map((item) => item.embedding).filter((embedding): embedding is number[] => Array.isArray(embedding));
  if (embeddings.length !== inputs.length) {
    throw new Error("外部 Embedding 返回数量与输入不一致");
  }

  return embeddings.map(normalizeNumericVector);
}

function loadPersistedIndex(): PersistedVectorIndex | null {
  try {
    const raw = window.localStorage.getItem(AI_VECTOR_INDEX_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedVectorIndex;
    return parsed.version === 1 && Array.isArray(parsed.documents) ? parsed : null;
  } catch {
    return null;
  }
}

function savePersistedIndex(index: PersistedVectorIndex) {
  window.localStorage.setItem(AI_VECTOR_INDEX_STORAGE_KEY, JSON.stringify(index));
}

export class AiVectorIndexService {
  private documents: IndexedDocument[] = [];
  private idf = new Map<string, number>();
  private status: AiVectorIndexStatus = {
    state: "not_ready",
    mode: "local_vector",
    documentCount: 0,
    message: statusMessage("not_ready", 0, "local_vector"),
  };

  constructor(private readonly credentialStore?: AiEmbeddingCredentialStore) {}

  loadEmbeddingSettings(): AiEmbeddingSettings {
    try {
      const raw = window.localStorage.getItem(AI_EMBEDDING_SETTINGS_STORAGE_KEY);
      if (!raw) return defaultAiEmbeddingSettings;
      return normalizeAiEmbeddingSettings(JSON.parse(raw) as Partial<AiEmbeddingSettings>);
    } catch {
      return defaultAiEmbeddingSettings;
    }
  }

  async getEmbeddingStatus(settings: AiEmbeddingSettings = this.loadEmbeddingSettings()): Promise<AiEmbeddingStatus> {
    if (settings.provider === "local") {
      return { configured: true, apiKeyStored: false, storage: "unavailable" };
    }

    const credentialStore = this.credentialStore;
    if (!credentialStore) {
      return { configured: false, apiKeyStored: false, storage: "unavailable" };
    }

    const keyRequired = settings.apiKeyRequired !== false;
    const credentialStatus = keyRequired
      ? await credentialStore.getSecureCredentialStatus(settings.apiKeyCredentialKey)
      : { key: settings.apiKeyCredentialKey, exists: false, storage: "mock-secure-store" as const };

    return {
      configured: Boolean(settings.endpoint && settings.model && (!keyRequired || credentialStatus.exists)),
      apiKeyStored: credentialStatus.exists,
      storage: credentialStatus.storage,
    };
  }

  async saveEmbeddingSettings(settings: AiEmbeddingSettings, apiKey?: string): Promise<{ settings: AiEmbeddingSettings; status: AiEmbeddingStatus }> {
    const normalized = normalizeAiEmbeddingSettings(settings);
    window.localStorage.setItem(AI_EMBEDDING_SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
    if (apiKey?.trim()) {
      if (!this.credentialStore) {
        throw new Error("当前环境不支持系统凭据存储，无法保存 Embedding API Key");
      }
      await this.credentialStore.saveSecureCredential(normalized.apiKeyCredentialKey, apiKey.trim());
    }

    return {
      settings: normalized,
      status: await this.getEmbeddingStatus(normalized),
    };
  }

  async deleteEmbeddingApiKey(settings: AiEmbeddingSettings = this.loadEmbeddingSettings()): Promise<AiEmbeddingStatus> {
    if (!this.credentialStore) {
      return { configured: false, apiKeyStored: false, storage: "unavailable" };
    }

    await this.credentialStore.deleteSecureCredential(settings.apiKeyCredentialKey);
    return this.getEmbeddingStatus(settings);
  }

  getStatus(): AiVectorIndexStatus {
    return { ...this.status };
  }

  buildIndex(documents: AiVectorDocument[]): AiVectorIndexStatus {
    return this.buildLocalIndex(documents, { persist: false });
  }

  async buildIndexWithSettings(documents: AiVectorDocument[], options: BuildOptions = {}): Promise<AiVectorIndexStatus> {
    const settings = normalizeAiEmbeddingSettings(options.settings ?? this.loadEmbeddingSettings());
    if (settings.provider !== "openai_compatible") {
      return this.buildLocalIndex(documents, { persist: settings.persistIndex, onProgress: options.onProgress, settings });
    }

    return this.buildExternalEmbeddingIndex(documents, settings, options);
  }

  search(query: string, limit = 8): AiVectorSearchResponse {
    return this.searchLocal(query, limit);
  }

  async searchWithSettings(query: string, limit = 8, options: BuildOptions = {}): Promise<AiVectorSearchResponse> {
    const settings = normalizeAiEmbeddingSettings(options.settings ?? this.loadEmbeddingSettings());
    if (this.status.mode !== "external_embedding") {
      return this.searchLocal(query, limit);
    }

    if (this.status.state !== "ready") {
      return {
        status: this.getStatus(),
        results: [],
        warning: this.status.message,
      };
    }

    try {
      const [queryEmbedding] = await requestEmbeddingBatch(settings, options.credentialStore ?? this.credentialStore, [query]);
      const tokens = expandedQueryTokens(query);
      const results = this.documents
        .filter((document) => document.embedding)
        .map((document) => ({
          ...document,
          score: numericCosineSimilarity(queryEmbedding, document.embedding ?? []),
          matchedTerms: tokens.filter((token) => document.plainText.toLowerCase().includes(token.toLowerCase())),
          snippet: createSnippet(document.content, tokens),
        }))
        .filter((result) => result.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, limit);

      return {
        status: this.getStatus(),
        results,
      };
    } catch (error) {
      const localSearch = this.searchLocal(query, limit);
      return {
        ...localSearch,
        warning: error instanceof Error ? error.message : "外部 Embedding 检索失败，已回退到本地向量。",
      };
    }
  }

  private buildLocalIndex(
    documents: AiVectorDocument[],
    options: { persist?: boolean; onProgress?: BuildOptions["onProgress"]; settings?: AiEmbeddingSettings } = {},
  ): AiVectorIndexStatus {
    const availableDocuments = documents.filter((document) => document.content.trim());
    const mode: AiVectorIndexMode = "local_vector";
    if (!availableDocuments.length) {
      this.documents = [];
      this.idf = new Map();
      this.status = {
        state: "empty",
        mode,
        documentCount: 0,
        updatedAt: new Date().toISOString(),
        message: statusMessage("empty", 0, mode),
      };
      emitProgress(options.onProgress, {
        state: "empty",
        mode,
        phase: "empty",
        completed: 0,
        total: 0,
        message: this.status.message,
      });
      return this.getStatus();
    }

    const sourceKey = documentsSourceKey(availableDocuments);
    const currentSettingsKey = settingsKey(options.settings ?? defaultAiEmbeddingSettings);
    const restored = options.persist ? this.tryRestorePersistedIndex(sourceKey, currentSettingsKey, mode, options.onProgress) : false;
    if (restored) return this.getStatus();

    emitProgress(options.onProgress, {
      state: "building",
      mode,
      phase: "tokenizing",
      completed: 0,
      total: availableDocuments.length,
      message: statusMessage("building", availableDocuments.length, mode),
    });
    this.status = {
      state: "building",
      mode,
      documentCount: availableDocuments.length,
      message: statusMessage("building", availableDocuments.length, mode),
    };

    const tokenized = availableDocuments.map((document, index) => {
      emitProgress(options.onProgress, {
        state: "building",
        mode,
        phase: "tokenizing",
        completed: index + 1,
        total: availableDocuments.length,
        message: `正在解析第 ${index + 1}/${availableDocuments.length} 篇 Markdown。`,
      });
      return {
        document,
        tokens: tokenizeForAiVectorIndex(`${document.name}\n${document.relativePath}\n${document.tags?.join(" ") ?? ""}\n${document.content}`),
        plainText: cleanMarkdown(document.content),
      };
    });
    const documentFrequency = new Map<string, number>();
    for (const item of tokenized) {
      for (const token of new Set(item.tokens)) {
        documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
      }
    }

    this.idf = new Map(Array.from(documentFrequency, ([token, count]) => [
      token,
      Math.log((1 + tokenized.length) / (1 + count)) + 1,
    ]));
    this.documents = tokenized.map((item) => ({
      ...item.document,
      plainText: item.plainText,
      vector: createVector(item.tokens, this.idf),
    }));
    this.status = {
      state: "ready",
      mode,
      documentCount: this.documents.length,
      updatedAt: new Date().toISOString(),
      message: statusMessage("ready", this.documents.length, mode),
    };

    if (options.persist) {
      this.persistCurrentIndex(sourceKey, currentSettingsKey);
    }

    emitProgress(options.onProgress, {
      state: "ready",
      mode,
      phase: "ready",
      completed: availableDocuments.length,
      total: availableDocuments.length,
      message: this.status.message,
    });
    return this.getStatus();
  }

  private async buildExternalEmbeddingIndex(documents: AiVectorDocument[], settings: AiEmbeddingSettings, options: BuildOptions): Promise<AiVectorIndexStatus> {
    const availableDocuments = documents.filter((document) => document.content.trim());
    const mode: AiVectorIndexMode = "external_embedding";
    if (!availableDocuments.length) {
      this.documents = [];
      this.status = {
        state: "empty",
        mode,
        documentCount: 0,
        updatedAt: new Date().toISOString(),
        message: statusMessage("empty", 0, mode),
      };
      return this.getStatus();
    }

    const sourceKey = documentsSourceKey(availableDocuments);
    const currentSettingsKey = settingsKey(settings);
    const restored = settings.persistIndex ? this.tryRestorePersistedIndex(sourceKey, currentSettingsKey, mode, options.onProgress) : false;
    if (restored) return this.getStatus();

    this.status = {
      state: "building",
      mode,
      documentCount: availableDocuments.length,
      message: statusMessage("building", availableDocuments.length, mode),
    };
    emitProgress(options.onProgress, {
      state: "building",
      mode,
      phase: "embedding",
      completed: 0,
      total: availableDocuments.length,
      message: `正在调用外部 Embedding 模型：${settings.model}`,
    });

    try {
      const indexed: IndexedDocument[] = [];
      for (let start = 0; start < availableDocuments.length; start += settings.batchSize) {
        const batchDocuments = availableDocuments.slice(start, start + settings.batchSize);
        const embeddings = await requestEmbeddingBatch(settings, options.credentialStore ?? this.credentialStore, batchDocuments.map(createEmbeddingInput));
        batchDocuments.forEach((document, offset) => {
          indexed.push({
            ...document,
            embedding: embeddings[offset],
            plainText: cleanMarkdown(document.content),
          });
        });
        emitProgress(options.onProgress, {
          state: "building",
          mode,
          phase: "embedding",
          completed: Math.min(start + batchDocuments.length, availableDocuments.length),
          total: availableDocuments.length,
          message: `外部 Embedding 已处理 ${Math.min(start + batchDocuments.length, availableDocuments.length)}/${availableDocuments.length} 篇 Markdown。`,
        });
      }

      this.documents = indexed;
      this.idf = new Map();
      this.status = {
        state: "ready",
        mode,
        documentCount: this.documents.length,
        updatedAt: new Date().toISOString(),
        message: statusMessage("ready", this.documents.length, mode),
      };
      if (settings.persistIndex) {
        this.persistCurrentIndex(sourceKey, currentSettingsKey);
      }
      emitProgress(options.onProgress, {
        state: "ready",
        mode,
        phase: "ready",
        completed: availableDocuments.length,
        total: availableDocuments.length,
        message: this.status.message,
      });
      return this.getStatus();
    } catch (error) {
      this.status = {
        state: "error",
        mode,
        documentCount: 0,
        updatedAt: new Date().toISOString(),
        message: error instanceof Error ? error.message : statusMessage("error", 0, mode),
      };
      emitProgress(options.onProgress, {
        state: "error",
        mode,
        phase: "error",
        completed: 0,
        total: availableDocuments.length,
        message: this.status.message,
      });
      return this.buildLocalIndex(documents, { persist: settings.persistIndex, onProgress: options.onProgress, settings: { ...settings, provider: "local" } });
    }
  }

  private searchLocal(query: string, limit: number): AiVectorSearchResponse {
    if (this.status.state !== "ready") {
      return {
        status: this.getStatus(),
        results: [],
        warning: this.status.message,
      };
    }

    const tokens = expandedQueryTokens(query);
    const queryVector = createVector(tokens, this.idf);
    if (!tokens.length || !queryVector.size) {
      return {
        status: this.getStatus(),
        results: [],
      };
    }

    const tokenSet = new Set(tokens);
    const results = this.documents
      .filter((document) => document.vector)
      .map((document) => {
        const vector = document.vector ?? new Map<string, number>();
        const matchedTerms = Array.from(tokenSet)
          .filter((token) => vector.has(token))
          .sort((left, right) => right.length - left.length);
        const score = cosineSimilarity(queryVector, vector);
        return {
          ...document,
          score,
          matchedTerms,
          snippet: createSnippet(document.content, matchedTerms.length ? matchedTerms : tokens),
        };
      })
      .filter((result) => result.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);

    return {
      status: this.getStatus(),
      results,
    };
  }

  private tryRestorePersistedIndex(sourceKey: string, currentSettingsKey: string, mode: AiVectorIndexMode, onProgress?: BuildOptions["onProgress"]) {
    const persisted = loadPersistedIndex();
    if (!persisted || persisted.sourceKey !== sourceKey || persisted.settingsKey !== currentSettingsKey || persisted.mode !== mode) {
      return false;
    }

    this.idf = new Map(persisted.idfEntries ?? []);
    this.documents = persisted.documents.map((document) => ({
      ...document,
      vector: document.vectorEntries ? new Map(document.vectorEntries) : undefined,
      embedding: document.embedding,
    }));
    this.status = {
      state: this.documents.length ? "ready" : "empty",
      mode,
      documentCount: this.documents.length,
      updatedAt: persisted.updatedAt,
      persisted: true,
      message: this.documents.length
        ? statusMessage("ready", this.documents.length, mode, true)
        : statusMessage("empty", 0, mode),
    };
    emitProgress(onProgress, {
      state: this.status.state,
      mode,
      phase: "restore",
      completed: this.documents.length,
      total: this.documents.length,
      message: this.status.message,
    });
    return true;
  }

  private persistCurrentIndex(sourceKey: string, currentSettingsKey: string) {
    savePersistedIndex({
      version: 1,
      mode: this.status.mode,
      sourceKey,
      settingsKey: currentSettingsKey,
      updatedAt: this.status.updatedAt ?? new Date().toISOString(),
      idfEntries: Array.from(this.idf.entries()),
      documents: this.documents.map((document) => ({
        fileId: document.fileId,
        name: document.name,
        relativePath: document.relativePath,
        content: document.content,
        diaryDate: document.diaryDate,
        tags: document.tags,
        plainText: document.plainText,
        vectorEntries: document.vector ? Array.from(document.vector.entries()) : undefined,
        embedding: document.embedding,
      })),
    });
  }
}

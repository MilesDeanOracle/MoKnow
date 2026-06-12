#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";

const args = process.argv.slice(2);

function argValue(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

function hasFlag(name) {
  return args.includes(name);
}

function redactUrl(value) {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return value.replace(/([?&](?:api[_-]?key|token|key)=)[^&]+/gi, "$1<redacted>");
  }
}

function resolveChatCompletionsUrl(endpoint) {
  const trimmed = endpoint.replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  return `${trimmed}/chat/completions`;
}

function extractMessage(data) {
  const choice = data?.choices?.[0];
  return choice?.message?.content ?? choice?.text ?? "";
}

async function readStreamMessage(response) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      const chunk = JSON.parse(payload);
      content += chunk?.choices?.[0]?.delta?.content ?? "";
    }
  }

  return content;
}

function assertConfig(name, value) {
  if (!value) {
    throw new Error(`${name} is required. Set it with an argument or environment variable.`);
  }
}

function createReport({
  endpoint,
  model,
  providerLabel,
  stream,
  elapsedMs,
  status,
  content,
  output,
  outputJson,
}) {
  const now = new Date().toISOString();
  const safeContent = content.trim().slice(0, 1200);
  const report = `# AI 外部模型联调记录

> 本文件由 \`npm run ai:e2e\` 生成，禁止记录 API Key 或其它敏感凭据。

| 项目 | 结果 |
|---|---|
| 联调时间 | ${now} |
| Endpoint | ${redactUrl(endpoint)} |
| Provider | ${providerLabel} |
| Model | ${model} |
| Stream | ${stream ? "是" : "否"} |
| HTTP 状态 | ${status} |
| 耗时 | ${Math.round(elapsedMs)} ms |
| 响应非空 | ${safeContent ? "是" : "否"} |

## 验证问题

请用中文一句话回答，并包含短语 MoKnow AI E2E OK：MoKnow 的 AI Provider 端到端联调是否成功？

## 模型响应摘录

\`\`\`text
${safeContent || "<empty>"}
\`\`\`

## 结论

${safeContent ? `${providerLabel} 已完成一次端到端请求、鉴权、响应解析验证。` : "响应为空，本次联调失败。"}
`;

  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, report, "utf8");
  if (outputJson) {
    mkdirSync(dirname(outputJson), { recursive: true });
    writeFileSync(
      outputJson,
      `${JSON.stringify(
        {
          generatedAt: now,
          providerLabel,
          endpoint: redactUrl(endpoint),
          chatCompletionsUrl: redactUrl(resolveChatCompletionsUrl(endpoint)),
          model,
          stream,
          httpStatus: status,
          elapsedMs: Math.round(elapsedMs),
          responseNonEmpty: Boolean(safeContent),
          expectedPhraseFound: safeContent.includes("MoKnow AI E2E OK"),
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }
}

async function main() {
  const endpoint = argValue("--endpoint", process.env.AI_E2E_ENDPOINT ?? process.env.OPENAI_BASE_URL);
  const model = argValue("--model", process.env.AI_E2E_MODEL ?? process.env.OPENAI_MODEL);
  const providerLabel = argValue("--provider-label", process.env.AI_E2E_PROVIDER_LABEL ?? "真实外部 OpenAI-compatible Provider");
  const apiKeyEnv = argValue("--api-key-env", "AI_E2E_API_KEY");
  const apiKey = argValue("--api-key", process.env[apiKeyEnv] ?? process.env.OPENAI_API_KEY ?? "");
  const output = argValue("--output", "项目文档/AI外部模型联调记录.md");
  const outputJson = argValue("--output-json", "release/ai-e2e.json");
  const timeoutMs = Number(argValue("--timeout-ms", process.env.AI_E2E_TIMEOUT_MS ?? "30000"));
  const stream = hasFlag("--stream");
  const allowNoKey = hasFlag("--allow-no-key");

  assertConfig("AI_E2E_ENDPOINT or OPENAI_BASE_URL", endpoint);
  assertConfig("AI_E2E_MODEL or OPENAI_MODEL", model);
  if (!allowNoKey) assertConfig(`${apiKeyEnv} or OPENAI_API_KEY`, apiKey);

  const url = resolveChatCompletionsUrl(endpoint);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = performance.now();

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        stream,
        messages: [
          {
            role: "system",
            content: "你是 MoKnow 的发布前 AI 联调助手，只返回简洁中文。",
          },
          {
            role: "user",
            content: "请用中文一句话回答，并包含短语 MoKnow AI E2E OK：MoKnow 的 AI Provider 端到端联调是否成功？",
          },
        ],
      }),
      signal: controller.signal,
    });

    const elapsedMs = performance.now() - startedAt;
    const contentType = response.headers.get("content-type") ?? "";
    let content = "";
    if (stream) {
      content = await readStreamMessage(response);
    } else if (contentType.includes("application/json")) {
      const data = await response.json();
      content = extractMessage(data);
    } else {
      content = await response.text();
    }

    if (!response.ok) {
      throw new Error(`AI provider returned HTTP ${response.status}: ${content.slice(0, 300)}`);
    }
    if (!content.trim()) {
      throw new Error("AI provider response was empty.");
    }

    createReport({
      endpoint,
      model,
      providerLabel,
      stream,
      elapsedMs,
      status: response.status,
      content,
      output,
      outputJson,
    });

    console.log(`AI provider E2E passed. Report written to ${output} and ${outputJson}`);
  } finally {
    clearTimeout(timeout);
  }
}

main().catch((error) => {
  console.error(`AI provider E2E failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

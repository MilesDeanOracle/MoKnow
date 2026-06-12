#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const args = process.argv.slice(2);

function argValue(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

function hasFlag(name) {
  return args.includes(name);
}

function redactUrl(value) {
  if (!value) return "缺失";
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return value.replace(/([?&](?:api[_-]?key|token|key)=)[^&]+/gi, "$1<redacted>");
  }
}

function resolveChatCompletionsUrl(endpoint) {
  if (!endpoint) return "";
  const trimmed = endpoint.replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  return `${trimmed}/chat/completions`;
}

function statusText(ok) {
  return ok ? "通过" : "未通过";
}

function markdownTable(rows) {
  return [
    "| 项目 | 结论 | 证据 | 备注 |",
    "|---|---|---|---|",
    ...rows.map((row) => `| ${row.label} | ${statusText(row.ok)} | ${row.evidence} | ${row.note} |`),
  ].join("\n");
}

function replaceAutoSection(path, section) {
  const start = "<!-- AUTO_AI_PREFLIGHT_START -->";
  const end = "<!-- AUTO_AI_PREFLIGHT_END -->";
  const previous = readFileSync(path, "utf8");
  const block = `${start}\n${section.trim()}\n${end}`;
  if (previous.includes(start) && previous.includes(end)) {
    return previous.replace(new RegExp(`${start}[\\s\\S]*?${end}`), block);
  }
  return `${previous.trimEnd()}\n\n## AI 真实外部联调预检\n\n${block}\n`;
}

function isLocalUrl(url) {
  return ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
}

const endpoint = argValue("--endpoint", process.env.AI_E2E_ENDPOINT ?? process.env.OPENAI_BASE_URL ?? "");
const model = argValue("--model", process.env.AI_E2E_MODEL ?? process.env.OPENAI_MODEL ?? "");
const providerLabel = argValue("--provider-label", process.env.AI_E2E_PROVIDER_LABEL ?? "真实外部 OpenAI-compatible Provider");
const apiKeyEnv = argValue("--api-key-env", "AI_E2E_API_KEY");
const apiKey = argValue("--api-key", process.env[apiKeyEnv] ?? process.env.OPENAI_API_KEY ?? "");
const outputMarkdown = argValue("--output-md", "release/ai-e2e-preflight.md");
const outputJson = argValue("--output-json", "release/ai-e2e-preflight.json");
const docPath = argValue("--doc", "项目文档/AI外部模型联调记录.md");
const timeoutMs = Number(argValue("--timeout-ms", process.env.AI_E2E_TIMEOUT_MS ?? "30000"));
const allowNoKey = hasFlag("--allow-no-key");
const allowInsecure = hasFlag("--allow-insecure");
const strict = hasFlag("--strict");
const writeDoc = hasFlag("--write-doc");
const generatedAt = new Date().toISOString();

let parsedEndpoint;
try {
  parsedEndpoint = endpoint ? new URL(endpoint) : undefined;
} catch {
  parsedEndpoint = undefined;
}

const checks = [
  {
    label: "Endpoint 配置",
    ok: Boolean(endpoint),
    evidence: endpoint ? redactUrl(endpoint) : "`AI_E2E_ENDPOINT` / `OPENAI_BASE_URL` 缺失",
    note: "真实联调需要 OpenAI-compatible base URL，例如 https://api.openai.com/v1",
  },
  {
    label: "Endpoint URL 格式",
    ok: Boolean(parsedEndpoint),
    evidence: parsedEndpoint ? redactUrl(endpoint) : "无法解析为 URL",
    note: "脚本会自动拼接 /chat/completions",
  },
  {
    label: "Endpoint 安全协议",
    ok: !parsedEndpoint || parsedEndpoint.protocol === "https:" || allowInsecure || isLocalUrl(parsedEndpoint),
    evidence: parsedEndpoint ? parsedEndpoint.protocol : "无 endpoint",
    note: "真实外部 Provider 推荐 HTTPS；本地服务可用 http://127.0.0.1",
  },
  {
    label: "Model 配置",
    ok: Boolean(model),
    evidence: model || "`AI_E2E_MODEL` / `OPENAI_MODEL` 缺失",
    note: "真实联调需要明确模型名",
  },
  {
    label: "API Key 配置",
    ok: allowNoKey || Boolean(apiKey),
    evidence: apiKey ? `<已配置，长度 ${apiKey.length}>` : allowNoKey ? "已允许无 Key 模式" : `\`${apiKeyEnv}\` / \`OPENAI_API_KEY\` 缺失`,
    note: "除 Ollama / 本地兼容服务外，真实外部 Provider 需要 API Key",
  },
  {
    label: "超时配置",
    ok: Number.isFinite(timeoutMs) && timeoutMs > 0,
    evidence: `${timeoutMs} ms`,
    note: "用于 ai:e2e 请求超时保护",
  },
];

const failures = checks.filter((check) => !check.ok);
const chatCompletionsUrl = resolveChatCompletionsUrl(endpoint);
const markdown = `# AI 真实外部联调预检

| 项目 | 值 |
|---|---|
| 生成时间 | ${generatedAt} |
| Provider | ${providerLabel} |
| Endpoint | ${redactUrl(endpoint)} |
| Chat Completions URL | ${redactUrl(chatCompletionsUrl)} |
| Model | ${model || "缺失"} |
| 严格模式 | ${strict ? "是" : "否"} |
| 失败项数量 | ${failures.length} |

${markdownTable(checks)}

## 后续命令

\`\`\`bash
npm run ai:e2e:preflight -- --strict --write-doc
npm run ai:e2e
npm run ai:e2e -- --stream
\`\`\`

> 本预检不调用真实模型，不记录 API Key、token 或其它敏感凭据。
`;

const report = {
  generatedAt,
  providerLabel,
  endpoint: redactUrl(endpoint),
  chatCompletionsUrl: redactUrl(chatCompletionsUrl),
  model,
  strict,
  allowNoKey,
  checks,
  failures: failures.map((check) => check.label),
};

mkdirSync(dirname(outputMarkdown), { recursive: true });
writeFileSync(outputMarkdown, markdown, "utf8");
writeFileSync(outputJson, `${JSON.stringify(report, null, 2)}\n`, "utf8");

if (writeDoc) {
  writeFileSync(docPath, replaceAutoSection(docPath, markdown), "utf8");
}

console.log(`AI provider preflight written to ${outputMarkdown} and ${outputJson}.`);
for (const check of checks) console.log(`- ${check.label}: ${statusText(check.ok)}`);

if (strict && failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure.label}`);
  process.exit(1);
}

#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      data = undefined;
    }
    return {
      ok: response.ok,
      status: response.status,
      data,
      text: text.slice(0, 300),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function envCandidate() {
  const endpoint = process.env.AI_E2E_ENDPOINT ?? process.env.OPENAI_BASE_URL ?? "";
  const model = process.env.AI_E2E_MODEL ?? process.env.OPENAI_MODEL ?? "";
  const apiKey = process.env.AI_E2E_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
  return {
    id: "env-openai-compatible",
    label: process.env.AI_E2E_PROVIDER_LABEL ?? "环境变量 OpenAI-compatible Provider",
    endpoint,
    model,
    apiKeyConfigured: Boolean(apiKey),
    allowNoKey: false,
    detected: Boolean(endpoint && model && apiKey),
    evidence: endpoint && model ? "环境变量 endpoint/model 已配置" : "环境变量 endpoint/model/key 不完整",
  };
}

async function ollamaCandidate(timeoutMs) {
  const endpoint = argValue("--ollama-endpoint", process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434");
  const tagsUrl = `${endpoint.replace(/\/+$/, "")}/api/tags`;
  const result = await fetchJson(tagsUrl, timeoutMs);
  const models = Array.isArray(result.data?.models) ? result.data.models : [];
  const model = argValue("--ollama-model", process.env.OLLAMA_MODEL ?? models[0]?.name ?? "");
  return {
    id: "ollama-local",
    label: "本机 Ollama OpenAI-compatible Provider",
    endpoint: `${endpoint.replace(/\/+$/, "")}/v1`,
    model,
    apiKeyConfigured: false,
    allowNoKey: true,
    detected: result.ok && Boolean(model),
    evidence: result.ok
      ? models.length > 0
        ? `Ollama /api/tags 返回 ${models.length} 个模型`
        : "Ollama /api/tags 可访问，但没有模型"
      : `Ollama 不可用：${result.error ?? `HTTP ${result.status}`}`,
  };
}

async function lmStudioCandidate(timeoutMs) {
  const endpoint = argValue("--lmstudio-endpoint", process.env.LMSTUDIO_BASE_URL ?? "http://127.0.0.1:1234/v1");
  const modelsUrl = `${endpoint.replace(/\/+$/, "")}/models`;
  const result = await fetchJson(modelsUrl, timeoutMs);
  const models = Array.isArray(result.data?.data) ? result.data.data : [];
  const model = argValue("--lmstudio-model", process.env.LMSTUDIO_MODEL ?? models[0]?.id ?? "");
  return {
    id: "lmstudio-local",
    label: "本机 LM Studio OpenAI-compatible Provider",
    endpoint,
    model,
    apiKeyConfigured: false,
    allowNoKey: true,
    detected: result.ok && Boolean(model),
    evidence: result.ok
      ? models.length > 0
        ? `LM Studio /models 返回 ${models.length} 个模型`
        : "LM Studio /models 可访问，但没有模型"
      : `LM Studio 不可用：${result.error ?? `HTTP ${result.status}`}`,
  };
}

function runE2e(candidate, options) {
  const commandArgs = [
    "scripts/ai-provider-e2e.mjs",
    "--endpoint",
    candidate.endpoint,
    "--model",
    candidate.model,
    "--provider-label",
    candidate.label,
    "--output",
    options.outputDoc,
    "--output-json",
    options.outputE2eJson,
    "--timeout-ms",
    String(options.e2eTimeoutMs),
    ...(candidate.allowNoKey ? ["--allow-no-key"] : []),
  ];
  const result = spawnSync("node", commandArgs, {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  return {
    ok: result.status === 0,
    command: `node ${commandArgs.map((value) => (/\s/.test(value) ? `'${value}'` : value)).join(" ")}`,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
    status: result.status ?? 1,
  };
}

function markdownTable(candidates) {
  return [
    "| Provider | 探测结果 | Endpoint | Model | Key | 证据 |",
    "|---|---|---|---|---|---|",
    ...candidates.map(
      (candidate) =>
        `| ${candidate.label} | ${candidate.detected ? "可用" : "不可用"} | ${redactUrl(candidate.endpoint)} | ${candidate.model || "缺失"} | ${candidate.apiKeyConfigured ? "已配置" : candidate.allowNoKey ? "无 Key 模式" : "缺失"} | ${candidate.evidence} |`,
    ),
  ].join("\n");
}

function replaceAutoSection(path, section) {
  const start = "<!-- AUTO_AI_DISCOVERY_START -->";
  const end = "<!-- AUTO_AI_DISCOVERY_END -->";
  const previous = existsSync(path) ? readFileSync(path, "utf8") : "";
  const block = `${start}\n${section.trim()}\n${end}`;
  if (previous.includes(start) && previous.includes(end)) {
    return previous.replace(new RegExp(`${start}[\\s\\S]*?${end}`), block);
  }
  return previous.trim() ? `${previous.trimEnd()}\n\n## AI 真实 Provider 自动探测\n\n${block}\n` : `${block}\n`;
}

const timeoutMs = Number(argValue("--detect-timeout-ms", "2000"));
const e2eTimeoutMs = Number(argValue("--timeout-ms", process.env.AI_E2E_TIMEOUT_MS ?? "30000"));
const outputJson = argValue("--output-json", "release/ai-e2e-auto.json");
const outputMarkdown = argValue("--output-md", "release/ai-e2e-auto.md");
const outputDoc = argValue("--doc", "项目文档/AI外部模型联调记录.md");
const outputE2eJson = argValue("--e2e-output-json", "release/ai-e2e.json");
const detectOnly = hasFlag("--detect-only");
const writeDoc = hasFlag("--write-doc");
const strict = hasFlag("--strict");
const generatedAt = new Date().toISOString();

const candidates = [
  envCandidate(),
  await ollamaCandidate(timeoutMs),
  await lmStudioCandidate(timeoutMs),
];
const selected = candidates.find((candidate) => candidate.detected);
const e2eResult = selected && !detectOnly ? runE2e(selected, { outputDoc, outputE2eJson, e2eTimeoutMs }) : undefined;
const passed = Boolean(e2eResult?.ok);

const markdown = `# AI 真实 Provider 自动探测

| 项目 | 值 |
|---|---|
| 生成时间 | ${generatedAt} |
| 探测超时 | ${timeoutMs} ms |
| 执行真实 E2E | ${selected && !detectOnly ? "是" : "否"} |
| 选中 Provider | ${selected?.label ?? "无"} |
| E2E 结果 | ${e2eResult ? (e2eResult.ok ? "通过" : "未通过") : "未执行"} |

${markdownTable(candidates)}

## E2E 输出摘要

${e2eResult ? `- 命令：\`${e2eResult.command}\`\n- 退出码：${e2eResult.status}\n- stdout：${e2eResult.stdout || "无"}\n- stderr：${e2eResult.stderr || "无"}` : "未发现可用真实 Provider，未执行 E2E。"}

> 自动探测不会记录 API Key、token 或其它敏感凭据；本地 Ollama / LM Studio 使用无 Key 模式。
`;

const report = {
  generatedAt,
  timeoutMs,
  detectOnly,
  selectedProvider: selected?.id ?? "",
  passed,
  candidates,
  e2eResult,
};

mkdirSync(dirname(outputMarkdown), { recursive: true });
writeFileSync(outputMarkdown, markdown, "utf8");
writeFileSync(outputJson, `${JSON.stringify(report, null, 2)}\n`, "utf8");
if (writeDoc) {
  writeFileSync(outputDoc, replaceAutoSection(outputDoc, markdown), "utf8");
}

console.log(`AI provider auto E2E report written to ${outputMarkdown} and ${outputJson}.`);
for (const candidate of candidates) {
  console.log(`- ${candidate.label}: ${candidate.detected ? "available" : "unavailable"} (${candidate.evidence})`);
}
if (e2eResult) console.log(`- E2E: ${e2eResult.ok ? "passed" : "failed"}`);

if (strict && !passed) {
  console.error("FAIL: no real AI provider E2E success was recorded.");
  process.exit(1);
}

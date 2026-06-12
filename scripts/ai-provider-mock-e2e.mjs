#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const args = process.argv.slice(2);

function argValue(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

function hasFlag(name) {
  return args.includes(name);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function writeJson(response, status, data) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(data));
}

function writeStream(response) {
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  for (const content of ["MoKnow ", "AI E2E ", "OK：", "本地兼容服务流式联调成功。"]) {
    response.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
  }
  response.end("data: [DONE]\n\n");
}

function createMockServer({ expectedKey, requests }) {
  return createServer(async (request, response) => {
    try {
      if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
        writeJson(response, 404, { error: { message: "not found" } });
        return;
      }

      const authorization = request.headers.authorization ?? "";
      if (authorization !== `Bearer ${expectedKey}`) {
        writeJson(response, 401, { error: { message: "invalid bearer token" } });
        return;
      }

      const body = JSON.parse(await readBody(request));
      requests.push({
        model: body.model,
        stream: Boolean(body.stream),
        messages: Array.isArray(body.messages) ? body.messages.length : 0,
      });

      if (body.stream) {
        writeStream(response);
        return;
      }

      writeJson(response, 200, {
        id: "chatcmpl-moknow-mock",
        object: "chat.completion",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "MoKnow AI E2E OK：本地兼容服务非流式联调成功。",
            },
            finish_reason: "stop",
          },
        ],
      });
    } catch (error) {
      writeJson(response, 500, { error: { message: error instanceof Error ? error.message : String(error) } });
    }
  });
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Mock AI server did not expose a TCP port."));
        return;
      }
      resolve(address.port);
    });
  });
}

function runE2e({ endpoint, model, apiKey, output, stream }) {
  const childArgs = [
    "scripts/ai-provider-e2e.mjs",
    "--output",
    output,
    "--provider-label",
    "本地 OpenAI-compatible mock Provider",
    ...(stream ? ["--stream"] : []),
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, childArgs, {
      stdio: "inherit",
      env: {
        ...process.env,
        AI_E2E_ENDPOINT: endpoint,
        AI_E2E_MODEL: model,
        AI_E2E_API_KEY: apiKey,
      },
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`ai-provider-e2e failed with exit code ${code ?? "unknown"}`));
    });
  });
}

function replaceAutoSection(path, section) {
  const start = "<!-- AUTO_MOCK_AI_E2E_START -->";
  const end = "<!-- AUTO_MOCK_AI_E2E_END -->";
  const previous = readFileSync(path, "utf8");
  const block = `${start}\n${section.trim()}\n${end}`;
  if (previous.includes(start) && previous.includes(end)) {
    return previous.replace(new RegExp(`${start}[\\s\\S]*?${end}`), block);
  }
  return `${previous.trimEnd()}\n\n## 本地兼容服务自测\n\n${block}\n`;
}

const outputDir = argValue("--output-dir", "release/ai-e2e-mock");
const docPath = argValue("--doc", "项目文档/AI外部模型联调记录.md");
const model = argValue("--model", "moknow-mock-model");
const apiKey = "moknow-mock-api-key";
const writeDoc = hasFlag("--write-doc");
const requests = [];
const server = createMockServer({ expectedKey: apiKey, requests });

try {
  const port = await listen(server);
  const endpoint = `http://127.0.0.1:${port}/v1`;
  mkdirSync(outputDir, { recursive: true });

  await runE2e({
    endpoint,
    model,
    apiKey,
    output: join(outputDir, "non-stream.md"),
    stream: false,
  });

  await runE2e({
    endpoint,
    model,
    apiKey,
    output: join(outputDir, "stream.md"),
    stream: true,
  });

  const nonStreamReport = readFileSync(join(outputDir, "non-stream.md"), "utf8");
  const streamReport = readFileSync(join(outputDir, "stream.md"), "utf8");
  const summary = {
    generatedAt: new Date().toISOString(),
    endpoint,
    model,
    requests,
    nonStreamPassed: nonStreamReport.includes("MoKnow AI E2E OK"),
    streamPassed: streamReport.includes("MoKnow AI E2E OK"),
  };

  if (requests.length !== 2 || !requests.some((request) => !request.stream) || !requests.some((request) => request.stream)) {
    throw new Error("Mock AI server did not receive both non-streaming and streaming requests.");
  }
  if (!summary.nonStreamPassed || !summary.streamPassed) {
    throw new Error("Mock AI E2E reports did not include the expected success phrase.");
  }

  writeFileSync(join(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  const markdown = `# AI E2E 本地兼容服务自测

| 项目 | 结果 |
|---|---|
| 时间 | ${summary.generatedAt} |
| Endpoint | ${endpoint} |
| Model | ${model} |
| 请求数 | ${requests.length} |
| 非流式解析 | ${summary.nonStreamPassed ? "通过" : "未通过"} |
| 流式解析 | ${summary.streamPassed ? "通过" : "未通过"} |

> 本自测只验证 OpenAI-compatible 请求、鉴权、JSON 响应解析和 SSE 流式解析链路；不等同于真实外部模型联调。
`;
  writeFileSync(join(outputDir, "summary.md"), markdown, "utf8");

  if (writeDoc) {
    writeFileSync(docPath, replaceAutoSection(docPath, markdown), "utf8");
  }

  console.log(`Mock AI provider E2E passed. Summary written to ${join(outputDir, "summary.md")}`);
} finally {
  await new Promise((resolve) => server.close(resolve));
}

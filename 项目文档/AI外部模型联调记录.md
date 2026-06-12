# AI 外部模型联调记录

> 本文件用于记录 `npm run ai:e2e` 的真实外部模型端到端结果。记录中禁止写入 API Key、token 或其它敏感凭据。

## 运行方式

```bash
AI_E2E_ENDPOINT=https://api.openai.com/v1 \
AI_E2E_MODEL=gpt-4.1-mini \
AI_E2E_API_KEY=*** \
npm run ai:e2e
```

可选流式验证：

```bash
AI_E2E_ENDPOINT=https://api.openai.com/v1 \
AI_E2E_MODEL=gpt-4.1-mini \
AI_E2E_API_KEY=*** \
npm run ai:e2e -- --stream
```

Ollama / 本地 OpenAI-compatible 服务可使用无 Key 模式：

```bash
AI_E2E_ENDPOINT=http://127.0.0.1:11434/v1 \
AI_E2E_MODEL=llama3.1 \
npm run ai:e2e -- --allow-no-key
```

发布前可先运行本地 OpenAI-compatible mock 自测，验证 `ai:e2e` 脚本的鉴权、非流式 JSON 解析和 SSE 流式解析链路：

```bash
npm run ai:e2e:mock -- --write-doc
```

> 本地 mock 自测不等同于真实外部模型联调；真实发布验收仍需配置真实 Provider 后执行 `npm run ai:e2e`。

## 最近记录

| 日期 | Provider | Model | Stream | 结论 | 备注 |
|---|---|---|---|---|---|
| 待实机运行 | 待填写 | 待填写 | 待填写 | 待填写 | 当前环境未配置 `AI_E2E_ENDPOINT` / `AI_E2E_MODEL` / `AI_E2E_API_KEY`，尚未产生真实外部请求记录 |

## 本地兼容服务自测

<!-- AUTO_MOCK_AI_E2E_START -->
# AI E2E 本地兼容服务自测

| 项目 | 结果 |
|---|---|
| 时间 | 2026-06-08T21:33:13.309Z |
| Endpoint | http://127.0.0.1:52741/v1 |
| Model | moknow-mock-model |
| 请求数 | 2 |
| 非流式解析 | 通过 |
| 流式解析 | 通过 |

> 本自测只验证 OpenAI-compatible 请求、鉴权、JSON 响应解析和 SSE 流式解析链路；不等同于真实外部模型联调。
<!-- AUTO_MOCK_AI_E2E_END -->

## AI 真实外部联调预检

<!-- AUTO_AI_PREFLIGHT_START -->
# AI 真实外部联调预检

| 项目 | 值 |
|---|---|
| 生成时间 | 2026-06-12T02:34:52.968Z |
| Provider | 真实外部 OpenAI-compatible Provider |
| Endpoint | 缺失 |
| Chat Completions URL | 缺失 |
| Model | 缺失 |
| 严格模式 | 否 |
| 失败项数量 | 4 |

| 项目 | 结论 | 证据 | 备注 |
|---|---|---|---|
| Endpoint 配置 | 未通过 | `AI_E2E_ENDPOINT` / `OPENAI_BASE_URL` 缺失 | 真实联调需要 OpenAI-compatible base URL，例如 https://api.openai.com/v1 |
| Endpoint URL 格式 | 未通过 | 无法解析为 URL | 脚本会自动拼接 /chat/completions |
| Endpoint 安全协议 | 通过 | 无 endpoint | 真实外部 Provider 推荐 HTTPS；本地服务可用 http://127.0.0.1 |
| Model 配置 | 未通过 | `AI_E2E_MODEL` / `OPENAI_MODEL` 缺失 | 真实联调需要明确模型名 |
| API Key 配置 | 未通过 | `AI_E2E_API_KEY` / `OPENAI_API_KEY` 缺失 | 除 Ollama / 本地兼容服务外，真实外部 Provider 需要 API Key |
| 超时配置 | 通过 | 30000 ms | 用于 ai:e2e 请求超时保护 |

## 后续命令

```bash
npm run ai:e2e:preflight -- --strict --write-doc
npm run ai:e2e
npm run ai:e2e -- --stream
```

> 本预检不调用真实模型，不记录 API Key、token 或其它敏感凭据。
<!-- AUTO_AI_PREFLIGHT_END -->

## AI 真实 Provider 自动探测

<!-- AUTO_AI_DISCOVERY_START -->
# AI 真实 Provider 自动探测

| 项目 | 值 |
|---|---|
| 生成时间 | 2026-06-12T04:42:51.488Z |
| 探测超时 | 2000 ms |
| 执行真实 E2E | 否 |
| 选中 Provider | 无 |
| E2E 结果 | 未执行 |

| Provider | 探测结果 | Endpoint | Model | Key | 证据 |
|---|---|---|---|---|---|
| 环境变量 OpenAI-compatible Provider | 不可用 | 缺失 | 缺失 | 缺失 | 环境变量 endpoint/model/key 不完整 |
| 本机 Ollama OpenAI-compatible Provider | 不可用 | http://127.0.0.1:11434/v1 | 缺失 | 无 Key 模式 | Ollama 不可用：fetch failed |
| 本机 LM Studio OpenAI-compatible Provider | 不可用 | http://127.0.0.1:1234/v1 | 缺失 | 无 Key 模式 | LM Studio 不可用：fetch failed |

## E2E 输出摘要

未发现可用真实 Provider，未执行 E2E。

> 自动探测不会记录 API Key、token 或其它敏感凭据；本地 Ollama / LM Studio 使用无 Key 模式。
<!-- AUTO_AI_DISCOVERY_END -->

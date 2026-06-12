<!-- AUTO_RELEASE_SECRETS_SYNC_START -->
# GitHub Actions Secrets 同步记录

| 项目 | 值 |
|---|---|
| 生成时间 | 2026-06-12T02:42:50.571Z |
| 仓库 | MilesDeanOracle/MoKnow |
| 模式 | 预览 |
| 严格模式 | 否 |
| GitHub CLI | 可用 |
| GitHub 登录 | 未通过 |
| 可同步项数量 | 0 |
| 缺失关键变量数量 | 13 |
| 写入阻断原因 | 无 |

| Secret | 分组 | 本机环境变量状态 | 动作 | 用途 |
|---|---|---|---|---|
| `AI_E2E_ENDPOINT` | AI 真实联调 | 缺失 | 跳过 | AI final audit |
| `AI_E2E_MODEL` | AI 真实联调 | 缺失 | 跳过 | AI final audit |
| `AI_E2E_API_KEY` | AI 真实联调 | 缺失 | 跳过 | AI final audit |
| `AI_E2E_PROVIDER_LABEL` | AI 真实联调 | 缺失 | 跳过 | AI report label |
| `TAURI_SIGNING_PRIVATE_KEY` | Tauri updater | 缺失 | 跳过 | updater signatures |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Tauri updater | 缺失 | 跳过 | optional encrypted private key |
| `MOKNOW_UPDATER_PUBKEY` | Tauri updater | 缺失 | 跳过 | updater config |
| `MOKNOW_UPDATER_ENDPOINT` | Tauri updater | 缺失 | 跳过 | latest.json endpoint |
| `APPLE_CERTIFICATE` | macOS 签名 | 缺失 | 跳过 | Developer ID signing |
| `APPLE_CERTIFICATE_PASSWORD` | macOS 签名 | 缺失 | 跳过 | Developer ID signing |
| `APPLE_SIGNING_IDENTITY` | macOS 签名 | 缺失 | 跳过 | optional signing identity |
| `APPLE_ID` | macOS 公证 | 缺失 | 跳过 | Apple ID notarization |
| `APPLE_PASSWORD` | macOS 公证 | 缺失 | 跳过 | Apple ID notarization |
| `APPLE_TEAM_ID` | macOS 公证 | 缺失 | 跳过 | Apple ID notarization |
| `APPLE_API_KEY` | macOS 公证 | 缺失 | 跳过 | ASC API notarization |
| `APPLE_API_ISSUER` | macOS 公证 | 缺失 | 跳过 | ASC API notarization |
| `APPLE_PROVIDER_SHORT_NAME` | macOS 公证 | 缺失 | 跳过 | optional provider short name |
| `WINDOWS_CERTIFICATE` | Windows code signing | 缺失 | 跳过 | Authenticode signing |
| `WINDOWS_CERTIFICATE_PASSWORD` | Windows code signing | 缺失 | 跳过 | Authenticode signing |
| `MOKNOW_HOMEBREW_TAP` | 分发 | 缺失 | 跳过 | Homebrew cask publishing |

## 写入结果

| Secret | 结果 | 摘要 |
|---|---|---|
| 无 | 未执行 | 默认预览模式，传入 `--apply` 后才写入 GitHub Secrets。 |


> 本报告只记录 secret 名称、是否配置、是否写入和命令摘要，不记录 secret 值。
<!-- AUTO_RELEASE_SECRETS_SYNC_END -->

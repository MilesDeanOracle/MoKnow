<!-- AUTO_RELEASE_SECRETS_AUDIT_START -->
# GitHub Actions Secrets 审计记录

| 项目 | 值 |
|---|---|
| 生成时间 | 2026-06-12T03:37:14.983Z |
| 仓库 | MilesDeanOracle/MoKnow |
| GitHub CLI | 可用 |
| GitHub 登录 | 通过 |
| secrets 查询 | 通过 |
| 已发现 secret 数量 | 0 |
| 严格模式 | 否 |
| 缺失项数量 | 6 |

| 项目 | 结论 | GitHub Secret 状态 | 备注 |
|---|---|---|---|
| Tauri updater 签名私钥 | 缺失 | `TAURI_SIGNING_PRIVATE_KEY`: 缺失 | 生成 updater .sig；如私钥有密码，建议同时配置 TAURI_SIGNING_PRIVATE_KEY_PASSWORD。 |
| Tauri updater 公钥 | 缺失 | `MOKNOW_UPDATER_PUBKEY`: 缺失 | Release workflow 生成 Tauri updater 配置所需公钥。 |
| macOS Developer ID 签名 | 缺失 | `APPLE_CERTIFICATE`: 缺失<br>`APPLE_CERTIFICATE_PASSWORD`: 缺失 | 用于 macOS app / DMG 签名；APPLE_SIGNING_IDENTITY 可选。 |
| macOS 公证 | 缺失 | 方案 1: `APPLE_ID`: 缺失，`APPLE_PASSWORD`: 缺失，`APPLE_TEAM_ID`: 缺失<br>方案 2: `APPLE_API_KEY`: 缺失，`APPLE_API_ISSUER`: 缺失 | Apple ID 模式或 App Store Connect API 模式满足一组即可。 |
| Windows code signing | 缺失 | `WINDOWS_CERTIFICATE`: 缺失<br>`WINDOWS_CERTIFICATE_PASSWORD`: 缺失 | 用于 Windows 安装包 Authenticode 签名。 |
| Homebrew tap | 缺失 | `MOKNOW_HOMEBREW_TAP`: 缺失 | 正式 Homebrew 分发目标，例如 owner/homebrew-tap。 |

## 可选 Secret

| Secret | 状态 |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 缺失 |
| `MOKNOW_UPDATER_ENDPOINT` | 缺失 |
| `APPLE_SIGNING_IDENTITY` | 缺失 |
| `APPLE_PROVIDER_SHORT_NAME` | 缺失 |

## 命令摘要

| 命令 | 摘要 |
|---|---|
| `gh --version` | gh version 2.73.0 (2025-05-19)<br>https://github.com/cli/cli/releases/tag/v2.73.0 |
| `gh auth status` | github.com<br>✓ Logged in to github.com account MilesDeanOracle (keyring)<br>- Active account: true<br>- Git operations protocol: https<br>- Token: gho_************************************<br>- Token scopes: 'gist', 'read:org', 'repo', 'workflow' |
| `gh secret list --repo MilesDeanOracle/MoKnow` | [] |

> 本报告只列出 secret 名称是否存在和更新时间，不读取或记录 secret 值。
<!-- AUTO_RELEASE_SECRETS_AUDIT_END -->

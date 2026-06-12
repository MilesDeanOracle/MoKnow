<!-- AUTO_CI_PREFLIGHT_START -->
# 发布 CI 预检记录

| 项目 | 值 |
|---|---|
| 生成时间 | 2026-06-12T04:43:34.142Z |
| 仓库 | MilesDeanOracle/MoKnow |
| 分支 / ref | main |
| workflow | release-dry-run.yml |
| 严格模式 | 否 |
| 失败项数量 | 3 |

| 项目 | 结论 | 证据 | 备注 |
|---|---|---|---|
| GitHub CLI | 通过 | gh version 2.73.0 (2025-05-19)<br>https://github.com/cli/cli/releases/tag/v2.73.0 |  |
| GitHub CLI 登录 | 通过 | github.com<br>✓ Logged in to github.com account MilesDeanOracle (keyring)<br>- Active account: true<br>- Git operations protocol: https<br>- Token: gho_************************************<br>- Token scopes: 'gist', 'read:org', 'repo', 'workflow' |  |
| Git origin | 通过 | https://github.com/MilesDeanOracle/MoKnow.git |  |
| 当前分支 | 通过 | main |  |
| 发布相关本地改动 | 警告 | M package.json<br>?? .github/workflows/<br>?? Makefile<br>?? scripts/aggregate-release-evidence.mjs<br>?? scripts/ai-provider-auto-e2e.mjs<br>?? scripts/ai-provider-e2e.mjs<br>?? scripts/ai-provider-mock-e2e.mjs<br>?? scripts/ai-provider-preflight.mjs<br>?? scripts/final-progress-audit.mjs<br>?? scripts/generate-external-closure-handoff.mjs<br>?? scripts/generate-release-metadata.mjs<br>?? scripts/prepare-mermaid-vendor.mjs<br>?? scripts/prepare-tauri-updater-config.mjs<br>?? scripts/record-install-smoke-evidence.mjs<br>?? scripts/release-artifact-check.mjs<br>?? scripts/release-check.mjs<br>?? scripts/release-ci-preflight.mjs<br>?? scripts/release-closure-gate.mjs<br>?? scripts/release-distribution-verify.mjs<br>?? scripts/release-external-readiness.mjs<br>?? scripts/release-install-smoke.mjs<br>?? scripts/release-push-readiness.mjs<br>?? scripts/release-remote-status.mjs<br>?? scripts/release-required-files.mjs<br>?? scripts/release-secrets-audit.mjs<br>?? scripts/release-signing-verify.mjs<br>?? scripts/release-submission-manifest.mjs<br>?? scripts/release-submission-plan.mjs<br>?? scripts/release-submission-preview.mjs<br>?? scripts/release-submission-safety.mjs<br>?? scripts/release-submit-prep.mjs<br>?? scripts/release-tracking-gate.mjs<br>?? scripts/run-release-dry-run.mjs<br>?? scripts/sync-release-secrets.mjs<br>?? scripts/validate-release-workflows.mjs<br>?? scripts/verify-downloaded-artifacts.mjs<br>?? "\351\241\271\347\233\256\346\226\207\346\241\243/" | 远端 dry-run 只能使用已推送到 ref 的内容 |
| 提交前准备总览 | 通过 | 提交前准备通过，tree 8ccf8d924f9f29eaad4742f96ac15f3af021f7c3 |  |
| 提交安全检查 | 通过 | 73 个文件无密钥/生成产物风险 |  |
| 提交安全检查警告 | 通过 | 无 |  |
| 提交计划临时 index 模拟 | 通过 | 73 / 73 个必需文件可被临时 index 跟踪 | 真实 git index 尚未变化；该项证明按 submission pathspec 暂存后本地入库条件可满足 |
| 提交计划 git add dry-run | 通过 | add '.gitignore'<br>add 'README.md'<br>add 'package-lock.json'<br>add 'package.json'<br>add 'src-tauri/Cargo.lock'<br>add 'src-tauri/Cargo.toml'<br>add 'src-tauri/src/lib.rs'<br>add 'src-tauri/src/services/mod.rs'<br>add 'src/services/commandGateway.ts'<br>add 'src/services/mockCommandGateway.ts'<br>add 'src/services/repositoryService.ts'<br>add 'src/types/models.ts'<br>add '.github/workflows/release-dry-run.yml'<br>add '.github/workflows/release.yml'<br>add 'CHANGELOG.md'<br>add 'Makefile'<br>add 'scripts/aggregate-release-evidence.mjs'<br>add 'scripts/ai-provider-auto-e2e.mjs'<br>add 'scripts/ai-provider-e2e.mjs'<br>add 'scripts/ai-provider-mock-e2e.mjs' |  |
| 提交校验清单 | 通过 | 73 个文件，72 个参与聚合，聚合 SHA-256 15034c6aa5cd1208ea62999ac75ee6c3947dd820e1de505137fd297c6f6ba192 |  |
| 提交预演 | 通过 | tree 8ccf8d924f9f29eaad4742f96ac15f3af021f7c3，73 个必需文件已进入临时 index |  |
| 提交预演警告 | 通过 | 无 |  |
| 推送准备临时 index 证据 | 通过 | 73 个必需文件可按 pathspec 入库 | 该项不代表已提交推送，只证明推送前置文件清单可执行 |
| 推送准备失败项 | 通过 | 无 |  |
| 推送准备警告项 | 警告 | 工作区状态<br>提交计划未入库文件<br>远端 Release Dry Run workflow |  |
| .github/workflows/release-dry-run.yml 本地文件 | 通过 | 文件存在 |  |
| .github/workflows/release-dry-run.yml 包含 workflow_dispatch | 通过 | 已找到 |  |
| .github/workflows/release-dry-run.yml 包含 macos-latest | 通过 | 已找到 |  |
| .github/workflows/release-dry-run.yml 包含 windows-latest | 通过 | 已找到 |  |
| .github/workflows/release-dry-run.yml 包含 ubuntu-22.04 | 通过 | 已找到 |  |
| .github/workflows/release-dry-run.yml 包含 tauri-apps/tauri-action | 通过 | 已找到 |  |
| .github/workflows/release-dry-run.yml 包含 actions/upload-artifact | 通过 | 已找到 |  |
| .github/workflows/release-dry-run.yml 包含 npm run release:artifacts | 通过 | 已找到 |  |
| .github/workflows/release-dry-run.yml 包含 npm run release:install-smoke | 通过 | 已找到 |  |
| .github/workflows/release-dry-run.yml 包含 npm run release:signing | 通过 | 已找到 |  |
| .github/workflows/release-dry-run.yml 包含 release/**/*.md | 通过 | 已找到 |  |
| .github/workflows/release-dry-run.yml 已纳入 git 索引 | 未通过 | git ls-files 未找到 | 需提交/推送后远端才可触发 workflow_dispatch |
| .github/workflows/release.yml 本地文件 | 通过 | 文件存在 |  |
| .github/workflows/release.yml 包含 push: | 通过 | 已找到 |  |
| .github/workflows/release.yml 包含 tags: | 通过 | 已找到 |  |
| .github/workflows/release.yml 包含 npm run release:updater-config | 通过 | 已找到 |  |
| .github/workflows/release.yml 包含 --config src-tauri/tauri.updater.conf.json | 通过 | 已找到 |  |
| .github/workflows/release.yml 包含 --require-updater-signatures | 通过 | 已找到 |  |
| .github/workflows/release.yml 包含 npm run release:install-smoke | 通过 | 已找到 |  |
| .github/workflows/release.yml 包含 npm run release:signing -- --require-signed --require-notarized | 通过 | 已找到 |  |
| .github/workflows/release.yml 包含 release/**/*.md | 通过 | 已找到 |  |
| .github/workflows/release.yml 包含 gh release upload | 通过 | 已找到 |  |
| .github/workflows/release.yml 已纳入 git 索引 | 未通过 | git ls-files 未找到 | 需提交/推送后远端才可触发 workflow_dispatch |
| 远端 Release Dry Run workflow | 未通过 | {"message":"Not Found","documentation_url":"https://docs.github.com/rest/actions/workflows#get-a-workflow","status":"404"}<br>gh: Not Found (HTTP 404) | 需要先提交并推送 .github/workflows/release-dry-run.yml 到远端默认分支 |
| 远端 dry-run 历史 | 警告 | HTTP 404: workflow release-dry-run.yml not found on the default branch (https://api.github.com/repos/MilesDeanOracle/MoKnow/actions/workflows/release-dry-run.yml) | 远端 workflow 不存在时无法查询历史 |

## 后续命令

```bash
npm run release:submit-prep -- --write-doc
npm run release:submission-safety -- --strict --write-doc
npm run release:submission-plan -- --strict --write-doc
npm run release:submission-manifest -- --strict --write-doc
npm run release:submission-preview -- --strict --write-doc
npm run release:push-readiness -- --write-doc
git add --pathspec-from-file=release/submission-pathspec.txt --pathspec-file-nul
npm run release:tracking -- --strict --write-doc
git commit -m "chore: add release validation workflow"
git push origin main
npm run release:ci-preflight -- --strict --write-doc
npm run release:dry-run -- --write-doc
```

> 本记录只验证远端 CI dry-run 前置条件，不包含任何 GitHub token 或 secret。
<!-- AUTO_CI_PREFLIGHT_END -->

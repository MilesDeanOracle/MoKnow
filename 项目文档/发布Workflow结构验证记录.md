<!-- AUTO_WORKFLOW_VALIDATION_START -->
# Release Workflow 结构验证记录

| 项目 | 值 |
|---|---|
| 生成时间 | 2026-06-12T02:35:17.856Z |
| 严格模式 | 否 |
| 检查项数量 | 60 |
| 失败项数量 | 0 |

| 项目 | 结论 | 证据 | 备注 |
|---|---|---|---|
| .github/workflows/release-dry-run.yml YAML 解析 | 通过 | Ruby YAML 解析通过 |  |
| .github/workflows/release-dry-run.yml workflow 名称 | 通过 | Release Dry Run |  |
| .github/workflows/release-dry-run.yml build job | 通过 | 存在 |  |
| .github/workflows/release-dry-run.yml verify job | 通过 | 存在 |  |
| .github/workflows/release-dry-run.yml verify needs build | 通过 | needs: build |  |
| .github/workflows/release-dry-run.yml 三平台矩阵 | 通过 | macOS:macos-latest, Windows:windows-latest, Linux:ubuntu-22.04 |  |
| .github/workflows/release-dry-run.yml build checkout | 通过 | 存在 |  |
| .github/workflows/release-dry-run.yml build setup-node | 通过 | 存在 |  |
| .github/workflows/release-dry-run.yml build Rust stable | 通过 | 存在 |  |
| .github/workflows/release-dry-run.yml npm ci | 通过 | 存在 |  |
| .github/workflows/release-dry-run.yml 前端测试 | 通过 | 存在 |  |
| .github/workflows/release-dry-run.yml 前端构建 | 通过 | 存在 |  |
| .github/workflows/release-dry-run.yml AI 证据 | 通过 | 存在 |  |
| .github/workflows/release-dry-run.yml AI secret 透传 | 通过 | 存在 |  |
| .github/workflows/release-dry-run.yml Tauri 构建 | 通过 | 存在 |  |
| .github/workflows/release-dry-run.yml build artifacts 上传 | 通过 | 存在 |  |
| .github/workflows/release-dry-run.yml verify artifacts 下载 | 通过 | 存在 |  |
| .github/workflows/release-dry-run.yml verify workflow 结构验证 | 通过 | 存在 |  |
| .github/workflows/release-dry-run.yml 三平台下载验证 | 通过 | 存在 |  |
| .github/workflows/release-dry-run.yml evidence 聚合 | 通过 | 存在 |  |
| .github/workflows/release-dry-run.yml 最终审计 | 通过 | 存在 |  |
| .github/workflows/release-dry-run.yml artifact 路径覆盖 | 通过 | 包含 macOS / Windows / Linux / release 报告 |  |
| .github/workflows/release-dry-run.yml verify 报告上传 | 通过 | 包含 workflow validation 和 final audit |  |
| .github/workflows/release-dry-run.yml 手动触发 | 通过 | workflow_dispatch |  |
| .github/workflows/release-dry-run.yml PR 触发 | 通过 | pull_request |  |
| .github/workflows/release-dry-run.yml dry-run 产物检查 | 通过 | 存在 |  |
| .github/workflows/release-dry-run.yml dry-run 安装冒烟 | 通过 | 存在 |  |
| .github/workflows/release-dry-run.yml dry-run 签名报告 | 通过 | 存在 |  |
| .github/workflows/release.yml YAML 解析 | 通过 | Ruby YAML 解析通过 |  |
| .github/workflows/release.yml workflow 名称 | 通过 | Release |  |
| .github/workflows/release.yml build job | 通过 | 存在 |  |
| .github/workflows/release.yml verify job | 通过 | 存在 |  |
| .github/workflows/release.yml verify needs build | 通过 | needs: build |  |
| .github/workflows/release.yml 三平台矩阵 | 通过 | macOS:macos-latest, Windows:windows-latest, Linux:ubuntu-22.04 |  |
| .github/workflows/release.yml build checkout | 通过 | 存在 |  |
| .github/workflows/release.yml build setup-node | 通过 | 存在 |  |
| .github/workflows/release.yml build Rust stable | 通过 | 存在 |  |
| .github/workflows/release.yml npm ci | 通过 | 存在 |  |
| .github/workflows/release.yml 前端测试 | 通过 | 存在 |  |
| .github/workflows/release.yml 前端构建 | 通过 | 存在 |  |
| .github/workflows/release.yml AI 证据 | 通过 | 存在 |  |
| .github/workflows/release.yml AI secret 透传 | 通过 | 存在 |  |
| .github/workflows/release.yml Tauri 构建 | 通过 | 存在 |  |
| .github/workflows/release.yml build artifacts 上传 | 通过 | 存在 |  |
| .github/workflows/release.yml verify artifacts 下载 | 通过 | 存在 |  |
| .github/workflows/release.yml verify workflow 结构验证 | 通过 | 存在 |  |
| .github/workflows/release.yml 三平台下载验证 | 通过 | 存在 |  |
| .github/workflows/release.yml evidence 聚合 | 通过 | 存在 |  |
| .github/workflows/release.yml 最终审计 | 通过 | 存在 |  |
| .github/workflows/release.yml artifact 路径覆盖 | 通过 | 包含 macOS / Windows / Linux / release 报告 |  |
| .github/workflows/release.yml verify 报告上传 | 通过 | 包含 workflow validation 和 final audit |  |
| .github/workflows/release.yml tag 触发 | 通过 | v* |  |
| .github/workflows/release.yml updater config | 通过 | 存在 |  |
| .github/workflows/release.yml updater config 构建参数 | 通过 | 存在 |  |
| .github/workflows/release.yml updater 签名要求 | 通过 | 存在 |  |
| .github/workflows/release.yml 签名公证严格验证 | 通过 | 存在 |  |
| .github/workflows/release.yml metadata 严格生成 | 通过 | 存在 |  |
| .github/workflows/release.yml 分发严格验证 | 通过 | 存在 |  |
| .github/workflows/release.yml Draft Release 上传 | 通过 | 存在 |  |
| .github/workflows/release.yml Draft Release workflow 验证报告上传 | 通过 | 存在 |  |

> 本验证会解析 GitHub Actions YAML，并检查三平台矩阵、build / verify job、artifact 上传下载、AI 证据、聚合验证和正式 Release 严格签名分发门禁。
<!-- AUTO_WORKFLOW_VALIDATION_END -->

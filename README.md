# MoKnow

MoKnow 是一个 Markdown 桌面记事本壳应用原型，使用 Tauri + React + TypeScript + Ant Design 构建。当前版本已实现暗色工作台 UI、仓库文件树、三种编辑模式、Markdown 预览、AI Cockpit、状态栏、mock 示例仓库和真实本地仓库读写底座。

## 当前状态

已完成：

- npm + Vite + React + TypeScript 工程。
- Ant Design `ConfigProvider` 与官方 Theme Token。
- `markdown-it` Markdown 渲染，支持按需加载 KaTeX 公式、Mermaid 图表、Emoji 短码、脚注和 highlight.js 20+ 常见语言代码高亮。
- Tauri v2 配置、真实仓库命令与 mock 示例命令。
- 真实本地仓库创建、打开、最近仓库恢复、文件树扫描、Markdown 读取和保存。
- 新建日记、文档目录、文档文件的基础能力。
- 真实仓库启动自动打开 / 创建今天日记、日记设置面板、默认日记模板、日期变量替换、月历视图、已写日期标记、日期点击打开/创建、工作区文件、编辑模式和光标位置恢复底座。
- SQLite 元数据表、最近打开、最近编辑、置顶、收藏/回收站/重命名后端命令。
- 侧边栏最近文件、最近编辑、清空最近记录、收藏/取消收藏、置顶/取消置顶入口。
- 自动保存、保存失败提示、异常退出草稿恢复、保存前外部修改检测、冲突处理弹窗和保存状态栏提示。
- 错误处理建议：权限不足、目录不存在、磁盘空间不足、附件保存失败会给出中文处理建议；失败后可复制诊断信息，并可查看、筛选、搜索、导出和清空最近错误日志，日志中会按操作提供重试保存、重新备份、重新恢复、重新导出和打开仓库位置等恢复动作。
- 应用锁：可设置本地解锁密码，密码哈希优先写入系统 Keychain / Credential Manager，启动时解锁，最小化/离开窗口或空闲一段时间后自动锁定，锁定后隐藏正文工作区；支持 WebAuthn 平台认证器的生物识别 / 设备解锁，并提供一次性恢复码重置密码；旧版本地哈希配置仍可兼容解锁。
- 系统安全凭据底座：Tauri 桌面环境通过系统 Keychain / Credential Manager 保存、读取、删除和查询敏感凭据；浏览器预览使用 mock secure store。
- 通用设置面板：支持外观设置、主题持久化、跟随系统、自定义主色 / 圆角 / 字号 / 紧凑模式、自定义 CSS 文件导入、设置 JSON 导入导出、插件主题、仓库级主题 / CSS 覆盖和文件级主题 / CSS 覆盖，并保留日记设置和应用锁入口。
- 仓库备份与恢复：真实仓库可备份为 zip 文件，备份前会拦截未保存内容；备份弹窗支持自选输出位置、疑似隐私/凭据文件过滤和进度提示；恢复弹窗支持选择指定备份 zip、恢复前差异预览、覆盖恢复和合并保留当前文件两种策略。
- 单篇 HTML / PDF 导出：可从标题栏或命令面板把当前 Markdown 导出为同目录 HTML 或 PDF 文件；HTML 保留标题、代码块、表格、图片相对路径和已渲染内容，PDF 使用内置轻量生成器输出当前文档文本快照。
- 日记合集 HTML 导出：可从标题栏或命令面板按本月或日期范围导出日记合集，并选择输出位置；导出内容包含目录、日期、来源路径和渲染后的 Markdown 正文，支持导出预览、目录开关、分页选项、打印友好样式和分阶段进度提示。
- Markdown 快捷输入、快捷插入日期/链接、任务列表点击勾选、当前文件查找替换、大纲导航和双视图同步滚动。
- 专注写作模式：可从标题栏进入/退出，隐藏文件树和 AI 面板并居中编辑区，支持打字机模式和全屏写作。
- Markdown frontmatter 解析、稳定写回和保留未知字段的元数据工具。
- 右侧日记元数据面板：可编辑日期、情绪、天气、精力、地点、标签和收藏状态，并写回 Markdown frontmatter。
- 当前文档标签管理：可在元数据面板中新增、改名、删除、设置颜色并查看当前标签。
- 保存 Markdown 时会将 frontmatter 元数据同步到 SQLite `file_metadata`。
- 全库检索面板：支持关键词搜索、日期范围、标签筛选、文件类型筛选、搜索历史、结果片段高亮和按标签查看日记/笔记。
- 全局标签维护：SQLite `tags` / `file_tags` 表、全局标签颜色、跨文档标签改名和跨文档删除。
- 搜索索引与命令面板：SQLite FTS5 `file_fts` 全文索引、保存时增量更新、快速打开文件和命令搜索。
- 收件箱与整理视图：快速记录写入 `Inbox/inbox.md`，可勾选整理到今天日记、清空收件箱，并查看未整理内容、无标签日记、最近修改和收藏日记。
- 双链笔记：支持 `[[标题]]` 渲染、点击跳转、已有笔记自动补全和当前文件反向链接列表。
- 图片粘贴、图片拖拽、附件目录保存和 Markdown 图片链接自动插入。
- mock 仓库树、CodeMirror 源码 / 双视图和 TipTap 所见即所得三种编辑模式，支持 HTML 回写 Markdown。
- AI Cockpit 支持本地规则问答、OpenAI-compatible Provider 配置、本地轻量向量索引、外部 Embedding、持久化向量库、索引构建进度、语义检索、来源引用和快捷操作；本地日记助手支持今日总结、温柔追问、周回顾、月回顾、上下文范围选择和 AI 输出插入正文。
- 插件系统基础层：已定义插件 manifest、权限、注册表和受限 `PluginContext`，支持从插件管理器安装 manifest、启用/停用/移除插件，并在插件启动异常时隔离为失败状态；启用插件声明的命令、侧边栏、主题、Markdown 渲染和 AI 工具贡献会接入主应用运行时；插件管理器已提供官方插件目录，可一键安装日历视图、字数统计、导出 PDF 和 Git 同步 4 个内置官方插件；第三方 `entry` 插件会在 Worker 沙箱中执行，按 manifest 权限注册贡献点，越权、异常或超时会被标记为 failed。
- 中文 Makefile 帮助和一键启动入口。
- 发布底座：新增 `CHANGELOG.md`、tag 触发的 GitHub Actions Release 工作流、手动触发的三平台 Release dry-run workflow、本地发布检查脚本、Release workflow 结构验证脚本、远端 dry-run 自动触发/下载脚本、远端 CI 预检脚本、远端 workflow/run/artifacts 状态快照脚本、GitHub Actions secrets 审计脚本、GitHub Actions secrets 同步脚本、外部发布配置 readiness 报告、外部闭环交接清单脚本、项目进度外部闭环总门禁、发布文件入库门禁、发布提交前准备总入口、发布提交安全检查脚本、发布提交入库计划脚本、发布提交预演脚本、发布推送准备检查脚本、三平台 artifacts 证据聚合脚本、项目进度最终审计脚本、发布产物检查脚本、下载 artifacts 完整性验证脚本、安装冒烟验证脚本、人工安装验收记录脚本、签名与公证验证脚本、Tauri updater 临时配置生成脚本、分发元数据生成脚本、分发端点验证脚本、AI Provider 端到端联调脚本、AI 真实 Provider 自动探测脚本、AI 外部联调预检脚本、本地 OpenAI-compatible AI 联调自测脚本和 Tauri 桌面自动更新检查入口；可构建 macOS / Windows / Linux Tauri 安装包并创建草稿 Release，CI 会在配置 `AI_E2E_*` secrets 时自动生成真实 AI 联调证据，并上传三平台 artifacts、安装冒烟报告、签名验证报告、聚合验证报告、分发验证报告、`latest.json`、下载清单和 Homebrew cask，`ai:e2e:auto` / `ai:e2e:preflight` / `ai:e2e:mock` / `release:check` / `release:workflow-validate` / `release:ci-preflight` / `release:remote-status` / `release:tracking` / `release:submit-prep` / `release:submission-safety` / `release:submission-plan` / `release:submission-preview` / `release:push-readiness` / `release:secrets` / `release:secrets:sync` / `release:handoff` / `release:closure` / `release:aggregate-evidence` / `release:final-audit` / `release:dry-run` / `release:readiness` / `release:verify` / `release:updater-config` / `release:artifacts` / `release:downloads` / `release:install-smoke` / `release:install-manual` / `release:signing` / `release:metadata` / `release:distribution` 可在打 tag 前校验 AI 真实 Provider 自动探测、AI 联调前置条件、AI 联调脚本链路、版本、CHANGELOG、workflow 结构、发布闭环文件入库状态、提交前密钥/生成产物扫描、安全 pathspec 提交计划、临时 index 提交预演、远端推送准备状态、远端 dry-run 前置条件、远端 workflow/run/artifacts/Release 状态、GitHub secrets 名称、GitHub secrets 同步预览、外部闭环环境模板、项目进度外部闭环总门禁、三平台 artifacts 证据、项目进度未完成项证据、测试、前端构建、本机产物、下载产物、安装包入口、人工安装打开读写验收、签名公证状态、外部配置、updater 配置、分发 URL 和分发元数据。
- 视觉样式按 `项目文档\原型文件\原型-ui.html` 复刻，并将品牌改为 MoKnow。

未闭环：

- 应用签名公证、真实 updater 签名 / 端点和自动更新实发尚未完成；应用内“检查应用更新”入口已接入 Tauri updater，浏览器预览会提示当前环境不支持。
- 真实外部 AI Provider、远端三平台 CI、签名公证、updater 签名和分发渠道仍需配置外部 API Key、证书、GitHub Secrets 或下载地址后实跑验证。
- 回收站恢复已可用，但目前默认使用自动改名策略，没有恢复冲突策略选择 UI。

## 如何启动

### 1. 安装依赖

```bash
npm install
```

也可以通过 Makefile 一键安装依赖并启动：

```bash
make start
```

### 2. 启动前端预览

```bash
npm run dev
```

默认访问：

```text
http://127.0.0.1:1420
```

### 3. 运行测试

```bash
npm run test
```

当前验证结果：16 个测试文件、148 个测试用例通过。

### 4. 构建前端

```bash
npm run build
```

当前构建可以通过，且不再出现 Vite 单个 JS chunk 超过 500 kB 的体积警告。当前最大应用 JS chunk 约 300.08 kB，应用主入口约 218.21 kB；Mermaid 图表运行时会在构建前复制到 `dist/vendor/mermaid`，仅在文档包含 Mermaid 图表时按需加载。

## 如何启动桌面应用

桌面应用依赖 Tauri。macOS / Linux 推荐通过 rustup stable 工具链构建；Windows 还需要 Microsoft C++ Build Tools。

### 1. 安装 Rust/Cargo

Windows 推荐使用 rustup：

```text
https://rustup.rs/
```

安装后重新打开终端，确认命令可用：

```bash
rustc --version
cargo --version
```

### 2. 安装 Microsoft C++ Build Tools

如果执行 `npm run tauri:build` 时出现 `link.exe not found`，说明缺少 MSVC 链接器。

安装方式：

1. 打开 Microsoft Visual Studio 下载页：

```text
https://visualstudio.microsoft.com/downloads/
```

2. 下载并运行 `Build Tools for Visual Studio`。
3. 在 Visual Studio Installer 中选择工作负载：

```text
Desktop development with C++
```

4. 确认包含以下组件：

```text
MSVC C++ build tools
Windows SDK
```

5. 安装完成后，重新打开 PowerShell。
6. 回到项目目录继续执行 Tauri 命令。

### 3. 启动 Tauri 桌面窗口

跨平台推荐先使用 Makefile：

```bash
make desktop
```

Windows 也可以使用项目内置脚本，它会自动查找 Visual Studio C++ Build Tools 并加载 MSVC 环境：

```bash
npm run desktop:dev
```

也可以在已经加载 C++ Build Tools 的开发者命令行中运行：

```bash
npm run tauri:dev
```

### 4. 构建桌面应用

跨平台推荐先使用 Makefile：

```bash
make desktop-build
make ai-e2e-auto
make ai-e2e-preflight
make ai-e2e-mock
make release-check
make release-updater-config
make release-artifacts
make release-downloads
make release-install-smoke
make release-install-manual
make release-signing
make release-aggregate-evidence
make release-workflow-validate
make release-ci-preflight
make release-remote-status
make release-metadata
make release-distribution
make release-secrets
make release-secrets-sync
make release-readiness
make release-handoff
make release-closure
make release-final-audit
make release-tracking
make release-submission-plan
make release-dry-run
make release-verify
make release-local
```

推荐使用：

```bash
npm run desktop:build
```

或在已经加载 C++ Build Tools 的开发者命令行中运行：

```bash
npm run tauri:build
```

## 未完成任务如何闭环

### 1. Tauri 桌面验证

当前状态：macOS aarch64 已完成 release 构建，产物位于：

```text
src-tauri/target/release/bundle/macos/MoKnow.app
src-tauri/target/release/bundle/dmg/MoKnow_0.1.0_aarch64.dmg
```

待闭环：

1. Windows 上仍需安装 Microsoft C++ Build Tools 后验证。
2. 实机打开桌面窗口，确认真实仓库创建、打开、读写流程可用。
3. GitHub Actions Release 工作流、手动 dry-run workflow、artifact 上传、`CHANGELOG.md`、发布产物检查脚本、安装冒烟验证脚本、签名验证脚本、CI 预检脚本和 updater 临时配置生成脚本已补充；当前 `release:dry-run` 默认先执行严格 CI 预检，`release:ci-preflight` 已确认远端仓库还没有 workflow，需要提交推送后再触发 dry-run 或推送 tag，随后确认三平台 CI 实跑、下载 artifacts / Draft Release 产物并完成实机打开验证。

### 2. 真实本地仓库读写

当前状态：真实仓库读写底座已实现并通过 Rust 单元测试；浏览器预览仍使用 mock gateway，Tauri 桌面环境使用真实命令。

待闭环：

1. 为真实仓库创建、打开、保存失败、权限不足等流程补充更多集成测试。
2. 为权限不足、磁盘空间不足等保存失败场景补充更细化的处理建议。

### 3. AI Cockpit 真实能力

当前状态：`AiCockpitService` 支持本地规则模式和 OpenAI-compatible Provider。AI 面板可套用 OpenAI、DeepSeek、OpenRouter、Ollama 本地预设，也可自定义 endpoint、模型、流式响应和是否需要 API Key；API Key 通过系统 Keychain / Credential Manager 或浏览器 mock secure store 保存。普通提问可调用真实 provider，超长上下文会自动截断，429/5xx 或网络失败会重试，最终失败或未配置时回退本地规则；选择最近 7 天、本月或全仓库上下文时，会构建本地轻量向量索引，或按设置调用 OpenAI-compatible / Ollama Embedding 接口生成外部向量；向量索引可持久化到本地缓存，重复查询会复用相同文档集和 Embedding 设置下的索引；AI 面板会展示索引构建阶段、百分比和失败回退提示，并生成可点击来源引用。日记助手仍具备本地规则生成能力，可按当前文件、最近 7 天、本月日记或全仓库上下文生成今日总结、温柔追问、周/月回顾，并可插入当前正文。

闭环方式：

1. 配置 `AI_E2E_ENDPOINT`、`AI_E2E_MODEL`、`AI_E2E_API_KEY` 后执行 `npm run ai:e2e:preflight -- --strict --write-doc` 和 `npm run ai:e2e`，生成 `项目文档/AI外部模型联调记录.md`。
2. 为来源跳转、大仓库向量索引性能、外部 Embedding 失败回退和持久化缓存清理策略补充更多实机验证。

### 4. 插件系统

当前状态：插件 manifest 类型、权限白名单、注册表持久化、受限 `PluginContext`、插件管理器和插件启动异常隔离已实现；启用插件的 manifest 命令贡献会注册到命令面板，侧边栏贡献会注册到右侧插件面板占位区；主题贡献可接入设置和主题解析；Markdown 渲染贡献可通过宿主白名单扩展渲染 callout / mark；AI 工具贡献会在 AI 面板生成可点击工具按钮并读取当前上下文执行；官方插件目录已提供日历视图、字数统计、导出 PDF 和 Git 同步 4 个内置插件的一键安装入口；第三方 `entry` 插件会在 Worker 沙箱中执行，默认隔离 DOM、localStorage、sessionStorage 和外部脚本加载，无 `network` 权限时禁用网络入口，沙箱返回的贡献点会再次按 manifest 权限校验。

后续加固：

1. 支持 `.moknow-plugin` / `.marknote-plugin` 包格式、签名校验和插件市场元数据。
2. 为插件权限授权、撤销和异常恢复补充更多集成测试。

### 5. 体积优化

当前状态：`npm run build` 不再出现 Vite chunk 体积警告，应用主入口约 218.21 kB；编辑器工作区已动态导入，CodeMirror 依赖也已改为源码 / 双视图模式下再加载，`EditorWorkspace` chunk 从 807.54 kB 降到约 204.24 kB，CodeMirror 相关依赖拆为约 208.22 kB / 197.32 kB 等按需 chunk；文件树已按目录展开状态懒渲染；`RepositoryService` 已为搜索结果和标签列表增加仓库级缓存，并在保存、另存、标签维护、创建/删除/恢复/重命名等索引变更路径后失效；KaTeX 公式运行时已改为动态加载 min runtime，当前约 259.24 kB 按需 chunk；Mermaid 图表运行时已从 Vite 应用 chunk 图谱中移出，构建前复制到 `public/vendor/mermaid`，构建产物中为 `dist/vendor/mermaid` 下 82 个 `.mjs` 文件、约 3.7M，仅在文档包含 Mermaid 图表时按需加载。

闭环方式：

1. 继续监控真实仓库下首屏加载和 Mermaid 图表首次渲染耗时。

### 6. 日记产品主线

当前状态：真实仓库启动后可自动打开或创建今天日记，日记设置面板、默认模板、日期变量替换、上次文件编辑模式、光标位置恢复、月历视图、已写日期标记、日期点击打开/创建、收件箱快速记录、整理到今天日记和整理视图已接入。

闭环方式：

1. 增加日记首页、写作连续性统计和更完整的回顾入口。

## 常用命令

```bash
npm install
npm run dev
npm run test
npm run build
npm run desktop:dev
npm run desktop:build
npm run tauri:dev
npm run tauri:build
make
make start
make desktop
make desktop-build
```

## 项目进度记录

开发过程中的状态、阻塞、验证结果记录在：

```text
项目文档\项目进度.md
```

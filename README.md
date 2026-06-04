# MoKnow

MoKnow 是一个 Markdown 桌面记事本壳应用原型，使用 Tauri + React + TypeScript + Ant Design 构建。当前版本已实现暗色工作台 UI、仓库文件树、三种编辑模式、Markdown 预览、AI Cockpit、状态栏和 mock 数据服务。

## 当前状态

已完成：

- npm + Vite + React + TypeScript 工程。
- Ant Design `ConfigProvider` 与官方 Theme Token。
- `markdown-it` Markdown 渲染。
- Tauri v2 配置与 mock 命令。
- mock 仓库树、源码 / 双视图 / 所见即所得三种编辑模式。
- AI Cockpit mock 问答、来源引用、快捷操作。
- 视觉样式按 `项目文档\原型文件\原型-ui.html` 复刻，并将品牌改为 MoKnow。

未闭环：

- 当前机器已安装 Rust/Cargo，但缺少 Windows MSVC 链接器 `link.exe`，因此还不能完成 Tauri 桌面构建。
- 目前文件读写、AI、插件系统都是 mock 实现；真实本地仓库读写、真实 AI API、插件运行时需要后续开发。

## 如何启动

### 1. 安装依赖

```bash
npm install
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

当前验证结果：7 个测试文件、9 个测试用例通过。

### 4. 构建前端

```bash
npm run build
```

当前构建可以通过。Vite 会提示单个 chunk 超过 500 kB，这是体积警告，不影响构建产物生成。

## 如何启动桌面应用

桌面应用依赖 Tauri，因此 Windows 上需要 Rust 工具链和 Microsoft C++ Build Tools。

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

推荐使用项目内置脚本，它会自动查找 Visual Studio C++ Build Tools 并加载 MSVC 环境：

```bash
npm run desktop:dev
```

也可以在已经加载 C++ Build Tools 的开发者命令行中运行：

```bash
npm run tauri:dev
```

### 4. 构建桌面应用

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

阻塞原因：当前环境已能识别 Rust/Cargo，但缺少 MSVC 链接器 `link.exe`。

闭环方式：

1. 安装 Microsoft C++ Build Tools。
2. 在安装器中选择 `Desktop development with C++`。
3. 重新打开 PowerShell。
4. 执行 `npm run desktop:build`。
5. 执行 `npm run desktop:dev`。
6. 确认桌面窗口能打开，并显示与 Web 预览一致的 MoKnow 工作台。
7. 将验证结果记录到 `项目文档\项目进度.md`。

### 2. 真实本地仓库读写

当前状态：前端通过 `RepositoryService` 调用 mock gateway，Tauri 命令也返回 mock 数据。

闭环方式：

1. 在 Tauri 命令中接入目录选择、文件树扫描、Markdown 文件读取和保存。
2. 保持统一返回结构 `CommandResult<T>`。
3. 前端继续通过 `RepositoryService` 调用，不让组件直接操作文件系统。
4. 增加文件读取失败、保存失败、文件不存在等测试。

### 3. AI Cockpit 真实能力

当前状态：`AiCockpitService` 返回 mock 回答。

闭环方式：

1. 增加仓库索引服务。
2. 根据问题检索当前文件或仓库片段。
3. 接入真实 AI API。
4. 回答中保留来源引用。
5. 增加“索引未完成”“请求失败”“上下文过长”的测试。

### 4. 插件系统

当前状态：只在设计文档中定义了插件能力，代码中尚未实现插件运行时。

闭环方式：

1. 定义插件 manifest 类型。
2. 增加插件加载服务。
3. 支持命令、侧边栏面板、Markdown 渲染、AI 工具扩展点。
4. 插件必须声明权限。
5. 插件异常不能影响主应用运行。

### 5. 体积优化

当前状态：`npm run build` 有 Vite chunk 体积警告。

闭环方式：

1. 对 Ant Design、编辑器相关模块做按需拆分。
2. 使用动态导入拆分 AI Cockpit 或 WYSIWYG 编辑器。
3. 重新执行 `npm run build`，确认警告是否消失或体积可接受。

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
```

## 项目进度记录

开发过程中的状态、阻塞、验证结果记录在：

```text
项目文档\项目进度.md
```

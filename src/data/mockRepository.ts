import type { MarkdownFile, Repository } from "../types/models";

export const mockFiles: Record<string, MarkdownFile> = {
  source: {
    id: "source",
    name: "2024-06-04-日记.md",
    path: "2024 › 06月",
    raw: `---
date: 2024-06-04
tags: [日记, 工作, 生活]
---

# 2024年6月4日 晴

## 今天的工作

上午在做 **MoKnow** 项目的前端设计，用 \`CodeMirror 6\` 集成 Markdown 语法高亮，效果不错。下午和团队开了一个需求评审会，讨论了 [AI Cockpit](#) 的产品方案。

## 碎碎念

> 每天写日记真的是一个很好的习惯，能帮助自己整理思路。

晚上去楼下的小店吃了碗面，回来看了半小时书，感觉挺惬意的。

## 明天的计划

- [ ] 完成编辑器双视图模式开发
- [ ] 写单元测试
- [ ] 整理本周工作总结

---

*今日心情：★★★★☆*`,
  },
  note: {
    id: "note",
    name: "2024-06-03-随笔.md",
    path: "2024 › 06月",
    raw: `# 随笔

今天没有特别的事情，就随手记一些想法。

关于 **写作** 这件事，我觉得重要的不是写得多好，而是坚持把想法记下来。哪怕只是几句话，积累下来也很有价值。

## 一个有趣的发现

用 Markdown 写作真的比用富文本编辑器更让人专注，没有格式干扰，只需要关注内容本身。

\`\`\`
专注 > 格式
内容 > 样式
\`\`\``,
  },
  plan: {
    id: "plan",
    name: "项目规划.md",
    path: "项目",
    raw: `# MoKnow 项目规划

## Phase 1 — 基础框架

- [x] 项目脚手架搭建
- [x] 文件树组件
- [ ] 代码模式编辑器

## Phase 2 — 编辑器完善

- [ ] 双视图模式
- [ ] WYSIWYG 模式

## Phase 3 — AI 功能

- [ ] AI Cockpit 基础版
- [ ] 流式输出

> 预计总周期：8周`,
  },
  readme: {
    id: "readme",
    name: "README.md",
    path: "项目",
    raw: `# MoKnow

> 一款基于桌面端的 Markdown 日记 / 记事本应用

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React + TypeScript + Ant Design |
| 渲染 | markdown-it |
| 编辑器 | CodeMirror 6 |
| 桌面 | Tauri |

## 快速开始

\`\`\`bash
npm install
npm run dev
\`\`\`

## 许可证

MIT`,
  },
};

export const mockRepository: Repository = {
  id: "daily",
  name: "MoKnow 日记仓库",
  rootPath: "E:\\diary\\MoKnow Notes",
  files: [
    {
      id: "2024",
      name: "2024",
      path: "2024",
      type: "directory",
      depth: 0,
      children: [
        {
          id: "2024-06",
          name: "06月",
          path: "2024/06月",
          type: "directory",
          depth: 1,
          children: [
            { id: "source", name: "2024-06-04-日记.md", path: "2024/06月/2024-06-04-日记.md", type: "markdown", depth: 2, contentKey: "source" },
            { id: "note", name: "2024-06-03-随笔.md", path: "2024/06月/2024-06-03-随笔.md", type: "markdown", depth: 2, contentKey: "note" },
            { id: "idea", name: "AI Cockpit 想法.md", path: "2024/06月/AI Cockpit 想法.md", type: "markdown", depth: 2, contentKey: "note" },
          ],
        },
        {
          id: "2024-05",
          name: "05月",
          path: "2024/05月",
          type: "directory",
          depth: 1,
          children: [
            { id: "travel", name: "05-15-旅行记录.md", path: "2024/05月/05-15-旅行记录.md", type: "markdown", depth: 2, contentKey: "note" },
            { id: "review", name: "05-31-月末复盘.md", path: "2024/05月/05-31-月末复盘.md", type: "markdown", depth: 2, contentKey: "note" },
          ],
        },
      ],
    },
    {
      id: "project",
      name: "项目",
      path: "项目",
      type: "directory",
      depth: 0,
      children: [
        { id: "plan", name: "项目规划.md", path: "项目/项目规划.md", type: "markdown", depth: 1, contentKey: "plan" },
        { id: "readme", name: "README.md", path: "项目/README.md", type: "markdown", depth: 1, contentKey: "readme" },
      ],
    },
    {
      id: "inbox",
      name: "收件箱",
      path: "收件箱",
      type: "directory",
      depth: 0,
      children: [],
    },
  ],
};

import { describe, expect, it } from "vitest";
import { MarkdownService } from "./markdownService";

describe("MarkdownService", () => {
  it("renders common diary markdown with markdown-it", () => {
    const service = new MarkdownService();

    const html = service.render("# 今日\n\n> 记录一下\n\n- [ ] 写测试\n\n`code`");

    expect(html).toContain("<h1>今日</h1>");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("写测试");
    expect(html).toContain("<code>code</code>");
  });

  it("keeps untrusted html escaped by default", () => {
    const service = new MarkdownService();

    const html = service.render("<script>alert(1)</script>");

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("keeps formula placeholders in synchronous rendering", () => {
    const service = new MarkdownService();

    const html = service.render("行内 $E=mc^2$\n\n$$\n\\sum_{i=1}^{n}x_i\n$$");

    expect(html).toContain("data-math-content=");
    expect(html).toContain("math-block");
    expect(html).toContain("E=mc^2");
  });

  it("loads KaTeX only for async math rendering", async () => {
    const service = new MarkdownService();

    const plainHtml = await service.renderAsync("# 没有公式\n\n普通文本");
    const mathHtml = await service.renderAsync("行内 $E=mc^2$\n\n$$\n\\sum_{i=1}^{n}x_i\n$$");

    expect(plainHtml).not.toContain("data-math-content=");
    expect(mathHtml).toContain("katex");
    expect(mathHtml).toContain("math-block");
    expect(mathHtml).toContain("mord mathnormal");
  });

  it("renders Mermaid containers, emoji shortcodes and footnotes", () => {
    const service = new MarkdownService();

    const html = service.render("图表 :smile:[^1]\n\n```mermaid\ngraph TD; A-->B;\n```\n\n[^1]: 脚注内容");

    expect(html).toContain("😄");
    expect(html).toContain('class="mermaid"');
    expect(html).toContain("graph TD; A--&gt;B;");
    expect(html).toContain("footnotes");
    expect(html).toContain("脚注内容");
  });

  it("highlights code blocks with more than twenty common languages", () => {
    const service = new MarkdownService();

    const html = service.render("```ts\nconst value = 1;\n```");

    expect(service.supportedHighlightLanguages().length).toBeGreaterThanOrEqual(20);
    expect(html).toContain("hljs");
    expect(html).toContain("language-ts");
    expect(html).toContain("hljs-keyword");
  });

  it("renders a standalone HTML export document", () => {
    const service = new MarkdownService();

    const html = service.renderStandaloneHtml("# 导出标题\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n![图](assets/note/a.png)", "笔记.md");

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<title>笔记.md</title>");
    expect(html).toContain("<h1>导出标题</h1>");
    expect(html).toContain("<table>");
    expect(html).toContain('<img src="assets/note/a.png"');
    expect(html).toContain("moknow-export");
  });

  it("renders KaTeX in async standalone exports", async () => {
    const service = new MarkdownService();

    const html = await service.renderStandaloneHtmlAsync("# 公式\n\n$E=mc^2$", "公式.md");

    expect(html).toContain("<title>公式.md</title>");
    expect(html).toContain("katex");
    expect(html).not.toContain("data-math-content=");
  });

  it("renders a collection HTML export with table of contents and entries", () => {
    const service = new MarkdownService();

    const html = service.renderCollectionHtml([
      {
        title: "2024-06-03.md",
        path: "日记/2024/06/2024-06-03.md",
        date: "2024-06-03",
        content: "# 第一天\n\n今天不错",
      },
      {
        title: "2024-06-04.md",
        path: "日记/2024/06/2024-06-04.md",
        date: "2024-06-04",
        content: "# 第二天\n\n- [x] 写日记",
      },
    ], "六月合集", "包含 2 篇日记");

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<title>六月合集</title>");
    expect(html).toContain("导出目录");
    expect(html).toContain("2024-06-03 2024-06-03.md");
    expect(html).toContain("日记/2024/06/2024-06-04.md");
    expect(html).toContain("<h1>第二天</h1>");
    expect(html).toContain("task-list-item");
  });

  it("applies collection export format options", () => {
    const service = new MarkdownService();

    const html = service.renderCollectionHtml([
      {
        title: "2024-06-03.md",
        path: "日记/2024/06/2024-06-03.md",
        content: "# 第一天",
      },
      {
        title: "2024-06-04.md",
        path: "日记/2024/06/2024-06-04.md",
        content: "# 第二天",
      },
    ], "打印合集", "包含 2 篇日记", {
      includeTableOfContents: false,
      pageBreakBetweenEntries: true,
      printFriendly: true,
    });

    expect(html).not.toContain("导出目录");
    expect(html).toContain('class="export-entry page-break"');
    expect(html).toContain("@media print");
  });

  it("renders wiki links as clickable internal note links", () => {
    const service = new MarkdownService();

    const html = service.render("今天关联 [[项目规划]] 和 [[2024-06-03-随笔|昨天随笔]]。");

    expect(html).toContain('class="wiki-link"');
    expect(html).toContain('data-wiki-link="项目规划"');
    expect(html).toContain('href="#wiki:%E9%A1%B9%E7%9B%AE%E8%A7%84%E5%88%92"');
    expect(html).toContain("昨天随笔");
  });

  it("applies enabled plugin markdown runtime extensions", () => {
    const service = new MarkdownService([
      { id: "callout", pluginId: "moknow.callout", pluginName: "Callout 插件" },
      { id: "mark", pluginId: "moknow.mark", pluginName: "高亮插件" },
    ]);

    const html = service.render(":::note 提醒\n插件渲染内容\n:::\n\n这里有 ==高亮==。");

    expect(html).toContain('data-plugin-markdown="callout"');
    expect(html).toContain("plugin-callout-note");
    expect(html).toContain("插件渲染内容");
    expect(html).toContain('data-plugin-markdown="mark"');
    expect(html).toContain("高亮");
  });
});

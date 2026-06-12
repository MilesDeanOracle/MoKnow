import { describe, expect, it } from "vitest";
import { htmlToMarkdown } from "./htmlMarkdownConversionService";

describe("htmlMarkdownConversionService", () => {
  it("converts editor HTML back to Markdown with headings and emphasis", () => {
    expect(htmlToMarkdown("<h1>今日</h1><p>完成 <strong>编辑器</strong> 接入。</p>")).toBe("# 今日\n\n完成 **编辑器** 接入。");
  });

  it("keeps task list state and wiki links when converting from HTML", () => {
    const markdown = htmlToMarkdown(`
      <ul>
        <li><input type="checkbox" checked> 写测试</li>
        <li><input type="checkbox"> 补文档</li>
      </ul>
      <p>参考 <a data-wiki-link="项目规划">项目规划</a></p>
    `);

    expect(markdown).toContain("- [x] 写测试");
    expect(markdown).toContain("- [ ] 补文档");
    expect(markdown).toContain("参考 [[项目规划]]");
  });

  it("keeps GitHub flavored Markdown tables", () => {
    expect(htmlToMarkdown("<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>")).toContain("| A | B |");
  });
});

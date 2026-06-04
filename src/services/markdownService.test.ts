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
});

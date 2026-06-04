import MarkdownIt from "markdown-it";

/**
 * 设计模式：策略模式。
 * 原因：Markdown 渲染是可替换策略，当前使用 markdown-it，
 * 未来可按插件系统注入 Mermaid、数学公式或自定义块语法。
 */
export class MarkdownService {
  private readonly markdown: MarkdownIt;

  constructor() {
    this.markdown = new MarkdownIt({
      html: false,
      linkify: true,
      typographer: true,
    });
  }

  render(content: string): string {
    return this.markdown.render(content);
  }

  highlightSource(content: string): string {
    return content
      .split("\n")
      .map((line) => this.highlightLine(line))
      .join("\n");
  }

  private highlightLine(line: string): string {
    const escaped = line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    if (escaped.startsWith("---") || /^date:|^tags:/.test(escaped.trim())) return `<span class="md-yaml">${escaped}</span>`;
    if (escaped.startsWith("# ")) return `<span class="md-h1">${escaped}</span>`;
    if (escaped.startsWith("## ")) return `<span class="md-h2">${escaped}</span>`;
    if (escaped.startsWith("### ")) return `<span class="md-h3">${escaped}</span>`;
    if (escaped.startsWith("&gt; ")) return `<span class="md-quote">${escaped}</span>`;
    if (escaped.startsWith("```")) return `<span class="md-tag">${escaped}</span>`;
    if (escaped.startsWith("- ") || /^- \[[ x]\]/.test(escaped)) return `<span class="md-bullet">-</span>${escaped.slice(1)}`;

    return escaped
      .replace(/\*\*(.+?)\*\*/g, '<span class="md-bold">**$1**</span>')
      .replace(/\*(.+?)\*/g, '<span class="md-italic">*$1*</span>')
      .replace(/`(.+?)`/g, '<span class="md-code">`$1`</span>')
      .replace(/\[(.+?)\]\((.+?)\)/g, '<span class="md-link">[$1]($2)</span>');
  }
}

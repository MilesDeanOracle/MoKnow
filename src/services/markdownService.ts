import MarkdownIt from "markdown-it";
import hljs from "highlight.js/lib/common";
import markdownItFootnote from "markdown-it-footnote";

const emojiShortcodes: Record<string, string> = {
  smile: "😄",
  joy: "😂",
  heart: "❤️",
  thumbs_up: "👍",
  thumbsup: "👍",
  fire: "🔥",
  star: "⭐",
  check: "✅",
  x: "❌",
  warning: "⚠️",
  bulb: "💡",
  memo: "📝",
  calendar: "📅",
  rocket: "🚀",
  coffee: "☕",
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttribute(text: string): string {
  return escapeHtml(text).replace(/'/g, "&#39;");
}

export interface MarkdownExportOptions {
  includeTableOfContents?: boolean;
  pageBreakBetweenEntries?: boolean;
  printFriendly?: boolean;
}

export interface MarkdownExportEntry {
  title: string;
  path: string;
  content: string;
  date?: string;
}

export interface MarkdownRuntimeExtension {
  id: string;
  pluginId?: string;
  pluginName?: string;
}

function replaceEmojiShortcodes(text: string): string {
  return text.replace(/:([a-zA-Z0-9_+-]+):/g, (match, name: string) => emojiShortcodes[name] ?? match);
}

function normalizeRuntimeExtensionIds(extensions: MarkdownRuntimeExtension[] = []) {
  return new Set(extensions.map((extension) => extension.id));
}

function renderPluginCallout(type: string, title: string, body: string): string {
  const normalizedType = type || "note";
  const safeTitle = escapeHtml(title || normalizedType);
  const safeBody = escapeHtml(body.trim()).replace(/\n{2,}/g, "</p><p>").replace(/\n/g, "<br />");
  return `<aside class="plugin-callout plugin-callout-${escapeAttribute(normalizedType)}" data-plugin-markdown="callout"><strong>${safeTitle}</strong><p>${safeBody}</p></aside>`;
}

function prepareRuntimeMarkdownExtensions(content: string, extensions: MarkdownRuntimeExtension[] = []): { content: string; replacements: Map<string, string> } {
  const extensionIds = normalizeRuntimeExtensionIds(extensions);
  const replacements = new Map<string, string>();
  let replacementIndex = 0;
  const createPlaceholder = (html: string) => {
    const placeholder = `MOKNOW_PLUGIN_RENDER_${replacementIndex++}`;
    replacements.set(placeholder, html);
    return placeholder;
  };
  let nextContent = content;

  if (extensionIds.has("callout") || extensionIds.has("admonition")) {
    nextContent = nextContent.replace(/:::(\w+)(?:[ \t]+([^\n]+))?\n([\s\S]*?)\n:::/g, (_match, type: string, title: string | undefined, body: string) => {
      return createPlaceholder(renderPluginCallout(type, title ?? type, body));
    });
  }

  if (extensionIds.has("mark") || extensionIds.has("highlight")) {
    nextContent = nextContent.replace(/==([^=\n][\s\S]*?[^=\n])==/g, (_match, value: string) => createPlaceholder(`<mark data-plugin-markdown="mark">${escapeHtml(value)}</mark>`));
  }

  return { content: nextContent, replacements };
}

function applyRuntimeHtmlReplacements(html: string, replacements: Map<string, string>): string {
  let nextHtml = html;
  for (const [placeholder, replacement] of replacements) {
    nextHtml = nextHtml
      .replaceAll(`<p>${placeholder}</p>`, replacement)
      .replaceAll(placeholder, replacement);
  }
  return nextHtml;
}

function hasMathSyntax(content: string): boolean {
  return /(^|\s)\$[^$\n]+\$|\$\$[\s\S]+?\$\$/m.test(content);
}

function mathInlineRule(state: any, silent: boolean): boolean {
  const start = state.pos;
  if (state.src.charCodeAt(start) !== 0x24 || state.src.charCodeAt(start + 1) === 0x24) return false;

  let end = start + 1;
  while ((end = state.src.indexOf("$", end)) !== -1) {
    if (state.src.charCodeAt(end - 1) !== 0x5c) break;
    end += 1;
  }
  if (end === -1 || end === start + 1) return false;

  if (!silent) {
    const token = state.push("math_inline", "math", 0);
    token.markup = "$";
    token.content = state.src.slice(start + 1, end);
  }
  state.pos = end + 1;
  return true;
}

function wikiLinkInlineRule(state: any, silent: boolean): boolean {
  const start = state.pos;
  if (state.src.charCodeAt(start) !== 0x5b || state.src.charCodeAt(start + 1) !== 0x5b) return false;

  const end = state.src.indexOf("]]", start + 2);
  if (end === -1) return false;

  const rawTarget = state.src.slice(start + 2, end);
  if (!rawTarget.trim() || rawTarget.includes("\n")) return false;

  if (!silent) {
    const [titlePart, aliasPart] = rawTarget.split("|");
    const title = titlePart.trim();
    const label = (aliasPart ?? titlePart).trim();
    const open = state.push("wiki_link_open", "a", 1);
    open.attrs = [
      ["href", `#wiki:${encodeURIComponent(title)}`],
      ["class", "wiki-link"],
      ["data-wiki-link", title],
    ];
    const text = state.push("text", "", 0);
    text.content = label || title;
    state.push("wiki_link_close", "a", -1);
  }

  state.pos = end + 2;
  return true;
}

function mathBlockRule(state: any, startLine: number, endLine: number, silent: boolean): boolean {
  const start = state.bMarks[startLine] + state.tShift[startLine];
  const max = state.eMarks[startLine];
  const marker = state.src.slice(start, max).trim();
  if (!marker.startsWith("$$")) return false;

  let nextLine = startLine + 1;
  const body: string[] = [];
  let found = false;
  while (nextLine < endLine) {
    const lineStart = state.bMarks[nextLine] + state.tShift[nextLine];
    const lineEnd = state.eMarks[nextLine];
    const line = state.src.slice(lineStart, lineEnd);
    if (line.trim().endsWith("$$")) {
      body.push(line.replace(/\$\$\s*$/, ""));
      found = true;
      break;
    }
    body.push(line);
    nextLine += 1;
  }

  if (!found) return false;
  if (!silent) {
    const token = state.push("math_block", "math", 0);
    token.block = true;
    token.markup = "$$";
    token.content = body.join("\n").trim();
    token.map = [startLine, nextLine + 1];
  }
  state.line = nextLine + 1;
  return true;
}

function mathPlaceholder(content: string, displayMode: boolean): string {
  const tag = displayMode ? "p" : "span";
  const className = displayMode ? "math-block" : "math-inline";
  return `<${tag} class="${className}" data-math-content="${encodeURIComponent(content)}"><code>${escapeHtml(content)}</code></${tag}>`;
}

interface KatexRuntime {
  renderToString(content: string, options: {
    displayMode: boolean;
    output: "html";
    throwOnError: boolean;
    trust: boolean;
  }): string;
}

function renderKatex(katex: KatexRuntime, content: string, displayMode: boolean): string {
  try {
    return katex.renderToString(content, {
      displayMode,
      output: "html",
      throwOnError: false,
      trust: false,
    });
  } catch {
    return `<code class="math-error">${escapeHtml(content)}</code>`;
  }
}

async function renderMathPlaceholders(html: string): Promise<string> {
  if (!html.includes("data-math-content=")) return html;
  const [{ default: katex }] = await Promise.all([
    import("katex/dist/katex.min.js"),
    import("katex/dist/katex.min.css"),
  ]);
  return html.replace(
    /<(span|p) class="math-(inline|block)" data-math-content="([^"]+)">[\s\S]*?<\/\1>/g,
    (_match, tag: string, kind: string, encoded: string) => {
      const displayMode = kind === "block";
      const content = decodeURIComponent(encoded);
      const rendered = renderKatex(katex, content, displayMode);
      return tag === "p" ? `<p class="math-block">${rendered}</p>` : rendered;
    },
  );
}

/**
 * 设计模式：策略模式。
 * 原因：Markdown 渲染是可替换策略，当前使用 markdown-it，
 * 未来可按插件系统注入 Mermaid、数学公式或自定义块语法。
 */
export class MarkdownService {
  private readonly markdown: MarkdownIt;
  private readonly runtimeExtensions: MarkdownRuntimeExtension[];

  constructor(runtimeExtensions: MarkdownRuntimeExtension[] = []) {
    this.runtimeExtensions = runtimeExtensions;
    this.markdown = new MarkdownIt({
      html: false,
      linkify: true,
      typographer: true,
      highlight: (source, language) => {
        const lang = language && hljs.getLanguage(language) ? language : "";
        if (!lang) return `<pre class="hljs"><code>${escapeHtml(source)}</code></pre>`;
        const highlighted = hljs.highlight(source, { language: lang, ignoreIllegals: true }).value;
        return `<pre class="hljs"><code class="language-${lang}">${highlighted}</code></pre>`;
      },
    });
    this.configureAdvancedRendering();
  }

  render(content: string, taskLineIndexes: number[] = []): string {
    const runtimeMarkdown = prepareRuntimeMarkdownExtensions(content, this.runtimeExtensions);
    let taskIndex = 0;
    const rendered = this.markdown.render(runtimeMarkdown.content).replace(/<li>\[([ xX])\] ([\s\S]*?)<\/li>/g, (_match, checked: string, body: string) => {
      const lineIndex = taskLineIndexes[taskIndex] ?? taskIndex;
      taskIndex += 1;
      const isChecked = checked.toLowerCase() === "x";
      return `<li class="task-list-item"><input type="checkbox" data-task-line="${lineIndex}" ${isChecked ? "checked" : ""} /> ${body}</li>`;
    });
    return applyRuntimeHtmlReplacements(rendered, runtimeMarkdown.replacements);
  }

  async renderAsync(content: string, taskLineIndexes: number[] = []): Promise<string> {
    const html = this.render(content, taskLineIndexes);
    return hasMathSyntax(content) ? renderMathPlaceholders(html) : html;
  }

  renderStandaloneHtml(content: string, title: string, bodyHtml?: string): string {
    const body = bodyHtml ?? this.render(content);
    const safeTitle = escapeHtml(title || "MoKnow 导出");
    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle}</title>
  <style>
    :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #f6f7fb; color: #1f2937; line-height: 1.72; }
    main { max-width: 860px; margin: 0 auto; padding: 48px 28px 72px; background: #fff; min-height: 100vh; box-sizing: border-box; }
    h1, h2, h3, h4, h5, h6 { color: #111827; line-height: 1.28; margin: 1.6em 0 .7em; }
    h1 { font-size: 2rem; border-bottom: 1px solid #e5e7eb; padding-bottom: .35em; }
    p, ul, ol, blockquote, pre, table { margin: 1em 0; }
    a { color: #2563eb; }
    blockquote { border-left: 4px solid #9ca3af; color: #4b5563; padding-left: 1em; }
    code { font-family: "SFMono-Regular", Consolas, monospace; background: #f3f4f6; border-radius: 4px; padding: .15em .35em; }
    pre { overflow: auto; background: #111827; color: #e5e7eb; border-radius: 8px; padding: 16px; }
    pre code { background: transparent; padding: 0; color: inherit; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #d1d5db; padding: 8px 10px; vertical-align: top; }
    th { background: #f3f4f6; font-weight: 600; }
    img { max-width: 100%; height: auto; border-radius: 6px; }
    .task-list-item { list-style: none; margin-left: -1.4em; }
    .task-list-item input { margin-right: .5em; }
    .math-block { overflow-x: auto; }
    .mermaid { background: #f9fafb; color: #374151; border: 1px solid #e5e7eb; }
    .footnotes { font-size: .92em; color: #4b5563; border-top: 1px solid #e5e7eb; margin-top: 2em; }
  </style>
</head>
<body>
  <main class="moknow-export" data-source="${escapeAttribute(title)}">
${body}
  </main>
</body>
</html>
`;
  }

  async renderStandaloneHtmlAsync(content: string, title: string): Promise<string> {
    return this.renderStandaloneHtml(content, title, await this.renderAsync(content));
  }

  renderCollectionHtml(entries: MarkdownExportEntry[], title: string, description: string, options: MarkdownExportOptions = {}, renderedBodies: string[] = []): string {
    const includeTableOfContents = options.includeTableOfContents ?? true;
    const pageBreakBetweenEntries = options.pageBreakBetweenEntries ?? false;
    const printFriendly = options.printFriendly ?? false;
    const safeTitle = escapeHtml(title || "MoKnow 导出合集");
    const safeDescription = escapeHtml(description);
    const tableOfContents = entries.map((entry, index) => {
      const anchor = `entry-${index + 1}`;
      return `<li><a href="#${anchor}">${escapeHtml(entry.date ? `${entry.date} ${entry.title}` : entry.title)}</a></li>`;
    }).join("\n");
    const body = entries.map((entry, index) => {
      const anchor = `entry-${index + 1}`;
      const articleClass = pageBreakBetweenEntries && index > 0 ? "export-entry page-break" : "export-entry";
      return `<article class="${articleClass}" id="${anchor}">
  <header>
    <p class="entry-meta">${escapeHtml([entry.date, entry.path].filter(Boolean).join(" · "))}</p>
    <h2>${escapeHtml(entry.title)}</h2>
  </header>
  ${renderedBodies[index] ?? this.render(entry.content)}
</article>`;
    }).join("\n");
    const printStyles = printFriendly ? `
    @media print {
      body { background: #fff; }
      main { max-width: none; padding: 18mm 16mm; min-height: auto; }
      .export-toc { border-color: #d1d5db; background: #fff; }
      .export-entry.page-break { break-before: page; page-break-before: always; }
      a { color: #111827; text-decoration: none; }
    }` : "";
    const tableOfContentsBlock = includeTableOfContents ? `
    <nav class="export-toc" aria-label="导出目录">
      <strong>目录</strong>
      <ol>
${tableOfContents}
      </ol>
    </nav>` : "";

    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle}</title>
  <style>
    :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #f6f7fb; color: #1f2937; line-height: 1.72; }
    main { max-width: 920px; margin: 0 auto; padding: 48px 28px 80px; background: #fff; min-height: 100vh; box-sizing: border-box; }
    h1, h2, h3, h4, h5, h6 { color: #111827; line-height: 1.28; margin: 1.6em 0 .7em; }
    h1 { font-size: 2rem; border-bottom: 1px solid #e5e7eb; padding-bottom: .35em; }
    h2 { font-size: 1.55rem; }
    p, ul, ol, blockquote, pre, table { margin: 1em 0; }
    a { color: #2563eb; }
    .export-summary { color: #4b5563; margin-bottom: 28px; }
    .export-toc { padding: 16px 20px; border: 1px solid #e5e7eb; border-radius: 8px; background: #f9fafb; }
    .export-entry { margin-top: 42px; padding-top: 28px; border-top: 1px solid #e5e7eb; }
    .entry-meta { color: #6b7280; font-size: .92rem; margin-bottom: -8px; }
    blockquote { border-left: 4px solid #9ca3af; color: #4b5563; padding-left: 1em; }
    code { font-family: "SFMono-Regular", Consolas, monospace; background: #f3f4f6; border-radius: 4px; padding: .15em .35em; }
    pre { overflow: auto; background: #111827; color: #e5e7eb; border-radius: 8px; padding: 16px; }
    pre code { background: transparent; padding: 0; color: inherit; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #d1d5db; padding: 8px 10px; vertical-align: top; }
    th { background: #f3f4f6; font-weight: 600; }
    img { max-width: 100%; height: auto; border-radius: 6px; }
    .task-list-item { list-style: none; margin-left: -1.4em; }
    .task-list-item input { margin-right: .5em; }
    .math-block { overflow-x: auto; }
    .mermaid { background: #f9fafb; color: #374151; border: 1px solid #e5e7eb; }
    .footnotes { font-size: .92em; color: #4b5563; border-top: 1px solid #e5e7eb; margin-top: 2em; }
    ${pageBreakBetweenEntries ? ".export-entry.page-break { break-before: page; page-break-before: always; }" : ""}
    ${printStyles}
  </style>
</head>
<body>
  <main class="moknow-export-collection">
    <h1>${safeTitle}</h1>
    <p class="export-summary">${safeDescription}</p>
${tableOfContentsBlock}
${body}
  </main>
</body>
</html>
`;
  }

  async renderCollectionHtmlAsync(entries: MarkdownExportEntry[], title: string, description: string, options: MarkdownExportOptions = {}): Promise<string> {
    const renderedBodies = await Promise.all(entries.map((entry) => this.renderAsync(entry.content)));
    return this.renderCollectionHtml(entries, title, description, options, renderedBodies);
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

  supportedHighlightLanguages(): string[] {
    return hljs.listLanguages();
  }

  private configureAdvancedRendering() {
    this.markdown.use(markdownItFootnote);
    this.markdown.inline.ruler.after("escape", "math_inline", mathInlineRule);
    this.markdown.inline.ruler.after("link", "wiki_link", wikiLinkInlineRule);
    this.markdown.block.ruler.before("fence", "math_block", mathBlockRule, {
      alt: ["paragraph", "reference", "blockquote", "list"],
    });
    this.markdown.renderer.rules.math_inline = (tokens, index) => mathPlaceholder(tokens[index].content, false);
    this.markdown.renderer.rules.math_block = (tokens, index) => `${mathPlaceholder(tokens[index].content, true)}\n`;
    this.markdown.core.ruler.after("inline", "emoji_shortcodes", (state) => {
      for (const token of state.tokens) {
        const children = token.children ?? [];
        for (const child of children) {
          if (child.type === "text") child.content = replaceEmojiShortcodes(child.content);
        }
      }
    });

    const defaultFence = this.markdown.renderer.rules.fence?.bind(this.markdown.renderer.rules);
    this.markdown.renderer.rules.fence = (tokens, index, options, env, self) => {
      const token = tokens[index];
      const language = token.info.trim().split(/\s+/)[0];
      if (language === "mermaid") {
        return `<pre class="mermaid" data-mermaid="true">${escapeHtml(token.content)}</pre>\n`;
      }
      return defaultFence ? defaultFence(tokens, index, options, env, self) : self.renderToken(tokens, index, options);
    };
  }
}

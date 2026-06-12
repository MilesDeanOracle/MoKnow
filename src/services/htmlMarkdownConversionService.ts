import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

function createTurndownService() {
  const service = new TurndownService({
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    headingStyle: "atx",
  });
  service.use(gfm);

  service.addRule("moknowTaskListItem", {
    filter: (node) => node.nodeName === "LI" && Boolean((node as HTMLElement).querySelector("input[type='checkbox']")),
    replacement: (content, node) => {
      const checkbox = (node as HTMLElement).querySelector<HTMLInputElement>("input[type='checkbox']");
      const checked = checkbox?.checked || checkbox?.hasAttribute("checked");
      const text = content.replace(/\n+/g, " ").replace(/^\[[ xX]\]\s*/, "").trim();
      return `- [${checked ? "x" : " "}] ${text}\n`;
    },
  });

  service.addRule("moknowWikiLink", {
    filter: (node) => node.nodeName === "A" && (node as HTMLElement).hasAttribute("data-wiki-link"),
    replacement: (content, node) => {
      const title = (node as HTMLElement).getAttribute("data-wiki-link") || content;
      return `[[${title}]]`;
    },
  });

  service.addRule("moknowMathPlaceholder", {
    filter: (node) => node.nodeName === "SPAN" && (node as HTMLElement).hasAttribute("data-math-content"),
    replacement: (_content, node) => {
      const math = (node as HTMLElement).getAttribute("data-math-content") || "";
      const display = (node as HTMLElement).classList.contains("math-block");
      return display ? `\n$$\n${math}\n$$\n` : `$${math}$`;
    },
  });

  return service;
}

const turndownService = createTurndownService();

export function htmlToMarkdown(html: string): string {
  return turndownService
    .turndown(html)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

import type { FileNode, SearchResult } from "../types/models";

export interface WikiLinkCandidate {
  fileId: string;
  title: string;
  fileName: string;
  path: string;
}

export interface WikiBacklink extends SearchResult {
  linkText: string;
}

export interface WikiLinkTrigger {
  query: string;
  start: number;
  end: number;
}

export function noteTitleFromName(name: string) {
  return name.replace(/\.md$/i, "").trim();
}

export function normalizeWikiTitle(title: string) {
  return noteTitleFromName(title).replace(/\s+/g, " ").trim().toLowerCase();
}

export function collectWikiCandidates(nodes: FileNode[]): WikiLinkCandidate[] {
  const candidates: WikiLinkCandidate[] = [];

  const visit = (items: FileNode[]) => {
    for (const node of items) {
      if (node.type === "markdown") {
        candidates.push({
          fileId: node.contentKey ?? node.id,
          title: noteTitleFromName(node.name),
          fileName: node.name,
          path: node.path,
        });
      }
      if (node.children?.length) visit(node.children);
    }
  };

  visit(nodes);
  return candidates;
}

export function extractWikiLinks(content: string): string[] {
  const links = new Set<string>();
  const pattern = /\[\[([^\]\n|]+)(?:\|[^\]\n]+)?\]\]/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    const title = match[1].trim();
    if (title) links.add(title);
  }

  return Array.from(links);
}

export function findWikiLinkTrigger(content: string, cursorOffset: number): WikiLinkTrigger | null {
  const beforeCursor = content.slice(0, cursorOffset);
  const lineStart = beforeCursor.lastIndexOf("\n") + 1;
  const currentLineBeforeCursor = beforeCursor.slice(lineStart);
  const match = /\[\[([^\]\[\n]*)$/.exec(currentLineBeforeCursor);
  if (!match) return null;

  return {
    query: match[1],
    start: lineStart + match.index,
    end: cursorOffset,
  };
}

export function filterWikiCandidates(candidates: WikiLinkCandidate[], query: string, currentFileId?: string) {
  const normalizedQuery = normalizeWikiTitle(query);
  return candidates
    .filter((candidate) => candidate.fileId !== currentFileId)
    .filter((candidate) => {
      if (!normalizedQuery) return true;
      return normalizeWikiTitle(candidate.title).includes(normalizedQuery);
    })
    .slice(0, 8);
}

export function replaceWikiTrigger(content: string, trigger: WikiLinkTrigger, title: string) {
  return `${content.slice(0, trigger.start)}[[${title}]]${content.slice(trigger.end)}`;
}

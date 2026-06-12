export type FrontmatterValue = string | string[] | number | boolean | null;
export type FrontmatterData = Record<string, FrontmatterValue>;

export interface FrontmatterParseResult {
  body: string;
  data: FrontmatterData;
  hasFrontmatter: boolean;
}

const FRONTMATTER_BOUNDARY = "---";

function parseValue(value: string): FrontmatterValue {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return [];

    return inner
      .split(",")
      .map((item) => unquote(item.trim()))
      .filter((item) => item.length > 0);
  }

  return unquote(trimmed);
}

function unquote(value: string) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  return value;
}

function stringifyValue(value: FrontmatterValue): string {
  if (Array.isArray(value)) return `[${value.map((item) => quoteIfNeeded(item)).join(", ")}]`;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (value === null) return "null";
  return quoteIfNeeded(value);
}

function quoteIfNeeded(value: string) {
  if (!value) return '""';
  if (/[:#[\]{},&*!|>'"%@`\s]/.test(value)) return JSON.stringify(value);
  if (["true", "false", "null"].includes(value)) return JSON.stringify(value);
  if (/^-?\d+(\.\d+)?$/.test(value)) return JSON.stringify(value);
  return value;
}

export function parseFrontmatter(markdown: string): FrontmatterParseResult {
  const normalized = markdown.replace(/^\uFEFF/, "");
  const lines = normalized.split(/\r?\n/);

  if (lines[0]?.trim() !== FRONTMATTER_BOUNDARY) {
    return { body: markdown, data: {}, hasFrontmatter: false };
  }

  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === FRONTMATTER_BOUNDARY);
  if (closingIndex === -1) {
    return { body: markdown, data: {}, hasFrontmatter: false };
  }

  const data: FrontmatterData = {};
  lines.slice(1, closingIndex).forEach((line) => {
    if (!line.trim() || line.trimStart().startsWith("#")) return;

    const separator = line.indexOf(":");
    if (separator <= 0) return;

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1);
    if (key) data[key] = parseValue(value);
  });

  return {
    body: lines.slice(closingIndex + 1).join("\n").replace(/^\n/, ""),
    data,
    hasFrontmatter: true,
  };
}

export function stringifyFrontmatter(data: FrontmatterData, body: string): string {
  const entries = Object.entries(data).filter(([key]) => key.trim().length > 0);
  if (!entries.length) return body;

  const frontmatter = entries.map(([key, value]) => `${key}: ${stringifyValue(value)}`).join("\n");
  return `${FRONTMATTER_BOUNDARY}\n${frontmatter}\n${FRONTMATTER_BOUNDARY}\n\n${body.replace(/^\n+/, "")}`;
}

export function updateFrontmatter(markdown: string, updates: FrontmatterData): string {
  const parsed = parseFrontmatter(markdown);
  return stringifyFrontmatter({ ...parsed.data, ...updates }, parsed.body);
}

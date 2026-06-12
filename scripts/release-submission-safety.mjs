#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { requiredFiles } from "./release-required-files.mjs";

const args = process.argv.slice(2);

function argValue(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

function hasFlag(name) {
  return args.includes(name);
}

function cleanCell(value) {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replace(/\r?\n/g, "<br>")
    .trim();
}

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function replaceAutoSection(path, section) {
  const start = "<!-- AUTO_RELEASE_SUBMISSION_SAFETY_START -->";
  const end = "<!-- AUTO_RELEASE_SUBMISSION_SAFETY_END -->";
  const previous = existsSync(path) ? readFileSync(path, "utf8") : "";
  const block = `${start}\n${section.trim()}\n${end}`;
  if (previous.includes(start) && previous.includes(end)) {
    return previous.replace(new RegExp(`${start}[\\s\\S]*?${end}`), block);
  }
  return previous.trim() ? `${previous.trimEnd()}\n\n## 发布提交安全检查\n\n${block}\n` : `${block}\n`;
}

function readPathspec(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\0").filter(Boolean);
}

function textOrBinary(path) {
  const buffer = readFileSync(path);
  if (buffer.includes(0)) return { binary: true, text: "" };
  return { binary: false, text: buffer.toString("utf8") };
}

const outputMarkdown = argValue("--output-md", "release/submission-safety.md");
const outputJson = argValue("--output-json", "release/submission-safety.json");
const pathspecPath = argValue("--pathspec", "release/submission-pathspec.txt");
const docPath = argValue("--doc", "项目文档/发布提交安全检查记录.md");
const writeDoc = hasFlag("--write-doc");
const strict = hasFlag("--strict");
const generatedAt = new Date().toISOString();
const maxFileSizeBytes = Number(argValue("--max-file-size", 1024 * 1024));

const forbiddenPathRules = [
  { label: "node_modules", pattern: /(^|\/)node_modules\// },
  { label: "release 生成产物", pattern: /^release\// },
  { label: "Tauri target 生成产物", pattern: /^src-tauri\/target\// },
  { label: "真实环境变量文件", pattern: /(^|\/)\.env(\.|$)/, allow: /^项目文档\/发布外部闭环环境变量模板\.env$/ },
  { label: "证书或私钥文件", pattern: /\.(p12|pfx|pem|key|crt|cer)$/i },
  { label: "系统临时文件", pattern: /(^|\/)(\.DS_Store|Thumbs\.db)$/ },
];

const secretTextRules = [
  { label: "OpenAI / Provider API Key", pattern: /\b(sk-[A-Za-z0-9_-]{20,}|AI_E2E_API_KEY\s*=\s*["']?[A-Za-z0-9_-]{20,})/g },
  { label: "GitHub token", pattern: /\bgh[opsu]_[A-Za-z0-9_]{30,}\b/g },
  { label: "私钥块", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  {
    label: "Tauri updater 私钥明文",
    pattern: /\bTAURI_SIGNING_PRIVATE_KEY\s*=\s*["']?(?!<)[A-Za-z0-9+/=_-]{32,}/g,
  },
  {
    label: "Apple / Windows 证书明文",
    pattern: /\b(APPLE_CERTIFICATE|WINDOWS_CERTIFICATE)\s*=\s*["']?(?!<)[A-Za-z0-9+/=_-]{80,}/g,
  },
];

const pathspecEntries = readPathspec(pathspecPath);
const scanPaths = pathspecEntries.length ? pathspecEntries : requiredFiles.map((file) => file.path);
const requiredSet = new Set(requiredFiles.map((file) => file.path));
const pathspecSet = new Set(pathspecEntries);
const missingFromPathspec = requiredFiles
  .map((file) => file.path)
  .filter((path) => existsSync(path) && pathspecEntries.length > 0 && !pathspecSet.has(path));
const extraInPathspec = pathspecEntries.filter((path) => !requiredSet.has(path));

const rows = scanPaths.map((path) => {
  const exists = existsSync(path);
  const stat = exists ? statSync(path) : undefined;
  const forbidden = forbiddenPathRules
    .filter((rule) => rule.pattern.test(path) && !(rule.allow && rule.allow.test(path)))
    .map((rule) => rule.label);
  const secrets = [];
  let binary = false;
  if (exists && stat?.isFile()) {
    const content = textOrBinary(path);
    binary = content.binary;
    if (!binary) {
      for (const rule of secretTextRules) {
        const matches = [...content.text.matchAll(rule.pattern)];
        if (matches.length > 0) secrets.push(`${rule.label} (${matches.length})`);
      }
    }
  }
  const tooLarge = Boolean(stat && stat.size > maxFileSizeBytes);
  return {
    path,
    exists,
    sizeBytes: stat?.size ?? 0,
    tooLarge,
    binary,
    forbidden,
    secrets,
    ok: exists && forbidden.length === 0 && secrets.length === 0,
  };
});

const missing = rows.filter((row) => !row.exists);
const forbiddenRows = rows.filter((row) => row.forbidden.length > 0);
const secretRows = rows.filter((row) => row.secrets.length > 0);
const largeRows = rows.filter((row) => row.tooLarge);
const failures = [
  ...missing.map((row) => `${row.path}: 文件缺失`),
  ...forbiddenRows.map((row) => `${row.path}: ${row.forbidden.join("、")}`),
  ...secretRows.map((row) => `${row.path}: ${row.secrets.join("、")}`),
  ...missingFromPathspec.map((path) => `${path}: pathspec 缺失`),
  ...extraInPathspec.map((path) => `${path}: pathspec 不在必需文件清单中`),
];

const markdown = `# 发布提交安全检查记录

| 项目 | 值 |
|---|---|
| 生成时间 | ${generatedAt} |
| 扫描来源 | ${pathspecEntries.length ? `\`${pathspecPath}\`` : "必需文件清单"} |
| 扫描文件数量 | ${rows.length} |
| 失败项数量 | ${failures.length} |
| 超过大小阈值数量 | ${largeRows.length} |
| 大小阈值 | ${Math.round(maxFileSizeBytes / 1024)} KiB |

## 检查项

| 文件 | 存在 | 大小 | 二进制 | 路径风险 | 密钥风险 | 结论 |
|---|---|---|---|---|---|---|
${rows
  .map(
    (row) =>
      `| \`${cleanCell(row.path)}\` | ${row.exists ? "是" : "否"} | ${row.sizeBytes} | ${row.binary ? "是" : "否"} | ${
        row.forbidden.length ? cleanCell(row.forbidden.join("<br>")) : "无"
      } | ${row.secrets.length ? cleanCell(row.secrets.join("<br>")) : "无"} | ${row.ok ? "通过" : "未通过"} |`,
  )
  .join("\n")}

## Pathspec 覆盖

| 类型 | 文件 |
|---|---|
| 必需文件缺失于 pathspec | ${missingFromPathspec.length ? missingFromPathspec.map((path) => `\`${path}\``).join("<br>") : "无"} |
| pathspec 额外文件 | ${extraInPathspec.length ? extraInPathspec.map((path) => `\`${path}\``).join("<br>") : "无"} |

## 后续命令

\`\`\`bash
npm run release:submission-safety -- --strict --write-doc
npm run release:submission-plan -- --strict --write-doc
npm run release:push-readiness -- --write-doc
git add --pathspec-from-file=release/submission-pathspec.txt --pathspec-file-nul
npm run release:tracking -- --strict --write-doc
\`\`\`

> 本脚本只扫描即将入库的发布闭环文件，不执行 \`git add\`、\`git commit\` 或 \`git push\`。真实密钥、证书、私钥、生成产物和本机配置不应进入 pathspec。
`;

const report = {
  generatedAt,
  strict,
  pathspec: pathspecPath,
  scannedCount: rows.length,
  failures,
  warnings: largeRows.map((row) => `${row.path}: ${row.sizeBytes} bytes`),
  missingFromPathspec,
  extraInPathspec,
  rows,
};

write(outputMarkdown, markdown);
write(outputJson, `${JSON.stringify(report, null, 2)}\n`);
if (writeDoc) write(docPath, replaceAutoSection(docPath, markdown));

console.log(`Release submission safety written to ${outputMarkdown} and ${outputJson}.`);
console.log(`- Scanned files: ${rows.length}`);
console.log(`- Failures: ${failures.length}`);
console.log(`- Large files: ${largeRows.length}`);

if (strict && failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}

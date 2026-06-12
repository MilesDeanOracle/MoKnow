#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const args = process.argv.slice(2);

function argValue(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

function hasFlag(name) {
  return args.includes(name);
}

function readPathspec(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\0").filter(Boolean);
}

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function replaceAutoSection(path, section) {
  const start = "<!-- AUTO_RELEASE_SUBMISSION_MANIFEST_START -->";
  const end = "<!-- AUTO_RELEASE_SUBMISSION_MANIFEST_END -->";
  const previous = existsSync(path) ? readFileSync(path, "utf8") : "";
  const block = `${start}\n${section.trim()}\n${end}`;
  if (previous.includes(start) && previous.includes(end)) {
    return previous.replace(new RegExp(`${start}[\\s\\S]*?${end}`), block);
  }
  return previous.trim() ? `${previous.trimEnd()}\n\n## 发布提交校验清单\n\n${block}\n` : `${block}\n`;
}

function cleanCell(value) {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replace(/\r?\n/g, "<br>")
    .trim();
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

const outputMarkdown = argValue("--output-md", "release/submission-manifest.md");
const outputJson = argValue("--output-json", "release/submission-manifest.json");
const pathspecPath = argValue("--pathspec", "release/submission-pathspec.txt");
const docPath = argValue("--doc", "项目文档/发布提交校验清单.md");
const writeDoc = hasFlag("--write-doc");
const strict = hasFlag("--strict");
const generatedAt = new Date().toISOString();
const selfGeneratedPaths = new Set([docPath]);

if (writeDoc && !existsSync(docPath)) {
  write(
    docPath,
    replaceAutoSection(
      docPath,
      `# 发布提交校验清单\n\n| 项目 | 值 |\n|---|---|\n| 生成时间 | ${generatedAt} |\n| 状态 | 正在生成，等待 release:submission-manifest 完整报告写回 |`,
    ),
  );
}

const pathspecEntries = readPathspec(pathspecPath);
const rows = pathspecEntries.map((path) => {
  const exists = existsSync(path);
  const selfGenerated = selfGeneratedPaths.has(path);
  if (!exists) {
    return {
      path,
      exists,
      sizeBytes: 0,
      sha256: "",
      hashIncluded: false,
      selfGenerated,
      ok: false,
      reason: "文件缺失",
    };
  }
  const content = readFileSync(path);
  if (selfGenerated) {
    return {
      path,
      exists,
      sizeBytes: content.byteLength,
      sha256: "",
      hashIncluded: false,
      selfGenerated,
      ok: true,
      reason: "生成报告，存在检查通过，不参与自身聚合哈希",
    };
  }
  return {
    path,
    exists,
    sizeBytes: content.byteLength,
    sha256: sha256(content),
    hashIncluded: true,
    selfGenerated,
    ok: true,
    reason: "通过",
  };
});

const failures = rows.filter((row) => !row.ok).map((row) => `${row.path}: ${row.reason}`);
const hashRows = rows.filter((row) => row.hashIncluded);
const aggregateHash = sha256(Buffer.from(hashRows.map((row) => `${row.sha256}  ${row.path}`).join("\n"), "utf8"));

const markdown = `# 发布提交校验清单

| 项目 | 值 |
|---|---|
| 生成时间 | ${generatedAt} |
| Pathspec | \`${pathspecPath}\` |
| 文件数量 | ${rows.length} |
| 参与聚合文件数量 | ${hashRows.length} |
| 不参与聚合文件 | ${rows.length - hashRows.length} |
| 失败项数量 | ${failures.length} |
| 聚合 SHA-256 | \`${aggregateHash}\` |

## 文件校验

| 文件 | 大小 bytes | SHA-256 | 结论 |
|---|---:|---|---|
${rows
  .map(
    (row) =>
      `| \`${cleanCell(row.path)}\` | ${row.sizeBytes} | ${
        row.sha256 ? `\`${row.sha256}\`` : row.hashIncluded === false && row.ok ? "不参与聚合" : "无"
      } | ${cleanCell(row.reason)} |`,
  )
  .join("\n")}

## 后续命令

\`\`\`bash
npm run release:submit-prep -- --write-doc
npm run release:submission-manifest -- --strict --write-doc
git add --pathspec-from-file=release/submission-pathspec.txt --pathspec-file-nul
npm run release:tracking -- --strict --write-doc
\`\`\`

> 本脚本只读取 pathspec 中的待提交文件并生成 SHA-256 校验清单，不执行 \`git add\`、\`git commit\` 或 \`git push\`。
`;

const report = {
  generatedAt,
  strict,
  pathspec: pathspecPath,
  fileCount: rows.length,
  hashedFileCount: hashRows.length,
  skippedHashCount: rows.length - hashRows.length,
  selfGeneratedPaths: Array.from(selfGeneratedPaths),
  aggregateHash,
  failures,
  rows,
};

write(outputMarkdown, markdown);
write(outputJson, `${JSON.stringify(report, null, 2)}\n`);
if (writeDoc) write(docPath, replaceAutoSection(docPath, markdown));

console.log(`Release submission manifest written to ${outputMarkdown} and ${outputJson}.`);
console.log(`- Files: ${rows.length}`);
console.log(`- Hashed files: ${hashRows.length}`);
console.log(`- Failures: ${failures.length}`);
console.log(`- Aggregate SHA-256: ${aggregateHash}`);

if (strict && failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}

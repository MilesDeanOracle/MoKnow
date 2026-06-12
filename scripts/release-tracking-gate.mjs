#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout?.trim() ?? "",
    stderr: result.stderr?.trim() ?? "",
  };
}

function gitTracked(path) {
  return run("git", ["ls-files", "--error-unmatch", path]).status === 0;
}

function gitIgnored(path) {
  return run("git", ["check-ignore", "-q", path]).status === 0;
}

function gitStatus(path) {
  return run("git", ["-c", "core.quotePath=false", "status", "--short", "--", path]).stdout || "";
}

function replaceAutoSection(path, section) {
  const start = "<!-- AUTO_RELEASE_TRACKING_GATE_START -->";
  const end = "<!-- AUTO_RELEASE_TRACKING_GATE_END -->";
  const previous = existsSync(path) ? readFileSync(path, "utf8") : "";
  const block = `${start}\n${section.trim()}\n${end}`;
  if (previous.includes(start) && previous.includes(end)) {
    return previous.replace(new RegExp(`${start}[\\s\\S]*?${end}`), block);
  }
  return previous.trim() ? `${previous.trimEnd()}\n\n## 发布文件入库门禁\n\n${block}\n` : `${block}\n`;
}

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

const outputMarkdown = argValue("--output-md", "release/tracking-gate.md");
const outputJson = argValue("--output-json", "release/tracking-gate.json");
const docPath = argValue("--doc", "项目文档/发布文件入库检查记录.md");
const writeDoc = hasFlag("--write-doc");
const strict = hasFlag("--strict");
const generatedAt = new Date().toISOString();

const rows = requiredFiles.map((file) => {
  const exists = existsSync(file.path);
  const ignored = gitIgnored(file.path);
  const tracked = gitTracked(file.path);
  const status = gitStatus(file.path).replace(/\r?\n/g, "<br>") || "clean";
  return {
    ...file,
    exists,
    ignored,
    tracked,
    status,
    ok: exists && !ignored && (!strict || tracked),
  };
});

const missing = rows.filter((row) => !row.exists);
const ignored = rows.filter((row) => row.ignored);
const untracked = rows.filter((row) => row.exists && !row.tracked);
const failures = rows.filter((row) => !row.ok);

const markdown = `# 发布文件入库检查记录

| 项目 | 值 |
|---|---|
| 生成时间 | ${generatedAt} |
| 严格模式 | ${strict ? "是" : "否"} |
| 必需文件数量 | ${rows.length} |
| 缺失文件数量 | ${missing.length} |
| 被 .gitignore 忽略数量 | ${ignored.length} |
| 未纳入 git 索引数量 | ${untracked.length} |
| 失败项数量 | ${failures.length} |

| 文件 | 分组 | 存在 | 被忽略 | 已纳入 git | git 状态 | 用途 |
|---|---|---|---|---|---|---|
${rows
  .map(
    (row) =>
      `| \`${row.path}\` | ${row.group} | ${row.exists ? "是" : "否"} | ${row.ignored ? "是" : "否"} | ${row.tracked ? "是" : "否"} | ${row.status} | ${row.reason} |`,
  )
  .join("\n")}

## 建议命令

\`\`\`bash
npm run release:submission-plan -- --strict --write-doc
git add --pathspec-from-file=release/submission-pathspec.txt --pathspec-file-nul
npm run release:tracking -- --strict --write-doc
\`\`\`

> 非严格模式用于生成提交前清单；严格模式要求所有必需文件都已纳入 git 索引。
`;

const report = {
  generatedAt,
  strict,
  requiredCount: rows.length,
  missing: missing.map((row) => row.path),
  ignored: ignored.map((row) => row.path),
  untracked: untracked.map((row) => row.path),
  failures: failures.map((row) => row.path),
  rows,
};

write(outputMarkdown, markdown);
write(outputJson, `${JSON.stringify(report, null, 2)}\n`);
if (writeDoc) {
  write(docPath, replaceAutoSection(docPath, markdown));
}

console.log(`Release tracking gate written to ${outputMarkdown} and ${outputJson}.`);
console.log(`- Required files: ${rows.length}`);
console.log(`- Missing: ${missing.length}`);
console.log(`- Ignored: ${ignored.length}`);
console.log(`- Untracked: ${untracked.length}`);

if (strict && failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure.path}`);
  process.exit(1);
}

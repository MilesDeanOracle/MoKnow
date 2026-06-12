#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { requiredFiles } from "./release-required-files.mjs";

const args = process.argv.slice(2);

function argValue(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

function hasFlag(name) {
  return args.includes(name);
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    encoding: "utf8",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      ...(options.env ?? {}),
    },
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

function summarizeOutput(...values) {
  const lines = values
    .join("\n")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.slice(0, 20).join("<br>") || "无输出";
}

function replaceAutoSection(path, section) {
  const start = "<!-- AUTO_RELEASE_SUBMISSION_PLAN_START -->";
  const end = "<!-- AUTO_RELEASE_SUBMISSION_PLAN_END -->";
  const previous = existsSync(path) ? readFileSync(path, "utf8") : "";
  const block = `${start}\n${section.trim()}\n${end}`;
  if (previous.includes(start) && previous.includes(end)) {
    return previous.replace(new RegExp(`${start}[\\s\\S]*?${end}`), block);
  }
  return previous.trim() ? `${previous.trimEnd()}\n\n## 发布提交入库计划\n\n${block}\n` : `${block}\n`;
}

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function readPathspec(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path).toString("utf8").split("\0").filter(Boolean);
}

function cleanCell(value) {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replace(/\r?\n/g, "<br>")
    .trim();
}

const outputMarkdown = argValue("--output-md", "release/submission-plan.md");
const outputJson = argValue("--output-json", "release/submission-plan.json");
const outputPathspec = argValue("--pathspec", "release/submission-pathspec.txt");
const tempIndexPath = argValue("--temp-index", "release/submission-plan.index");
const tempObjectDir = argValue("--temp-object-dir", "release/submission-plan-objects");
const docPath = argValue("--doc", "项目文档/发布提交入库计划.md");
const writeDoc = hasFlag("--write-doc");
const strict = hasFlag("--strict");
const generatedAt = new Date().toISOString();

if (writeDoc && !existsSync(docPath)) {
  write(
    docPath,
    replaceAutoSection(
      docPath,
      `# 发布提交入库计划\n\n| 项目 | 值 |\n|---|---|\n| 生成时间 | ${generatedAt} |\n| 状态 | 正在生成，等待 release:submission-plan 完整报告写回 |`,
    ),
  );
}

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
    addable: exists && !ignored,
  };
});

const missing = rows.filter((row) => !row.exists);
const ignored = rows.filter((row) => row.ignored);
const untracked = rows.filter((row) => row.exists && !row.tracked);
const modifiedOrUntracked = rows.filter((row) => row.exists && row.status !== "clean");
const addable = rows.filter((row) => row.addable);
const pathspecPaths = addable.map((row) => row.path);
const gitAddCommand = `git add --pathspec-from-file=${outputPathspec} --pathspec-file-nul`;

write(outputPathspec, Buffer.from(`${pathspecPaths.join("\0")}\0`, "utf8"));
const pathspecEntries = readPathspec(outputPathspec);
const pathspecSet = new Set(pathspecEntries);
const expectedSet = new Set(pathspecPaths);
const duplicatePathspecEntries = pathspecEntries.filter((path, index) => pathspecEntries.indexOf(path) !== index);
const missingFromPathspec = pathspecPaths.filter((path) => !pathspecSet.has(path));
const extraInPathspec = pathspecEntries.filter((path) => !expectedSet.has(path));
const pathspecMatchesAddable =
  pathspecEntries.length === pathspecPaths.length &&
  missingFromPathspec.length === 0 &&
  extraInPathspec.length === 0 &&
  duplicatePathspecEntries.length === 0;

rmSync(tempIndexPath, { force: true });
rmSync(`${tempIndexPath}.lock`, { force: true });
rmSync(tempObjectDir, { recursive: true, force: true });
mkdirSync(tempObjectDir, { recursive: true });
const objectPathResult = run("git", ["rev-parse", "--git-path", "objects"]);
const tempIndexEnv = {
  GIT_INDEX_FILE: tempIndexPath,
  GIT_OBJECT_DIRECTORY: resolve(tempObjectDir),
  GIT_ALTERNATE_OBJECT_DIRECTORIES: resolve(objectPathResult.stdout || ".git/objects"),
};
const headExists = run("git", ["rev-parse", "--verify", "HEAD"]).status === 0;
const readTreeResult = run("git", headExists ? ["read-tree", "HEAD"] : ["read-tree", "--empty"], {
  env: tempIndexEnv,
});
const gitAddDryRunResult =
  readTreeResult.status === 0
    ? run("git", ["add", "--dry-run", `--pathspec-from-file=${outputPathspec}`, "--pathspec-file-nul"], {
        env: tempIndexEnv,
      })
    : { status: 1, stdout: "", stderr: "无法初始化临时 git index" };
const gitAddDryRun = {
  ok: gitAddDryRunResult.status === 0,
  exitCode: gitAddDryRunResult.status,
  command: `git add --dry-run --pathspec-from-file=${outputPathspec} --pathspec-file-nul`,
  summary: summarizeOutput(gitAddDryRunResult.stdout, gitAddDryRunResult.stderr),
  tempIndex: tempIndexPath,
  tempObjectDir,
};
const simulatedAddResult =
  readTreeResult.status === 0
    ? run("git", ["add", `--pathspec-from-file=${outputPathspec}`, "--pathspec-file-nul"], { env: tempIndexEnv })
    : { status: 1, stdout: "", stderr: "无法初始化临时 git index" };
const simulatedRows = rows.map((row) => {
  const trackedInTempIndex = run("git", ["ls-files", "--error-unmatch", row.path], { env: tempIndexEnv }).status === 0;
  return {
    path: row.path,
    ok: row.exists && !row.ignored && trackedInTempIndex,
    trackedInTempIndex,
  };
});
const simulatedFailures = simulatedRows.filter((row) => !row.ok);
const simulatedStrictTracking = {
  ok: readTreeResult.status === 0 && simulatedAddResult.status === 0 && simulatedFailures.length === 0,
  tempIndex: tempIndexPath,
  tempObjectDir,
  initialized: readTreeResult.status === 0,
  addExitCode: simulatedAddResult.status,
  trackedCount: simulatedRows.filter((row) => row.trackedInTempIndex).length,
  requiredCount: rows.length,
  failures: simulatedFailures.map((row) => row.path),
  summary: summarizeOutput(readTreeResult.stdout, readTreeResult.stderr, simulatedAddResult.stdout, simulatedAddResult.stderr),
};

const markdown = `# 发布提交入库计划

| 项目 | 值 |
|---|---|
| 生成时间 | ${generatedAt} |
| 必需文件数量 | ${rows.length} |
| 可加入 pathspec 数量 | ${addable.length} |
| 缺失文件数量 | ${missing.length} |
| 被 .gitignore 忽略数量 | ${ignored.length} |
| 未纳入 git 索引数量 | ${untracked.length} |
| 有变更或未跟踪数量 | ${modifiedOrUntracked.length} |
| Pathspec 文件 | \`${outputPathspec}\` |
| Pathspec 条目数量 | ${pathspecEntries.length} |
| Pathspec 覆盖所有可加入文件 | ${pathspecMatchesAddable ? "是" : "否"} |
| Git add dry-run | ${gitAddDryRun.ok ? "通过" : "未通过"} |
| Git add dry-run 临时 object 目录 | \`${tempObjectDir}\` |
| 临时 index 严格入库模拟 | ${simulatedStrictTracking.ok ? "通过" : "未通过"} |
| 临时 index 已跟踪数量 | ${simulatedStrictTracking.trackedCount} / ${simulatedStrictTracking.requiredCount} |

## 推荐执行顺序

\`\`\`bash
npm run release:submission-plan -- --write-doc
${gitAddDryRun.command}
${gitAddCommand}
npm run release:tracking -- --strict --write-doc
git status --short
\`\`\`

> 本脚本只生成计划和 pathspec 文件，不会执行 \`git add\`、\`git commit\` 或 \`git push\`。真实密钥、证书和本机私有配置仍不应加入仓库。

## 文件清单

| 文件 | 分组 | 存在 | 被忽略 | 已纳入 git | git 状态 | 用途 |
|---|---|---|---|---|---|---|
${rows
  .map(
    (row) =>
      `| \`${cleanCell(row.path)}\` | ${cleanCell(row.group)} | ${row.exists ? "是" : "否"} | ${row.ignored ? "是" : "否"} | ${row.tracked ? "是" : "否"} | ${cleanCell(row.status)} | ${cleanCell(row.reason)} |`,
  )
  .join("\n")}

## 当前阻断

| 类型 | 文件 |
|---|---|
| 缺失 | ${missing.length ? missing.map((row) => `\`${row.path}\``).join("<br>") : "无"} |
| 被忽略 | ${ignored.length ? ignored.map((row) => `\`${row.path}\``).join("<br>") : "无"} |
| 未纳入 git | ${untracked.length ? untracked.map((row) => `\`${row.path}\``).join("<br>") : "无"} |
| Pathspec 缺失 | ${missingFromPathspec.length ? missingFromPathspec.map((path) => `\`${path}\``).join("<br>") : "无"} |
| Pathspec 额外 | ${extraInPathspec.length ? extraInPathspec.map((path) => `\`${path}\``).join("<br>") : "无"} |
| Pathspec 重复 | ${duplicatePathspecEntries.length ? duplicatePathspecEntries.map((path) => `\`${path}\``).join("<br>") : "无"} |
| Git add dry-run | ${gitAddDryRun.ok ? "通过" : `未通过（exit ${gitAddDryRun.exitCode}）`} |
| 临时 index 严格入库模拟失败 | ${simulatedStrictTracking.failures.length ? simulatedStrictTracking.failures.map((path) => `\`${path}\``).join("<br>") : "无"} |

## Git add dry-run 摘要

${gitAddDryRun.summary}

## 临时 index 模拟摘要

${simulatedStrictTracking.summary}
`;

const report = {
  generatedAt,
  strict,
  requiredCount: rows.length,
  pathspec: outputPathspec,
  pathspecCount: pathspecEntries.length,
  pathspecMatchesAddable,
  gitAddDryRun,
  simulatedStrictTracking,
  gitAddCommand,
  missing: missing.map((row) => row.path),
  ignored: ignored.map((row) => row.path),
  missingFromPathspec,
  extraInPathspec,
  duplicatePathspecEntries,
  untracked: untracked.map((row) => row.path),
  changed: modifiedOrUntracked.map((row) => row.path),
  rows,
};

write(outputMarkdown, markdown);
write(outputJson, `${JSON.stringify(report, null, 2)}\n`);
if (writeDoc) {
  write(docPath, replaceAutoSection(docPath, markdown));
}

console.log(`Release submission plan written to ${outputMarkdown}, ${outputJson}, and ${outputPathspec}.`);
if (writeDoc) console.log(`Project doc written to ${docPath}.`);
console.log(`- Required files: ${rows.length}`);
console.log(`- Missing: ${missing.length}`);
console.log(`- Ignored: ${ignored.length}`);
console.log(`- Untracked: ${untracked.length}`);
console.log(`- Pathspec entries: ${pathspecEntries.length}`);
console.log(`- Pathspec covers addable files: ${pathspecMatchesAddable ? "yes" : "no"}`);
console.log(`- Git add dry-run: ${gitAddDryRun.ok ? "passed" : "failed"}`);
console.log(`- Simulated strict tracking: ${simulatedStrictTracking.ok ? "passed" : "failed"}`);
console.log(`- Git add command: ${gitAddCommand}`);

if (
  strict &&
  (missing.length > 0 || ignored.length > 0 || !pathspecMatchesAddable || !gitAddDryRun.ok || !simulatedStrictTracking.ok)
) {
  for (const row of [...missing, ...ignored]) console.error(`FAIL: ${row.path}`);
  for (const path of missingFromPathspec) console.error(`FAIL: pathspec missing ${path}`);
  for (const path of extraInPathspec) console.error(`FAIL: pathspec extra ${path}`);
  for (const path of duplicatePathspecEntries) console.error(`FAIL: pathspec duplicate ${path}`);
  if (!gitAddDryRun.ok) console.error(`FAIL: ${gitAddDryRun.command}`);
  for (const path of simulatedStrictTracking.failures) console.error(`FAIL: simulated index missing ${path}`);
  process.exit(1);
}

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

function readJson(path) {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

function readPathspec(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\0").filter(Boolean);
}

function cleanCell(value) {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replace(/\r?\n/g, "<br>")
    .trim();
}

function summarizeOutput(...values) {
  const lines = values
    .join("\n")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.slice(0, 30).join("<br>") || "无输出";
}

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function replaceAutoSection(path, section) {
  const start = "<!-- AUTO_RELEASE_SUBMISSION_PREVIEW_START -->";
  const end = "<!-- AUTO_RELEASE_SUBMISSION_PREVIEW_END -->";
  const previous = existsSync(path) ? readFileSync(path, "utf8") : "";
  const block = `${start}\n${section.trim()}\n${end}`;
  if (previous.includes(start) && previous.includes(end)) {
    return previous.replace(new RegExp(`${start}[\\s\\S]*?${end}`), block);
  }
  return previous.trim() ? `${previous.trimEnd()}\n\n## 发布提交预演\n\n${block}\n` : `${block}\n`;
}

const outputMarkdown = argValue("--output-md", "release/submission-preview.md");
const outputJson = argValue("--output-json", "release/submission-preview.json");
const pathspecPath = argValue("--pathspec", "release/submission-pathspec.txt");
const tempIndexPath = argValue("--temp-index", "release/submission-preview.index");
const tempObjectDir = argValue("--temp-object-dir", "release/submission-preview-objects");
const docPath = argValue("--doc", "项目文档/发布提交预演记录.md");
const writeDoc = hasFlag("--write-doc");
const strict = hasFlag("--strict");
const generatedAt = new Date().toISOString();
const pathspecEntries = readPathspec(pathspecPath);
const requiredPaths = requiredFiles.map((file) => file.path);
const safety = readJson("release/submission-safety.json");
const plan = readJson("release/submission-plan.json");
const failures = [];
const warnings = [];

if (pathspecEntries.length === 0) failures.push(`${pathspecPath}: pathspec 缺失或为空`);
if (safety && safety.failures?.length) failures.push(...safety.failures.map((failure) => `提交安全检查未通过：${failure}`));
if (!safety) warnings.push("release/submission-safety.json 缺失");
if (plan && !plan.simulatedStrictTracking?.ok) failures.push("提交计划临时 index 严格入库模拟未通过");
if (!plan) warnings.push("release/submission-plan.json 缺失");

rmSync(tempIndexPath, { force: true });
rmSync(`${tempIndexPath}.lock`, { force: true });
rmSync(tempObjectDir, { recursive: true, force: true });
mkdirSync(tempObjectDir, { recursive: true });

const objectPathResult = run("git", ["rev-parse", "--git-path", "objects"]);
const headResult = run("git", ["rev-parse", "--verify", "HEAD"]);
const tempEnv = {
  GIT_INDEX_FILE: tempIndexPath,
  GIT_OBJECT_DIRECTORY: resolve(tempObjectDir),
  GIT_ALTERNATE_OBJECT_DIRECTORIES: resolve(objectPathResult.stdout || ".git/objects"),
};
const readTreeResult = run("git", headResult.status === 0 ? ["read-tree", "HEAD"] : ["read-tree", "--empty"], {
  env: tempEnv,
});
const addResult =
  readTreeResult.status === 0
    ? run("git", ["add", `--pathspec-from-file=${pathspecPath}`, "--pathspec-file-nul"], { env: tempEnv })
    : { status: 1, stdout: "", stderr: "无法初始化临时 git index" };
const writeTreeResult = addResult.status === 0 ? run("git", ["write-tree"], { env: tempEnv }) : { status: 1, stdout: "", stderr: "无法写入临时 tree" };
const diffNameStatus =
  addResult.status === 0
    ? run("git", ["diff", "--cached", "--name-status", "--", ...requiredPaths], { env: tempEnv })
    : { status: 1, stdout: "", stderr: "无法生成 diff name-status" };
const diffStat =
  addResult.status === 0
    ? run("git", ["diff", "--cached", "--stat", "--", ...requiredPaths], { env: tempEnv })
    : { status: 1, stdout: "", stderr: "无法生成 diff stat" };
const requiredRows = requiredPaths.map((path) => {
  const inTempIndex = run("git", ["ls-files", "--error-unmatch", path], { env: tempEnv }).status === 0;
  return { path, inTempIndex };
});
const missingRequired = requiredRows.filter((row) => !row.inTempIndex).map((row) => row.path);
if (readTreeResult.status !== 0) failures.push(`临时 index 初始化失败：${summarizeOutput(readTreeResult.stdout, readTreeResult.stderr)}`);
if (addResult.status !== 0) failures.push(`临时 index git add 失败：${summarizeOutput(addResult.stdout, addResult.stderr)}`);
if (writeTreeResult.status !== 0) failures.push(`临时 tree 写入失败：${summarizeOutput(writeTreeResult.stdout, writeTreeResult.stderr)}`);
if (missingRequired.length > 0) failures.push(...missingRequired.map((path) => `${path}: 未进入提交预演临时 index`));

const changedRows = diffNameStatus.stdout
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    const [status, ...pathParts] = line.split(/\s+/);
    return { status, path: pathParts.join(" ") };
  });

const markdown = `# 发布提交预演记录

| 项目 | 值 |
|---|---|
| 生成时间 | ${generatedAt} |
| Pathspec | \`${pathspecPath}\` |
| Pathspec 条目数量 | ${pathspecEntries.length} |
| 必需文件数量 | ${requiredPaths.length} |
| 临时 index | \`${tempIndexPath}\` |
| 临时 object 目录 | \`${tempObjectDir}\` |
| HEAD | ${headResult.stdout || "无"} |
| 预演 tree | ${writeTreeResult.status === 0 ? `\`${writeTreeResult.stdout}\`` : "未生成"} |
| 失败项数量 | ${failures.length} |
| 警告项数量 | ${warnings.length} |

## 预演结论

| 检查 | 结论 | 证据 |
|---|---|---|
| 提交安全检查 | ${safety ? (safety.failures?.length ? "未通过" : "通过") : "警告"} | ${safety ? `扫描 ${safety.scannedCount} 个文件，失败 ${safety.failures?.length ?? 0}` : "报告缺失"} |
| 提交计划 | ${plan?.simulatedStrictTracking?.ok ? "通过" : "警告"} | ${plan ? `${plan.requiredCount} 个必需文件，pathspec ${plan.pathspecCount} 项，未入库 ${plan.untracked?.length ?? 0} 个` : "报告缺失"} |
| 临时 index 初始化 | ${readTreeResult.status === 0 ? "通过" : "未通过"} | ${summarizeOutput(readTreeResult.stdout, readTreeResult.stderr)} |
| 临时 git add | ${addResult.status === 0 ? "通过" : "未通过"} | ${summarizeOutput(addResult.stdout, addResult.stderr)} |
| 临时 tree 写入 | ${writeTreeResult.status === 0 ? "通过" : "未通过"} | ${summarizeOutput(writeTreeResult.stdout, writeTreeResult.stderr)} |
| 必需文件进入预演 index | ${missingRequired.length === 0 ? "通过" : "未通过"} | ${missingRequired.length ? missingRequired.map((path) => `\`${path}\``).join("<br>") : `${requiredRows.length} / ${requiredRows.length}`} |

## 预演 Diff 统计

\`\`\`text
${diffStat.stdout || diffStat.stderr || "无变更"}
\`\`\`

## 预演文件变更

| 状态 | 文件 |
|---|---|
${changedRows.length ? changedRows.map((row) => `| ${cleanCell(row.status)} | \`${cleanCell(row.path)}\` |`).join("\n") : "| 无 | 无 |"}

## 后续命令

\`\`\`bash
npm run release:submission-safety -- --strict --write-doc
npm run release:submission-plan -- --strict --write-doc
npm run release:submission-preview -- --strict --write-doc
npm run release:push-readiness -- --write-doc
git add --pathspec-from-file=release/submission-pathspec.txt --pathspec-file-nul
npm run release:tracking -- --strict --write-doc
\`\`\`

> 本脚本只在临时 index / 临时 object 目录中预演提交内容，不执行 \`git add\`、\`git commit\` 或 \`git push\`。
`;

const report = {
  generatedAt,
  strict,
  pathspec: pathspecPath,
  pathspecCount: pathspecEntries.length,
  requiredCount: requiredPaths.length,
  head: headResult.stdout,
  tree: writeTreeResult.status === 0 ? writeTreeResult.stdout : "",
  tempIndex: tempIndexPath,
  tempObjectDir,
  failures,
  warnings,
  safety: safety
    ? {
        scannedCount: safety.scannedCount,
        failureCount: safety.failures?.length ?? 0,
        warningCount: safety.warnings?.length ?? 0,
      }
    : null,
  plan: plan
    ? {
        requiredCount: plan.requiredCount,
        pathspecCount: plan.pathspecCount,
        untrackedCount: plan.untracked?.length ?? 0,
        simulatedStrictTrackingOk: Boolean(plan.simulatedStrictTracking?.ok),
      }
    : null,
  commands: {
    readTree: readTreeResult,
    add: addResult,
    writeTree: writeTreeResult,
    diffNameStatus,
    diffStat,
  },
  requiredRows,
  changedRows,
};

write(outputMarkdown, markdown);
write(outputJson, `${JSON.stringify(report, null, 2)}\n`);
if (writeDoc) write(docPath, replaceAutoSection(docPath, markdown));

console.log(`Release submission preview written to ${outputMarkdown} and ${outputJson}.`);
console.log(`- Pathspec entries: ${pathspecEntries.length}`);
console.log(`- Required files: ${requiredPaths.length}`);
console.log(`- Preview tree: ${report.tree || "not generated"}`);
console.log(`- Failures: ${failures.length}`);

if (strict && failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}

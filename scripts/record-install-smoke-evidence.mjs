#!/usr/bin/env node
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

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function replaceAutoSection(path, section) {
  const start = "<!-- AUTO_INSTALL_MANUAL_EVIDENCE_START -->";
  const end = "<!-- AUTO_INSTALL_MANUAL_EVIDENCE_END -->";
  const previous = existsSync(path) ? readFileSync(path, "utf8") : "";
  const block = `${start}\n${section.trim()}\n${end}`;
  if (previous.includes(start) && previous.includes(end)) {
    return previous.replace(new RegExp(`${start}[\\s\\S]*?${end}`), block);
  }
  return previous.trim() ? `${previous.trimEnd()}\n\n## 安装人工验收记录\n\n${block}\n` : `${block}\n`;
}

function currentPlatform() {
  if (process.platform === "darwin") return "macos";
  if (process.platform === "win32") return "windows";
  return "linux";
}

const result = argValue("--result", "pending");
const platform = argValue("--platform", currentPlatform());
const artifactRoot = argValue("--artifact-root", "src-tauri/target/release/bundle");
const operator = argValue("--operator", process.env.USER ?? process.env.USERNAME ?? "unknown");
const note = argValue("--note", "");
const outputJson = argValue("--output-json", "release/manual-install-smoke.json");
const outputMarkdown = argValue("--output-md", "release/manual-install-smoke.md");
const docPath = argValue("--doc", "项目文档/发布安装人工验收记录.md");
const writeDoc = hasFlag("--write-doc");
const confirmAll = hasFlag("--confirm-all");
const checklist = [
  { key: "installed", label: "安装当前平台产物，系统没有拦截或损坏提示", ok: hasFlag("--installed") || confirmAll },
  { key: "opened", label: "打开 MoKnow 桌面应用", ok: hasFlag("--opened") || confirmAll },
  { key: "repository", label: "创建临时仓库或打开已有仓库", ok: hasFlag("--repository-ok") || confirmAll },
  { key: "markdown", label: "创建 Markdown 文件并保存内容", ok: hasFlag("--markdown-save-ok") || confirmAll },
  { key: "restart", label: "关闭并重启后仍能读取仓库和保存内容", ok: hasFlag("--restart-ok") || confirmAll },
  { key: "update", label: "执行检查应用更新并得到预期结果", ok: hasFlag("--update-check-ok") || confirmAll },
];

if (!["pending", "passed", "failed"].includes(result)) {
  console.error("--result must be one of: pending, passed, failed.");
  process.exit(1);
}

const missing = checklist.filter((item) => !item.ok);
if (result === "passed" && missing.length > 0) {
  console.error("Cannot record a passed manual install smoke result without confirming every checklist item.");
  for (const item of missing) console.error(`FAIL: ${item.label}`);
  console.error("Pass --confirm-all after completing the checklist, or pass each checklist flag explicitly.");
  process.exit(1);
}

const generatedAt = new Date().toISOString();
const status = result === "passed" ? "通过" : result === "failed" ? "未通过" : "待人工";
const report = {
  generatedAt,
  result,
  status,
  platform,
  artifactRoot,
  operator,
  note,
  checklist,
};

const markdown = `# 发布安装人工验收记录

| 项目 | 值 |
|---|---|
| 生成时间 | ${generatedAt} |
| 结果 | ${status} |
| 平台 | ${platform} |
| 产物目录 | ${artifactRoot} |
| 验收人 | ${operator} |
| 备注 | ${note || "无"} |

| 检查项 | 结论 |
|---|---|
${checklist.map((item) => `| ${item.label} | ${item.ok ? "通过" : "待确认"} |`).join("\n")}

> 本记录用于补充 \`release:install-smoke\` 的“实机打开与仓库读写”证据；它不包含敏感凭据。
`;

write(outputJson, `${JSON.stringify(report, null, 2)}\n`);
write(outputMarkdown, markdown);
if (writeDoc) {
  write(docPath, replaceAutoSection(docPath, markdown));
}

console.log(`Manual install smoke evidence written to ${outputMarkdown} and ${outputJson}.`);
console.log(`- Result: ${status}`);
console.log(`- Confirmed checklist items: ${checklist.filter((item) => item.ok).length}/${checklist.length}`);

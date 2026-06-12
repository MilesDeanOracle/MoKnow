#!/usr/bin/env node
import { spawnSync } from "node:child_process";
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

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    encoding: "utf8",
    shell: process.platform === "win32",
    input: options.input,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout?.trim() ?? "",
    stderr: result.stderr?.trim() ?? "",
  };
}

function detectRepository() {
  const remote = run("git", ["config", "--get", "remote.origin.url"]);
  const value = remote.stdout || "";
  const sshMatch = value.match(/github\.com[:/]([^/]+\/[^/.]+)(?:\.git)?$/i);
  const httpsMatch = value.match(/github\.com\/([^/]+\/[^/.]+)(?:\.git)?$/i);
  return sshMatch?.[1] ?? httpsMatch?.[1] ?? "MilesDeanOracle/MoKnow";
}

function configuredValue(name) {
  const value = process.env[name];
  return value && value.trim() ? value : "";
}

function safeStatus(name) {
  const value = configuredValue(name);
  if (!value) return "缺失";
  if (/URL|ENDPOINT|HOMEPAGE|TAP|MODEL|LABEL|ID|TEAM|ISSUER|PROVIDER/i.test(name)) {
    return value.length > 120 ? `${value.slice(0, 117)}...` : value;
  }
  return `<已配置，长度 ${value.length}>`;
}

function summarize(result) {
  return `${result.stdout}\n${result.stderr}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 6)
    .join("<br>") || "无输出";
}

function replaceAutoSection(path, section) {
  const start = "<!-- AUTO_RELEASE_SECRETS_SYNC_START -->";
  const end = "<!-- AUTO_RELEASE_SECRETS_SYNC_END -->";
  const previous = existsSync(path) ? readFileSync(path, "utf8") : "";
  const block = `${start}\n${section.trim()}\n${end}`;
  if (previous.includes(start) && previous.includes(end)) {
    return previous.replace(new RegExp(`${start}[\\s\\S]*?${end}`), block);
  }
  return previous.trim() ? `${previous.trimEnd()}\n\n## GitHub Actions Secrets 同步\n\n${block}\n` : `${block}\n`;
}

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

const secretDefinitions = [
  { name: "AI_E2E_ENDPOINT", group: "AI 真实联调", requiredFor: "AI final audit", secret: false },
  { name: "AI_E2E_MODEL", group: "AI 真实联调", requiredFor: "AI final audit", secret: false },
  { name: "AI_E2E_API_KEY", group: "AI 真实联调", requiredFor: "AI final audit", secret: true },
  { name: "AI_E2E_PROVIDER_LABEL", group: "AI 真实联调", requiredFor: "AI report label", secret: false },
  { name: "TAURI_SIGNING_PRIVATE_KEY", group: "Tauri updater", requiredFor: "updater signatures", secret: true },
  { name: "TAURI_SIGNING_PRIVATE_KEY_PASSWORD", group: "Tauri updater", requiredFor: "optional encrypted private key", secret: true },
  { name: "MOKNOW_UPDATER_PUBKEY", group: "Tauri updater", requiredFor: "updater config", secret: false },
  { name: "MOKNOW_UPDATER_ENDPOINT", group: "Tauri updater", requiredFor: "latest.json endpoint", secret: false },
  { name: "APPLE_CERTIFICATE", group: "macOS 签名", requiredFor: "Developer ID signing", secret: true },
  { name: "APPLE_CERTIFICATE_PASSWORD", group: "macOS 签名", requiredFor: "Developer ID signing", secret: true },
  { name: "APPLE_SIGNING_IDENTITY", group: "macOS 签名", requiredFor: "optional signing identity", secret: false },
  { name: "APPLE_ID", group: "macOS 公证", requiredFor: "Apple ID notarization", secret: false },
  { name: "APPLE_PASSWORD", group: "macOS 公证", requiredFor: "Apple ID notarization", secret: true },
  { name: "APPLE_TEAM_ID", group: "macOS 公证", requiredFor: "Apple ID notarization", secret: false },
  { name: "APPLE_API_KEY", group: "macOS 公证", requiredFor: "ASC API notarization", secret: true },
  { name: "APPLE_API_ISSUER", group: "macOS 公证", requiredFor: "ASC API notarization", secret: false },
  { name: "APPLE_PROVIDER_SHORT_NAME", group: "macOS 公证", requiredFor: "optional provider short name", secret: false },
  { name: "WINDOWS_CERTIFICATE", group: "Windows code signing", requiredFor: "Authenticode signing", secret: true },
  { name: "WINDOWS_CERTIFICATE_PASSWORD", group: "Windows code signing", requiredFor: "Authenticode signing", secret: true },
  { name: "MOKNOW_HOMEBREW_TAP", group: "分发", requiredFor: "Homebrew cask publishing", secret: false },
];

const requirementGroups = [
  ["AI_E2E_ENDPOINT", "AI_E2E_MODEL", "AI_E2E_API_KEY"],
  ["TAURI_SIGNING_PRIVATE_KEY"],
  ["MOKNOW_UPDATER_PUBKEY"],
  ["APPLE_CERTIFICATE", "APPLE_CERTIFICATE_PASSWORD"],
  ["WINDOWS_CERTIFICATE", "WINDOWS_CERTIFICATE_PASSWORD"],
  ["MOKNOW_HOMEBREW_TAP"],
];

const notarizationGroups = [
  ["APPLE_ID", "APPLE_PASSWORD", "APPLE_TEAM_ID"],
  ["APPLE_API_KEY", "APPLE_API_ISSUER"],
];

const repo = argValue("--repo", process.env.GITHUB_REPOSITORY ?? detectRepository());
const outputMarkdown = argValue("--output-md", "release/secrets-sync.md");
const outputJson = argValue("--output-json", "release/secrets-sync.json");
const docPath = argValue("--doc", "项目文档/发布Secrets同步记录.md");
const writeDoc = hasFlag("--write-doc");
const apply = hasFlag("--apply");
const strict = hasFlag("--strict");
const verify = hasFlag("--verify");
const generatedAt = new Date().toISOString();
const ghVersion = run("gh", ["--version"]);
const ghAuth = run("gh", ["auth", "status"]);

const items = secretDefinitions.map((definition) => {
  const value = configuredValue(definition.name);
  return {
    ...definition,
    configured: Boolean(value),
    status: safeStatus(definition.name),
    action: value ? (apply ? "sync" : "preview") : "skip",
  };
});

function groupComplete(group) {
  return group.every((name) => Boolean(configuredValue(name)));
}

const requiredMissing = [
  ...requirementGroups.filter((group) => !groupComplete(group)).flat(),
  ...(notarizationGroups.some(groupComplete) ? [] : notarizationGroups[0]),
].filter((name, index, all) => !configuredValue(name) && all.indexOf(name) === index);

const configuredItems = items.filter((item) => item.configured);
const applied = [];
let applyBlockedReason = "";

if (apply && (ghVersion.status !== 0 || ghAuth.status !== 0)) {
  applyBlockedReason = "GitHub CLI 不可用或未登录";
}

if (apply && !applyBlockedReason) {
  for (const item of configuredItems) {
    const result = run("gh", ["secret", "set", item.name, "--repo", repo, "--body-file", "-"], {
      input: configuredValue(item.name),
    });
    applied.push({
      name: item.name,
      ok: result.status === 0,
      summary: summarize(result),
    });
  }
}

let verifyResult;
if (verify) {
  verifyResult = run("npm", ["run", "release:secrets", "--", "--write-doc"]);
}

const rows = items
  .map(
    (item) =>
      `| \`${item.name}\` | ${item.group} | ${item.status} | ${item.action === "sync" ? "将同步/已同步" : item.action === "preview" ? "预览" : "跳过"} | ${item.requiredFor} |`,
  )
  .join("\n");

const appliedRows = applied.length
  ? applied.map((item) => `| \`${item.name}\` | ${item.ok ? "通过" : "失败"} | ${item.summary} |`).join("\n")
  : "| 无 | 未执行 | 默认预览模式，传入 `--apply` 后才写入 GitHub Secrets。 |";

const markdown = `# GitHub Actions Secrets 同步记录

| 项目 | 值 |
|---|---|
| 生成时间 | ${generatedAt} |
| 仓库 | ${repo} |
| 模式 | ${apply ? "写入远端" : "预览"} |
| 严格模式 | ${strict ? "是" : "否"} |
| GitHub CLI | ${ghVersion.status === 0 ? "可用" : "不可用"} |
| GitHub 登录 | ${ghAuth.status === 0 ? "通过" : "未通过"} |
| 可同步项数量 | ${configuredItems.length} |
| 缺失关键变量数量 | ${requiredMissing.length} |
| 写入阻断原因 | ${applyBlockedReason || "无"} |

| Secret | 分组 | 本机环境变量状态 | 动作 | 用途 |
|---|---|---|---|---|
${rows}

## 写入结果

| Secret | 结果 | 摘要 |
|---|---|---|
${appliedRows}

${verifyResult ? `## 同步后审计\n\n| 命令 | 结果 | 摘要 |\n|---|---|---|\n| \`npm run release:secrets -- --write-doc\` | ${verifyResult.status === 0 ? "通过" : "未通过"} | ${summarize(verifyResult)} |\n` : ""}
> 本报告只记录 secret 名称、是否配置、是否写入和命令摘要，不记录 secret 值。
`;

const report = {
  generatedAt,
  repo,
  apply,
  strict,
  ghOk: ghVersion.status === 0 && ghAuth.status === 0,
  configuredCount: configuredItems.length,
  requiredMissing,
  applyBlockedReason,
  items,
  applied,
  verify: verifyResult
    ? {
        status: verifyResult.status,
        ok: verifyResult.status === 0,
        summary: summarize(verifyResult),
      }
    : undefined,
};

write(outputMarkdown, markdown);
write(outputJson, `${JSON.stringify(report, null, 2)}\n`);
if (writeDoc) {
  write(docPath, replaceAutoSection(docPath, markdown));
}

console.log(`Release secrets sync report written to ${outputMarkdown} and ${outputJson}.`);
console.log(`- Mode: ${apply ? "apply" : "preview"}`);
console.log(`- Configured items: ${configuredItems.length}`);
console.log(`- Missing key variables: ${requiredMissing.length}`);
if (applyBlockedReason) console.log(`- Apply skipped: ${applyBlockedReason}`);

if (strict && requiredMissing.length > 0) {
  for (const name of requiredMissing) console.error(`FAIL: ${name} is not configured in the current environment.`);
  process.exit(1);
}

if (apply && applied.some((item) => !item.ok)) {
  for (const item of applied.filter((entry) => !entry.ok)) console.error(`FAIL: ${item.name} sync failed.`);
  process.exit(1);
}

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

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function summarize(result) {
  return `${result.stdout}\n${result.stderr}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8)
    .join("<br>") || "无输出";
}

function parseSecretList(result) {
  if (result.status !== 0) return [];
  try {
    const parsed = JSON.parse(result.stdout || "[]");
    if (Array.isArray(parsed)) {
      return parsed.map((item) => ({
        name: item.name,
        updatedAt: item.updatedAt ?? "",
      })).filter((item) => item.name);
    }
  } catch {
    // fall through to table parser
  }
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, ...rest] = line.split(/\s+/);
      return { name, updatedAt: rest.join(" ") };
    })
    .filter((item) => item.name && item.name !== "Name");
}

function secretMap(secrets) {
  return new Map(secrets.map((secret) => [secret.name, secret]));
}

function groupConfigured(group, available) {
  return group.every((name) => available.has(name));
}

function requirementConfigured(requirement, available) {
  if (requirement.env) return groupConfigured(requirement.env, available);
  return requirement.any.some((group) => groupConfigured(group, available));
}

function secretStatus(name, available) {
  const secret = available.get(name);
  return secret ? `已配置${secret.updatedAt ? `（更新：${secret.updatedAt}）` : ""}` : "缺失";
}

function requirementVariables(requirement, available) {
  if (requirement.env) {
    return requirement.env.map((name) => `\`${name}\`: ${secretStatus(name, available)}`).join("<br>");
  }
  return requirement.any
    .map((group, index) => `方案 ${index + 1}: ${group.map((name) => `\`${name}\`: ${secretStatus(name, available)}`).join("，")}`)
    .join("<br>");
}

function markdownTable(rows) {
  return [
    "| 项目 | 结论 | GitHub Secret 状态 | 备注 |",
    "|---|---|---|---|",
    ...rows.map((row) => `| ${row.label} | ${row.ok ? "通过" : "缺失"} | ${row.variables} | ${row.note} |`),
  ].join("\n");
}

function replaceAutoSection(path, section) {
  const start = "<!-- AUTO_RELEASE_SECRETS_AUDIT_START -->";
  const end = "<!-- AUTO_RELEASE_SECRETS_AUDIT_END -->";
  const previous = existsSync(path) ? readFileSync(path, "utf8") : "";
  const block = `${start}\n${section.trim()}\n${end}`;
  if (previous.includes(start) && previous.includes(end)) {
    return previous.replace(new RegExp(`${start}[\\s\\S]*?${end}`), block);
  }
  return previous.trim() ? `${previous.trimEnd()}\n\n## GitHub Actions Secrets 审计\n\n${block}\n` : `${block}\n`;
}

const requirements = [
  {
    label: "Tauri updater 签名私钥",
    env: ["TAURI_SIGNING_PRIVATE_KEY"],
    note: "生成 updater .sig；如私钥有密码，建议同时配置 TAURI_SIGNING_PRIVATE_KEY_PASSWORD。",
  },
  {
    label: "Tauri updater 公钥",
    env: ["MOKNOW_UPDATER_PUBKEY"],
    note: "Release workflow 生成 Tauri updater 配置所需公钥。",
  },
  {
    label: "macOS Developer ID 签名",
    env: ["APPLE_CERTIFICATE", "APPLE_CERTIFICATE_PASSWORD"],
    note: "用于 macOS app / DMG 签名；APPLE_SIGNING_IDENTITY 可选。",
  },
  {
    label: "macOS 公证",
    any: [
      ["APPLE_ID", "APPLE_PASSWORD", "APPLE_TEAM_ID"],
      ["APPLE_API_KEY", "APPLE_API_ISSUER"],
    ],
    note: "Apple ID 模式或 App Store Connect API 模式满足一组即可。",
  },
  {
    label: "Windows code signing",
    env: ["WINDOWS_CERTIFICATE", "WINDOWS_CERTIFICATE_PASSWORD"],
    note: "用于 Windows 安装包 Authenticode 签名。",
  },
  {
    label: "Homebrew tap",
    env: ["MOKNOW_HOMEBREW_TAP"],
    note: "正式 Homebrew 分发目标，例如 owner/homebrew-tap。",
  },
];

const optionalSecrets = [
  "TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
  "MOKNOW_UPDATER_ENDPOINT",
  "APPLE_SIGNING_IDENTITY",
  "APPLE_PROVIDER_SHORT_NAME",
];

const repo = argValue("--repo", "MilesDeanOracle/MoKnow");
const outputMarkdown = argValue("--output-md", "release/secrets-audit.md");
const outputJson = argValue("--output-json", "release/secrets-audit.json");
const docPath = argValue("--doc", "项目文档/发布Secrets审计记录.md");
const strict = hasFlag("--strict");
const writeDoc = hasFlag("--write-doc");
const generatedAt = new Date().toISOString();

const ghVersion = run("gh", ["--version"]);
const ghAuth = run("gh", ["auth", "status"]);
const secretsResult = run("gh", ["secret", "list", "--repo", repo, "--json", "name,updatedAt"]);
const secrets = parseSecretList(secretsResult);
const available = secretMap(secrets);
const rows = requirements.map((requirement) => ({
  ...requirement,
  ok: requirementConfigured(requirement, available),
  variables: requirementVariables(requirement, available),
}));
const optionalRows = optionalSecrets.map((name) => ({
  name,
  configured: available.has(name),
  status: secretStatus(name, available),
}));
const failures = rows.filter((row) => !row.ok);
const ghOk = ghVersion.status === 0 && ghAuth.status === 0 && secretsResult.status === 0;

const markdown = `# GitHub Actions Secrets 审计记录

| 项目 | 值 |
|---|---|
| 生成时间 | ${generatedAt} |
| 仓库 | ${repo} |
| GitHub CLI | ${ghVersion.status === 0 ? "可用" : "不可用"} |
| GitHub 登录 | ${ghAuth.status === 0 ? "通过" : "未通过"} |
| secrets 查询 | ${secretsResult.status === 0 ? "通过" : "未通过"} |
| 已发现 secret 数量 | ${secrets.length} |
| 严格模式 | ${strict ? "是" : "否"} |
| 缺失项数量 | ${failures.length} |

${markdownTable(rows)}

## 可选 Secret

| Secret | 状态 |
|---|---|
${optionalRows.map((row) => `| \`${row.name}\` | ${row.status} |`).join("\n")}

## 命令摘要

| 命令 | 摘要 |
|---|---|
| \`gh --version\` | ${summarize(ghVersion)} |
| \`gh auth status\` | ${summarize(ghAuth)} |
| \`gh secret list --repo ${repo}\` | ${summarize(secretsResult)} |

> 本报告只列出 secret 名称是否存在和更新时间，不读取或记录 secret 值。
`;

const report = {
  generatedAt,
  repo,
  strict,
  ghOk,
  secretCount: secrets.length,
  failures: failures.map((row) => row.label),
  requirements: rows.map((row) => ({
    label: row.label,
    status: row.ok ? "passed" : "missing",
    note: row.note,
    variables: row.env
      ? row.env.map((name) => ({ name, configured: available.has(name), updatedAt: available.get(name)?.updatedAt ?? "" }))
      : row.any.map((group, index) => ({
          option: index + 1,
          variables: group.map((name) => ({ name, configured: available.has(name), updatedAt: available.get(name)?.updatedAt ?? "" })),
        })),
  })),
  optionalSecrets: optionalRows,
};

mkdirSync(dirname(outputMarkdown), { recursive: true });
writeFileSync(outputMarkdown, markdown, "utf8");
writeFileSync(outputJson, `${JSON.stringify(report, null, 2)}\n`, "utf8");
if (writeDoc) {
  mkdirSync(dirname(docPath), { recursive: true });
  writeFileSync(docPath, replaceAutoSection(docPath, markdown), "utf8");
}

console.log(`Release secrets audit written to ${outputMarkdown} and ${outputJson}.`);
for (const row of rows) console.log(`- ${row.label}: ${row.ok ? "passed" : "missing"}`);

if (strict && (!ghOk || failures.length > 0)) {
  if (!ghOk) console.error("FAIL: GitHub CLI, auth, or secret list query failed.");
  for (const failure of failures) console.error(`FAIL: ${failure.label}`);
  process.exit(1);
}

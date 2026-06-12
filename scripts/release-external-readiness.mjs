#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const args = process.argv.slice(2);

function argValue(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

function hasFlag(name) {
  return args.includes(name);
}

function redactedValue(name) {
  const value = process.env[name];
  if (!value) return "缺失";
  if (/URL|ENDPOINT|HOMEPAGE|TAP|MODEL|ID|TEAM|ISSUER|PROVIDER/i.test(name)) {
    return value.length > 96 ? `${value.slice(0, 93)}...` : value;
  }
  return `<已配置，长度 ${value.length}>`;
}

function groupSatisfied(group) {
  return group.every((name) => Boolean(process.env[name]));
}

function requirementSatisfied(requirement) {
  if (requirement.env) return groupSatisfied(requirement.env);
  return requirement.any.some(groupSatisfied);
}

function statusText(ok) {
  return ok ? "通过" : "缺失";
}

function envList(names) {
  return names.map((name) => `\`${name}\`: ${redactedValue(name)}`).join("<br>");
}

function requirementRows(requirements) {
  return requirements.map((requirement) => {
    const ok = requirementSatisfied(requirement);
    const needed = requirement.env
      ? envList(requirement.env)
      : requirement.any.map((group, index) => `方案 ${index + 1}: ${envList(group)}`).join("<br>");
    return `| ${requirement.label} | ${statusText(ok)} | ${needed} | ${requirement.note} |`;
  });
}

function jsonRequirement(requirement) {
  return {
    label: requirement.label,
    status: requirementSatisfied(requirement) ? "passed" : "missing",
    note: requirement.note,
    variables: requirement.env
      ? requirement.env.map((name) => ({ name, configured: Boolean(process.env[name]) }))
      : requirement.any.map((group, index) => ({
          option: index + 1,
          variables: group.map((name) => ({ name, configured: Boolean(process.env[name]) })),
        })),
  };
}

const requirements = [
  {
    label: "AI 真实外部 Provider 联调",
    env: ["AI_E2E_ENDPOINT", "AI_E2E_MODEL", "AI_E2E_API_KEY"],
    note: "用于执行 npm run ai:e2e 并生成真实外部模型联调记录。",
  },
  {
    label: "Tauri updater 签名",
    env: ["TAURI_SIGNING_PRIVATE_KEY"],
    note: "用于生成 updater bundle 的 .sig 文件；如私钥有密码，还需 TAURI_SIGNING_PRIVATE_KEY_PASSWORD。",
  },
  {
    label: "Tauri updater 公钥与端点",
    env: ["MOKNOW_UPDATER_PUBKEY", "MOKNOW_RELEASE_DOWNLOAD_BASE_URL"],
    note: "release:updater-config 会用这些值生成 pubkey 和 latest.json endpoint。",
  },
  {
    label: "macOS Developer ID 签名",
    env: ["APPLE_CERTIFICATE", "APPLE_CERTIFICATE_PASSWORD"],
    note: "用于 macOS app / dmg 签名；APPLE_SIGNING_IDENTITY 可选。",
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
    any: [
      ["WINDOWS_CERTIFICATE", "WINDOWS_CERTIFICATE_PASSWORD"],
      ["TAURI_WINDOWS_SIGNTOOL_PATH"],
    ],
    note: "证书模式或自定义 signtool / 云签名命令满足一组即可。",
  },
  {
    label: "下载与官网分发 URL",
    env: ["MOKNOW_RELEASE_DOWNLOAD_BASE_URL", "MOKNOW_HOMEPAGE_URL"],
    note: "用于 downloads.json、Homebrew cask、官网/项目主页链接。",
  },
  {
    label: "Homebrew tap",
    env: ["MOKNOW_HOMEBREW_TAP"],
    note: "用于记录正式 cask 发布目标，例如 owner/homebrew-tap。",
  },
];

const outputMarkdown = argValue("--output-md", "release/external-readiness.md");
const outputJson = argValue("--output-json", "release/external-readiness.json");
const docPath = argValue("--doc", "项目文档/发布外部配置清单.md");
const strict = hasFlag("--strict");
const writeDoc = hasFlag("--write-doc");
const generatedAt = new Date().toISOString();
const rows = requirementRows(requirements);
const missing = requirements.filter((requirement) => !requirementSatisfied(requirement));

const markdown = `# 发布外部配置清单

| 项目 | 值 |
|---|---|
| 生成时间 | ${generatedAt} |
| 严格模式 | ${strict ? "是" : "否"} |
| 缺失项数量 | ${missing.length} |

| 外部项 | 状态 | 环境变量状态 | 说明 |
|---|---|---|---|
${rows.join("\n")}

## 使用方式

\`\`\`bash
npm run release:readiness
npm run release:readiness -- --strict --write-doc
\`\`\`

> 报告只显示变量是否配置和少量非敏感标识，不写入 API Key、证书、私钥或密码。
`;

const json = {
  generatedAt,
  strict,
  missingCount: missing.length,
  requirements: requirements.map(jsonRequirement),
};

mkdirSync(dirname(outputMarkdown), { recursive: true });
writeFileSync(outputMarkdown, markdown, "utf8");
writeFileSync(outputJson, `${JSON.stringify(json, null, 2)}\n`, "utf8");
if (writeDoc) {
  mkdirSync(dirname(docPath), { recursive: true });
  writeFileSync(docPath, markdown, "utf8");
}

console.log(`Release external readiness written to ${outputMarkdown} and ${outputJson}.`);
for (const requirement of requirements) {
  console.log(`- ${requirement.label}: ${statusText(requirementSatisfied(requirement))}`);
}

if (strict && missing.length > 0) {
  for (const requirement of missing) {
    console.error(`FAIL: ${requirement.label} is not configured.`);
  }
  process.exit(1);
}

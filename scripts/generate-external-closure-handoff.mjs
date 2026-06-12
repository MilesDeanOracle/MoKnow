#!/usr/bin/env node
import { spawnSync } from "node:child_process";
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

function detectRepository() {
  const remote = run("git", ["config", "--get", "remote.origin.url"]);
  const value = remote.stdout || "";
  const sshMatch = value.match(/github\.com[:/]([^/]+\/[^/.]+)(?:\.git)?$/i);
  const httpsMatch = value.match(/github\.com\/([^/]+\/[^/.]+)(?:\.git)?$/i);
  return sshMatch?.[1] ?? httpsMatch?.[1] ?? "OWNER/REPO";
}

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function codeBlock(language, lines) {
  return `\`\`\`${language}\n${lines.join("\n")}\n\`\`\``;
}

const outputMarkdown = argValue("--output-md", "release/external-closure-handoff.md");
const outputJson = argValue("--output-json", "release/external-closure-handoff.json");
const outputEnv = argValue("--output-env", "release/external-closure.env.example");
const docPath = argValue("--doc", "项目文档/发布外部闭环交接清单.md");
const docEnvPath = argValue("--doc-env", "项目文档/发布外部闭环环境变量模板.env");
const writeDoc = hasFlag("--write-doc");
const generatedAt = new Date().toISOString();
const repository = argValue("--repo", process.env.GITHUB_REPOSITORY ?? detectRepository());
const releaseVersion = argValue("--version", process.env.MOKNOW_RELEASE_VERSION ?? "v0.1.0");
const releaseBaseUrl = `https://github.com/${repository}/releases/download/${releaseVersion}`;
const homepageUrl = `https://github.com/${repository}`;
const updaterEndpoint = `https://github.com/${repository}/releases/latest/download/latest.json`;

const localEnvTemplate = [
  "# MoKnow external closure environment template.",
  "# Copy this file to a local shell script, fill real values, then source it.",
  "# Do not commit real secrets.",
  "",
  `export GITHUB_REPOSITORY="${repository}"`,
  `export MOKNOW_RELEASE_VERSION="${releaseVersion}"`,
  "",
  "# Real OpenAI-compatible AI provider E2E.",
  'export AI_E2E_ENDPOINT="<https://provider.example/v1>"',
  'export AI_E2E_MODEL="<model-name>"',
  'export AI_E2E_API_KEY="<api-key>"',
  'export AI_E2E_PROVIDER_LABEL="<provider-name>"',
  "",
  "# Tauri updater and distribution URLs.",
  'export TAURI_SIGNING_PRIVATE_KEY="<tauri-updater-private-key>"',
  'export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="<optional-private-key-password>"',
  'export MOKNOW_UPDATER_PUBKEY="<tauri-updater-public-key>"',
  `export MOKNOW_RELEASE_DOWNLOAD_BASE_URL="${releaseBaseUrl}"`,
  `export MOKNOW_UPDATER_ENDPOINT="${updaterEndpoint}"`,
  `export MOKNOW_HOMEPAGE_URL="${homepageUrl}"`,
  'export MOKNOW_HOMEBREW_TAP="<owner/homebrew-tap>"',
  "",
  "# macOS Developer ID signing and notarization.",
  'export APPLE_CERTIFICATE="<base64-p12-certificate>"',
  'export APPLE_CERTIFICATE_PASSWORD="<certificate-password>"',
  'export APPLE_SIGNING_IDENTITY="<optional-developer-id-application-identity>"',
  'export APPLE_ID="<apple-id-email>"',
  'export APPLE_PASSWORD="<app-specific-password>"',
  'export APPLE_TEAM_ID="<team-id>"',
  "# Alternative notarization mode, if the release workflow is adjusted to use API key files:",
  '# export APPLE_API_KEY="<app-store-connect-api-key-id>"',
  '# export APPLE_API_ISSUER="<app-store-connect-issuer-id>"',
  "",
  "# Windows code signing.",
  'export WINDOWS_CERTIFICATE="<base64-pfx-certificate>"',
  'export WINDOWS_CERTIFICATE_PASSWORD="<certificate-password>"',
  "",
];

const ghSecretCommands = [
  "# Preferred safe flow: preview first, then add --apply when the report looks right.",
  "npm run release:secrets:sync -- --write-doc",
  "npm run release:secrets:sync -- --apply --verify --write-doc",
  "",
  "# Manual fallback. Run these after replacing placeholders. Values are sent through stdin and are not echoed by gh.",
  `printf '%s' '<tauri-updater-private-key>' | gh secret set TAURI_SIGNING_PRIVATE_KEY --repo ${repository} --body-file -`,
  `printf '%s' '<optional-private-key-password>' | gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo ${repository} --body-file -`,
  `printf '%s' '<tauri-updater-public-key>' | gh secret set MOKNOW_UPDATER_PUBKEY --repo ${repository} --body-file -`,
  `printf '%s' '${updaterEndpoint}' | gh secret set MOKNOW_UPDATER_ENDPOINT --repo ${repository} --body-file -`,
  "base64 -i /path/to/apple-developer-id.p12 | gh secret set APPLE_CERTIFICATE --repo " +
    repository +
    " --body-file -",
  `printf '%s' '<apple-certificate-password>' | gh secret set APPLE_CERTIFICATE_PASSWORD --repo ${repository} --body-file -`,
  `printf '%s' '<apple-developer-id-application-identity>' | gh secret set APPLE_SIGNING_IDENTITY --repo ${repository} --body-file -`,
  `printf '%s' '<apple-id-email>' | gh secret set APPLE_ID --repo ${repository} --body-file -`,
  `printf '%s' '<apple-app-specific-password>' | gh secret set APPLE_PASSWORD --repo ${repository} --body-file -`,
  `printf '%s' '<apple-team-id>' | gh secret set APPLE_TEAM_ID --repo ${repository} --body-file -`,
  "base64 -i /path/to/windows-code-signing.pfx | gh secret set WINDOWS_CERTIFICATE --repo " +
    repository +
    " --body-file -",
  `printf '%s' '<windows-certificate-password>' | gh secret set WINDOWS_CERTIFICATE_PASSWORD --repo ${repository} --body-file -`,
  `printf '%s' '<owner/homebrew-tap>' | gh secret set MOKNOW_HOMEBREW_TAP --repo ${repository} --body-file -`,
];

const aiCommands = [
  "npm run ai:e2e:auto -- --write-doc",
  "npm run ai:e2e:preflight -- --strict --write-doc",
  "npm run ai:e2e",
  "npm run ai:e2e -- --stream",
];

const ciCommands = [
  "npm run release:submit-prep -- --write-doc",
  "npm run release:submission-safety -- --write-doc",
  "npm run release:submission-plan -- --write-doc",
  "npm run release:submission-manifest -- --write-doc",
  "npm run release:submission-preview -- --write-doc",
  "npm run release:push-readiness -- --write-doc",
  "git add --pathspec-from-file=release/submission-pathspec.txt --pathspec-file-nul",
  "npm run release:tracking -- --strict --write-doc",
  "npm run release:ci-preflight -- --strict --write-doc",
  "npm run release:workflow-validate -- --strict --write-doc",
  "npm run release:dry-run -- --write-doc",
  "npm run release:remote-status -- --strict --write-doc",
  "npm run release:downloads -- --artifact-root release/downloaded-artifacts --platform all --write-doc",
  "# After manually installing and testing the downloaded artifacts, record the result:",
  "npm run release:install-manual -- --result passed --confirm-all --artifact-root release/downloaded-artifacts --platform all --write-doc",
  "npm run release:install-smoke -- --artifact-root release/downloaded-artifacts --platform all --write-doc",
  "npm run release:aggregate-evidence -- --artifact-root release/downloaded-artifacts",
];

const signingCommands = [
  "npm run release:secrets:sync -- --write-doc",
  "npm run release:secrets:sync -- --apply --verify --write-doc",
  "npm run release:secrets -- --strict --write-doc",
  "npm run release:readiness -- --strict --write-doc",
  "npm run release:check -- --strict-external",
  "npm run release:updater-config",
  "npm run release:metadata -- --require-base-url --require-updater-signatures",
  "npm run release:signing -- --require-signed --require-notarized --write-doc",
  "npm run release:distribution -- --strict --require-reachable --write-doc",
  "npm run release:final-audit -- --refresh --strict --write-doc",
];

const markdown = `# 发布外部闭环交接清单

| 项目 | 值 |
|---|---|
| 生成时间 | ${generatedAt} |
| GitHub 仓库 | \`${repository}\` |
| 示例 Release 版本 | \`${releaseVersion}\` |
| 示例下载 Base URL | \`${releaseBaseUrl}\` |
| 示例 updater endpoint | \`${updaterEndpoint}\` |

## 覆盖的未完成项

| 未完成项 | 需要补齐的外部证据 | 验收命令 |
|---|---|---|
| 真实外部模型端到端联调记录 | 真实 Provider 非流式和流式请求成功，且生成 \`release/ai-e2e.json\` 与 \`项目文档/AI外部模型联调记录.md\` | \`npm run ai:e2e:auto -- --write-doc\`、\`npm run ai:e2e\`、\`npm run ai:e2e -- --stream\` |
| 三平台完整构建验证、CI 实跑验证、发布产物下载验证 | 远端 workflow 可触发，macOS / Windows / Linux artifacts 可下载，安装入口和人工打开读写完成 | \`npm run release:dry-run -- --write-doc\`、\`npm run release:downloads -- --platform all --write-doc\`、\`npm run release:install-smoke -- --platform all --write-doc\` |
| macOS 签名、公证、Windows code signing、真实自动更新实发、Homebrew / 官网分发 | GitHub secrets 存在，签名/公证通过，updater \`.sig\` 与 \`latest.json\` 有平台条目，下载 URL / updater endpoint / Homebrew cask / 官网 URL 可达 | \`npm run release:secrets -- --strict --write-doc\`、\`npm run release:signing -- --require-signed --require-notarized --write-doc\`、\`npm run release:distribution -- --strict --require-reachable --write-doc\` |

## 本机环境变量模板

模板已同时写入 \`${outputEnv}\`${writeDoc ? ` 和 \`${docEnvPath}\`` : ""}。

${codeBlock("bash", localEnvTemplate)}

## GitHub Actions secrets 设置命令

${codeBlock("bash", ghSecretCommands)}

## AI 真实联调验收

${codeBlock("bash", aiCommands)}

验收证据：

| 文件 | 应证明 |
|---|---|
| \`release/ai-e2e.json\` | \`responseNonEmpty=true\`，HTTP 状态为 2xx，且记录真实 provider / model |
| \`项目文档/AI外部模型联调记录.md\` | 有最近一次真实外部模型请求记录，不包含 API Key |
| \`项目文档/项目进度.md\` | 最终审计表中“真实外部模型端到端联调记录”为完成 |

## 远端三平台 CI 与产物验收

先生成安全 pathspec 并把发布闭环文件纳入 git，再提交并推送 workflow / 发布脚本 / 文档后执行：

${codeBlock("bash", ciCommands)}

验收证据：

| 文件 | 应证明 |
|---|---|
| \`release/ci-preflight.json\` | workflow 已被 git 跟踪，远端 workflow 可读取，可触发 dry-run |
| \`release/download-verification.json\` | macOS / Windows / Linux 安装包均通过 |
| \`release/install-smoke.json\` | 三平台安装包入口通过，人工打开读写清单已补齐 |
| \`release/aggregate-evidence.json\` | 三平台 artifacts 中的安装和签名报告已聚合 |

## 签名、公证、自动更新与分发验收

${codeBlock("bash", signingCommands)}

验收证据：

| 文件 | 应证明 |
|---|---|
| \`release/secrets-audit.json\` | updater、macOS、Windows、Homebrew 所需 secrets 均存在 |
| \`release/external-readiness.json\` | 外部发布配置全部通过 |
| \`release/signing-verification.json\` | macOS 签名、公证、Windows Authenticode 均通过 |
| \`release/latest.json\` | 至少包含一个平台更新条目，正式发布时应覆盖目标平台 |
| \`release/distribution-verification.json\` | 下载 URL、updater endpoint、Homebrew cask URL、官网 URL 均为真实可达 HTTPS |
| \`项目文档/项目进度.md\` | 最终审计表中 3 个未完成项均为完成 |

## 最终闭环判定

所有外部项配置完成后，先运行项目进度外部闭环总门禁，再保留最终审计作为项目进度落表依据：

${codeBlock("bash", [
  "npm run release:closure -- --strict --write-doc",
  "npm run release:final-audit -- --refresh --strict --write-doc",
])}

这两个命令都通过时，才可以把 \`项目文档/项目进度.md\` 中对应 3 个未完成项改为完成。
`;

const json = {
  generatedAt,
  repository,
  releaseVersion,
  releaseBaseUrl,
  homepageUrl,
  updaterEndpoint,
  outputs: {
    markdown: outputMarkdown,
    json: outputJson,
    env: outputEnv,
    doc: writeDoc ? docPath : null,
    docEnv: writeDoc ? docEnvPath : null,
  },
  commands: {
    githubSecrets: ghSecretCommands,
    ai: aiCommands,
    ci: ciCommands,
    signingAndDistribution: signingCommands,
    finalGate: [
      "npm run release:closure -- --strict --write-doc",
      "npm run release:final-audit -- --refresh --strict --write-doc",
    ],
  },
};

write(outputMarkdown, markdown);
write(outputJson, `${JSON.stringify(json, null, 2)}\n`);
write(outputEnv, `${localEnvTemplate.join("\n")}\n`);

if (writeDoc) {
  write(docPath, markdown);
  write(docEnvPath, `${localEnvTemplate.join("\n")}\n`);
}

console.log(`External closure handoff written to ${outputMarkdown}, ${outputJson}, and ${outputEnv}.`);
if (writeDoc) {
  console.log(`Project docs written to ${docPath} and ${docEnvPath}.`);
}
console.log("- AI closure commands:", aiCommands.length);
console.log("- CI closure commands:", ciCommands.length);
console.log("- signing/distribution closure commands:", signingCommands.length);

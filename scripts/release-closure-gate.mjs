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

function summarizeOutput(result) {
  const lines = `${result.stdout}\n${result.stderr}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.slice(-10).join("<br>") || "无输出";
}

function readJson(path) {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

function aiEvidenceOk() {
  const auto = readJson("release/ai-e2e-auto.json");
  const e2e = readJson("release/ai-e2e.json");
  const e2eOk = Boolean(e2e?.responseNonEmpty && e2e?.httpStatus >= 200 && e2e?.httpStatus < 300);
  return Boolean(auto?.passed || e2eOk);
}

function cleanCell(value) {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replace(/\r?\n/g, "<br>")
    .trim();
}

function commandText(command, commandArgs) {
  return [command, ...commandArgs].join(" ");
}

function replaceAutoSection(path, section) {
  const start = "<!-- AUTO_RELEASE_CLOSURE_GATE_START -->";
  const end = "<!-- AUTO_RELEASE_CLOSURE_GATE_END -->";
  const previous = existsSync(path) ? readFileSync(path, "utf8") : "";
  const block = `${start}\n${section.trim()}\n${end}`;
  if (previous.includes(start) && previous.includes(end)) {
    return previous.replace(new RegExp(`${start}[\\s\\S]*?${end}`), block);
  }
  return previous.trim() ? `${previous.trimEnd()}\n\n## 外部闭环总门禁\n\n${block}\n` : `${block}\n`;
}

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

const strict = hasFlag("--strict");
const writeDoc = hasFlag("--write-doc");
const artifactRoot = argValue("--artifact-root", "release/downloaded-artifacts");
const outputMarkdown = argValue("--output-md", "release/closure-gate.md");
const outputJson = argValue("--output-json", "release/closure-gate.json");
const docPath = argValue("--doc", "项目文档/发布外部闭环总门禁记录.md");
const generatedAt = new Date().toISOString();

const unfinishedItems = {
  ai: "真实外部模型端到端联调记录",
  ci: "三平台完整构建验证、CI 实跑验证、发布产物下载验证",
  signing: "macOS 签名、公证、Windows code signing、真实自动更新实发、Homebrew / 官网分发",
};

if (writeDoc && !existsSync(docPath)) {
  write(
    docPath,
    replaceAutoSection(
      docPath,
      `# 发布外部闭环总门禁记录\n\n| 项目 | 值 |\n|---|---|\n| 生成时间 | ${generatedAt} |\n| 状态 | 正在生成，等待 release:closure 完整报告写回 |`,
    ),
  );
}

const steps = [
  {
    id: "submit-prep",
    stage: "提交与远端 CI 前置",
    unfinished: ["ci"],
    command: "npm",
    args: ["run", "release:submit-prep", "--", "--write-doc"],
    purpose: "一键刷新提交安全、提交计划、提交预演、推送准备和 CI 预检报告，不执行真实 git add/commit/push。",
  },
  {
    id: "submission-safety",
    stage: "提交与远端 CI 前置",
    unfinished: ["ci"],
    command: "npm",
    args: ["run", "release:submission-safety", "--", "--write-doc"],
    purpose: "扫描即将入库的发布闭环文件，确认不包含密钥、证书、私钥、生成产物或额外 pathspec。",
  },
  {
    id: "submission-plan",
    stage: "提交与远端 CI 前置",
    unfinished: ["ci"],
    command: "npm",
    args: ["run", "release:submission-plan", "--", "--write-doc"],
    purpose: "生成 NUL 分隔 pathspec 和提交入库计划，明确需要纳入 git 的 workflow、脚本和项目文档。",
  },
  {
    id: "submission-preview",
    stage: "提交与远端 CI 前置",
    unfinished: ["ci"],
    command: "npm",
    args: ["run", "release:submission-preview", "--", "--write-doc"],
    purpose: "用临时 index / object 目录预演提交内容，生成 tree、diff 统计和必需文件入库证据。",
  },
  {
    id: "submission-manifest",
    stage: "提交与远端 CI 前置",
    unfinished: ["ci"],
    command: "npm",
    args: ["run", "release:submission-manifest", "--", "--write-doc"],
    purpose: "生成待提交文件 SHA-256 校验清单，方便入库前核对内容没有漂移。",
  },
  {
    id: "push-readiness",
    stage: "提交与远端 CI 前置",
    unfinished: ["ci"],
    command: "npm",
    args: ["run", "release:push-readiness", "--", "--write-doc"],
    purpose: "记录当前分支、upstream、提交计划和远端 workflow 状态，生成推送前 readiness 证据。",
  },
  {
    id: "tracking",
    stage: "提交与远端 CI 前置",
    unfinished: ["ci"],
    command: "npm",
    args: ["run", "release:tracking", "--", "--strict", "--write-doc"],
    purpose: "确认 workflow、发布脚本和项目文档已纳入 git，避免远端 workflow 404。",
  },
  {
    id: "ai-preflight",
    stage: "AI 真实联调",
    unfinished: ["ai"],
    command: "npm",
    args: ["run", "ai:e2e:preflight", "--", "--strict", "--write-doc"],
    purpose: "严格检查真实 Provider endpoint、model、API Key 和安全协议。",
  },
  {
    id: "ai-auto",
    stage: "AI 真实联调",
    unfinished: ["ai"],
    command: "npm",
    args: ["run", "ai:e2e:auto", "--", "--write-doc"],
    purpose: "自动探测环境变量、Ollama 或 LM Studio 并尝试生成真实 AI E2E 证据。",
  },
  {
    id: "ci-preflight",
    stage: "三平台 CI 与产物",
    unfinished: ["ci"],
    command: "npm",
    args: ["run", "release:ci-preflight", "--", "--strict", "--write-doc"],
    purpose: "确认 GitHub CLI、远端 workflow 和 dry-run 触发条件满足。",
  },
  {
    id: "workflow-validate",
    stage: "三平台 CI 与产物",
    unfinished: ["ci"],
    command: "npm",
    args: ["run", "release:workflow-validate", "--", "--strict", "--write-doc"],
    purpose: "结构化解析 Release / Release Dry Run workflow，验证三平台矩阵、build/verify job 和 artifacts 证据链。",
  },
  {
    id: "remote-status",
    stage: "三平台 CI 与产物",
    unfinished: ["ci"],
    command: "npm",
    args: ["run", "release:remote-status", "--", "--strict", "--write-doc"],
    purpose: "读取远端 Release / Release Dry Run workflow、最近 runs、artifacts 和 GitHub Release 状态。",
  },
  {
    id: "downloads",
    stage: "三平台 CI 与产物",
    unfinished: ["ci"],
    command: "npm",
    args: [
      "run",
      "release:downloads",
      "--",
      "--artifact-root",
      artifactRoot,
      "--platform",
      "all",
      "--require-metadata",
      "--write-doc",
    ],
    purpose: "验证下载后的 macOS、Windows、Linux artifacts 和分发元数据完整性。",
  },
  {
    id: "install-smoke",
    stage: "三平台 CI 与产物",
    unfinished: ["ci"],
    command: "npm",
    args: ["run", "release:install-smoke", "--", "--artifact-root", artifactRoot, "--platform", "all", "--write-doc"],
    purpose: "验证三平台安装包入口，并读取人工安装打开读写验收记录。",
  },
  {
    id: "secrets",
    stage: "签名、公证与分发",
    unfinished: ["signing"],
    command: "npm",
    args: ["run", "release:secrets", "--", "--strict", "--write-doc"],
    purpose: "严格审计 GitHub Actions secrets 名称是否已配置。",
  },
  {
    id: "readiness",
    stage: "签名、公证与分发",
    unfinished: ["signing"],
    command: "npm",
    args: ["run", "release:readiness", "--", "--strict", "--write-doc"],
    purpose: "严格检查 AI、updater、签名、公证、下载 URL 和 Homebrew tap 外部配置。",
  },
  {
    id: "release-check",
    stage: "签名、公证与分发",
    unfinished: ["signing"],
    command: "npm",
    args: ["run", "release:check", "--", "--strict-external"],
    purpose: "把静态发布检查与外部变量要求合并为正式发布前门禁。",
  },
  {
    id: "signing",
    stage: "签名、公证与分发",
    unfinished: ["signing"],
    command: "npm",
    args: [
      "run",
      "release:signing",
      "--",
      "--artifact-root",
      artifactRoot,
      "--platform",
      "all",
      "--require-signed",
      "--require-notarized",
      "--write-doc",
    ],
    purpose: "严格验证 macOS 签名公证、Windows Authenticode 和 Linux 签名策略。",
  },
  {
    id: "metadata",
    stage: "签名、公证与分发",
    unfinished: ["signing"],
    command: "npm",
    args: ["run", "release:metadata", "--", "--require-base-url", "--require-updater-signatures"],
    purpose: "要求真实下载 Base URL 和 updater 签名后生成 latest.json / downloads.json / Homebrew cask。",
  },
  {
    id: "distribution",
    stage: "签名、公证与分发",
    unfinished: ["signing"],
    command: "npm",
    args: ["run", "release:distribution", "--", "--strict", "--require-reachable", "--write-doc"],
    purpose: "严格验证下载 URL、updater endpoint、Homebrew cask 和官网 / 项目主页可达性。",
  },
  {
    id: "final-audit",
    stage: "最终进度审计",
    unfinished: ["ai", "ci", "signing"],
    command: "npm",
    args: ["run", "release:final-audit", "--", "--refresh", "--strict", "--write-doc"],
    purpose: "对照项目进度的 3 个未完成项做最终证据审计。",
  },
];

const results = steps.map((step) => {
  const result = run(step.command, step.args);
  const commandOk = result.status === 0;
  const evidenceOk = step.id === "ai-auto" ? aiEvidenceOk() : commandOk;
  return {
    ...step,
    commandText: commandText(step.command, step.args),
    ok: commandOk && evidenceOk,
    exitCode: result.status,
    summary:
      commandOk && !evidenceOk
        ? `${summarizeOutput(result)}<br>FAIL: 未发现真实 Provider 或成功 AI E2E 证据`
        : summarizeOutput(result),
  };
});

const failedResults = results.filter((result) => !result.ok);
const statusByItem = Object.fromEntries(
  Object.entries(unfinishedItems).map(([key, label]) => {
    const related = results.filter((result) => result.unfinished.includes(key));
    const failures = related.filter((result) => !result.ok);
    return [
      key,
      {
        label,
        ok: failures.length === 0,
        passed: related.length - failures.length,
        total: related.length,
        failures: failures.map((result) => result.id),
      },
    ];
  }),
);

const markdown = `# 发布外部闭环总门禁记录

| 项目 | 值 |
|---|---|
| 生成时间 | ${generatedAt} |
| 严格模式 | ${strict ? "是" : "否"} |
| Artifact 根目录 | \`${artifactRoot}\` |
| 门禁步骤数量 | ${results.length} |
| 失败步骤数量 | ${failedResults.length} |

## 未完成项闭环状态

| 未完成项 | 结论 | 通过步骤 | 失败步骤 |
|---|---|---|---|
${Object.values(statusByItem)
  .map(
    (item) =>
      `| ${item.label} | ${item.ok ? "可闭环" : "未闭环"} | ${item.passed}/${item.total} | ${
        item.failures.length > 0 ? item.failures.join("、") : "无"
      } |`,
  )
  .join("\n")}

## 严格门禁步骤

| 阶段 | 关联未完成项 | 命令 | 结果 | 目的 | 摘要 |
|---|---|---|---|---|---|
${results
  .map(
    (result) =>
      `| ${cleanCell(result.stage)} | ${cleanCell(result.unfinished.map((key) => unfinishedItems[key]).join("<br>"))} | \`${cleanCell(
        result.commandText,
      )}\` | ${result.ok ? "通过" : `未通过（exit ${result.exitCode}）`} | ${cleanCell(result.purpose)} | ${cleanCell(result.summary)} |`,
  )
  .join("\n")}

> 该门禁不会写入远端 secrets，也不会触发 GitHub Actions；它只运行本地和 GitHub CLI 只读检查，并把仍需外部配置或远端实跑的阻断点集中记录。
`;

const report = {
  generatedAt,
  strict,
  artifactRoot,
  failedCount: failedResults.length,
  statusByItem,
  results,
};

write(outputMarkdown, markdown);
write(outputJson, `${JSON.stringify(report, null, 2)}\n`);
if (writeDoc) {
  write(docPath, replaceAutoSection(docPath, markdown));
}

console.log(`Release closure gate written to ${outputMarkdown} and ${outputJson}.`);
console.log(`- Steps: ${results.length}`);
console.log(`- Failed: ${failedResults.length}`);
for (const result of failedResults) {
  console.error(`FAIL: ${result.id} (${result.commandText})`);
}

if (strict && failedResults.length > 0) {
  process.exit(1);
}

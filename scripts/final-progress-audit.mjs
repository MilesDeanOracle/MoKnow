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

function runRefreshCommand(command, commandArgs) {
  const result = run(command, commandArgs);
  const output = `${result.stdout}\n${result.stderr}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-8)
    .join("<br>");
  return {
    command: `${command} ${commandArgs.join(" ")}`,
    ok: result.status === 0,
    output: output || "无输出",
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

function statusText(ok) {
  return ok ? "完成" : "未完成";
}

function cleanCell(value) {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replace(/\r?\n/g, "<br>")
    .trim();
}

function list(values, fallback = "无") {
  const items = values.filter(Boolean);
  return items.length > 0 ? items.join("<br>") : fallback;
}

function failedLabels(report) {
  if (!report) return ["报告缺失"];
  if (Array.isArray(report.checks)) {
    return report.checks
      .filter((check) => check.ok === false)
      .map((check) => {
        const evidence = String(check.evidence ?? "").replace(/<br>.*/s, "").trim();
        return evidence ? `${check.label}（${evidence}）` : check.label;
      });
  }
  if (Array.isArray(report.failures) && report.failures.length > 0) return report.failures;
  return [];
}

function checkByLabel(report, label) {
  return report?.checks?.find((check) => check.label === label);
}

function latestPlatformCount(report) {
  if (!report?.platforms || typeof report.platforms !== "object") return 0;
  return Object.keys(report.platforms).length;
}

function readinessMissingLabels(report, matchers) {
  if (!report?.requirements) return ["readiness 报告缺失"];
  return report.requirements
    .filter((requirement) => requirement.status !== "passed" && matchers.some((matcher) => matcher.test(requirement.label)))
    .map((requirement) => requirement.label);
}

function buildAiRow() {
  const preflight = readJson("release/ai-e2e-preflight.json");
  const auto = readJson("release/ai-e2e-auto.json");
  const e2e = readJson("release/ai-e2e.json");
  const preflightFailures = failedLabels(preflight);
  const e2eOk = Boolean(e2e?.responseNonEmpty && e2e?.httpStatus >= 200 && e2e?.httpStatus < 300);
  const autoPassed = Boolean(auto?.passed);
  const ok = e2eOk && (preflightFailures.length === 0 || autoPassed);

  return {
    priority: "P1 / P2",
    module: "AI 能力",
    item: "真实外部模型端到端联调记录",
    ok,
    evidence: list([
      `AI 预检：${preflight ? (preflightFailures.length === 0 ? "通过" : `未通过（${preflightFailures.join("、")}）`) : "报告缺失"}`,
      `自动探测：${auto ? (autoPassed ? `通过（${auto.selectedProvider || "未知 Provider"}）` : "未发现可用真实 Provider") : "报告缺失"}`,
      `真实 E2E JSON：${e2e ? (e2eOk ? "响应非空且 HTTP 成功" : "未证明成功") : "缺失"}`,
      e2e?.providerLabel ? `Provider：${e2e.providerLabel}` : undefined,
      e2e?.model ? `Model：${e2e.model}` : undefined,
    ]),
    gap: ok ? "已闭环" : "当前没有真实外部 Provider 的成功请求证据；mock E2E 只能证明脚本解析链路。",
    next: "配置 AI_E2E_ENDPOINT / AI_E2E_MODEL / AI_E2E_API_KEY，或启动本机 Ollama / LM Studio 后执行 npm run ai:e2e:auto -- --write-doc；需要显式校验时再执行 ai:e2e:preflight -- --strict、ai:e2e 和 ai:e2e -- --stream。",
    source:
      "`项目文档/初创/04-第四期-AI-Copilot.md`（1.1 核心交付物：多模型 LLM 接入、流式聊天界面、API Key 安全存储；九、验收标准：多模型切换、流式响应、API Key 安全）、`项目文档/初创/MarkNote-技术设计方案.md`（3.4 AI Copilot 架构；Phase 4：LLM 接入、流式响应）、`项目文档/个人AI日记产品规划.md`（API Key 安全存储、AI 上下文控制）",
  };
}

function buildCiRow() {
  const submitPrep = readJson("release/submit-prep.json");
  const safety = readJson("release/submission-safety.json");
  const submission = readJson("release/submission-plan.json");
  const manifest = readJson("release/submission-manifest.json");
  const preview = readJson("release/submission-preview.json");
  const push = readJson("release/push-readiness.json");
  const ci = readJson("release/ci-preflight.json");
  const workflowValidation = readJson("release/workflow-validation.json");
  const remote = readJson("release/remote-status.json");
  const downloads = readJson("release/download-verification.json");
  const install = readJson("release/install-smoke.json");
  const ciFailures = failedLabels(ci);
  const submitPrepFailures = submitPrep?.failures?.length ? submitPrep.failures : submitPrep ? [] : ["提交前准备总览报告缺失"];
  const safetyFailures = safety?.failures?.length ? safety.failures : safety ? [] : ["提交安全检查报告缺失"];
  const manifestFailures = manifest?.failures?.length ? manifest.failures : manifest ? [] : ["提交校验清单报告缺失"];
  const previewFailures = preview?.failures?.length ? preview.failures : preview ? [] : ["提交预演报告缺失"];
  const pushFailures = failedLabels(push);
  const submissionFailures = submission
    ? [
        ...(submission.missing?.length ? [`提交计划缺失文件（${submission.missing.join("、")}）`] : []),
        ...(submission.ignored?.length ? [`提交计划被忽略文件（${submission.ignored.join("、")}）`] : []),
      ]
    : ["提交计划报告缺失"];
  const workflowFailures = failedLabels(workflowValidation);
  const remoteFailures = failedLabels(remote);
  const downloadFailures = failedLabels(downloads);
  const installFailures = failedLabels(install);
  const manualOpen = checkByLabel(install, "实机打开与仓库读写");
  const allPlatformDownloadsOk = ["macOS 安装包", "Windows 安装包", "Linux 安装包"].every(
    (label) => checkByLabel(downloads, label)?.ok === true,
  );
  const allPlatformInstallOk = ["macOS .app 入口", "Windows 安装器", "Linux 安装器"].every((label) => {
    const check = checkByLabel(install, label);
    return check ? check.ok === true : false;
  });
  const ok =
    submitPrepFailures.length === 0 &&
    safetyFailures.length === 0 &&
    manifestFailures.length === 0 &&
    previewFailures.length === 0 &&
    pushFailures.length === 0 &&
    ciFailures.length === 0 &&
    workflowFailures.length === 0 &&
    remoteFailures.length === 0 &&
    allPlatformDownloadsOk &&
    allPlatformInstallOk &&
    manualOpen?.status === "通过";

  return {
    priority: "P2",
    module: "发布能力",
    item: "三平台完整构建验证、CI 实跑验证、发布产物下载验证",
    ok,
    evidence: list([
      `提交前准备：${
        submitPrep
          ? submitPrepFailures.length === 0
            ? `通过（tree ${submitPrep.summary?.preview?.tree || "未生成"}，必需文件 ${submitPrep.summary?.plan?.requiredCount ?? "未知"} 个）`
            : `未通过（${submitPrepFailures.join("、")}）`
          : "报告缺失"
      }`,
      `提交计划：${
        submission
          ? submissionFailures.length === 0
            ? `通过（${submission.requiredCount} 个必需文件，pathspec ${submission.pathspecMatchesAddable ? "已覆盖" : "未覆盖"} ${submission.pathspecCount ?? 0} 个可入库文件，未入库 ${submission.untracked?.length ?? 0} 个）`
              + `，git add dry-run ${submission.gitAddDryRun?.ok ? "通过" : "未通过"}`
              + `，临时 index 严格入库模拟 ${submission.simulatedStrictTracking?.ok ? "通过" : "未通过"}`
            : `未通过（${submissionFailures.join("、")}）`
          : "报告缺失"
      }`,
      `提交安全：${safety ? (safetyFailures.length === 0 ? `通过（扫描 ${safety.scannedCount} 个文件）` : `未通过（${safetyFailures.join("、")}）`) : "报告缺失"}`,
      `提交校验：${
        manifest
          ? manifestFailures.length === 0
            ? `通过（${manifest.fileCount} 个文件，${manifest.hashedFileCount ?? manifest.fileCount} 个参与聚合，SHA-256 ${manifest.aggregateHash}）`
            : `未通过（${manifestFailures.join("、")}）`
          : "报告缺失"
      }`,
      `提交预演：${
        preview
          ? previewFailures.length === 0
            ? `通过（tree ${preview.tree || "未生成"}，${preview.requiredCount} 个必需文件进入临时 index）`
            : `未通过（${previewFailures.join("、")}）`
          : "报告缺失"
      }`,
      `推送准备：${
        push
          ? pushFailures.length === 0
            ? `通过（分支 ${push.currentBranch || "未知"}，upstream ${push.upstream || "未配置"}，pathspec 临时入库 ${
                push.submissionPlan?.simulatedStrictTrackingOk ? "通过" : "未通过"
              }，警告 ${push.warnings?.length ?? 0} 项）`
            : `未通过（${pushFailures.join("、")}）`
          : "报告缺失"
      }`,
      `CI 预检：${ci ? (ciFailures.length === 0 ? "通过" : `未通过（${ciFailures.join("、")}）`) : "报告缺失"}`,
      `Workflow 结构：${workflowValidation ? (workflowFailures.length === 0 ? "通过" : `未通过（${workflowFailures.join("、")}）`) : "报告缺失"}`,
      `远端状态：${remote ? (remoteFailures.length === 0 ? "通过" : `未通过（${remoteFailures.join("、")}）`) : "报告缺失"}`,
      `下载产物：${downloads ? (downloadFailures.length === 0 ? "通过" : `未通过（${downloadFailures.join("、")}）`) : "报告缺失"}`,
      `安装冒烟：${install ? (installFailures.length === 0 ? "通过/待人工项不阻断脚本" : `未通过（${installFailures.join("、")}）`) : "报告缺失"}`,
      manualOpen ? `实机打开：${manualOpen.status ?? (manualOpen.ok ? "通过" : "未通过")}` : undefined,
    ]),
    gap: ok
      ? "已闭环"
      : "远端 workflow、Windows/Linux artifacts、三平台下载校验和实机打开读写验证尚未同时具备成功证据。",
    next: "先执行 npm run release:submit-prep -- --write-doc，或分步执行 release:submission-safety、release:submission-plan、release:submission-manifest、release:submission-preview 和 release:push-readiness；使用 git add --pathspec-from-file=release/submission-pathspec.txt --pathspec-file-nul 纳入 workflow / 发布脚本 / 项目文档，再执行 npm run release:tracking -- --strict --write-doc；提交并推送后执行 npm run release:ci-preflight -- --strict --write-doc、npm run release:dry-run -- --write-doc 和 npm run release:remote-status -- --strict --write-doc；下载三平台 artifacts 后执行 release:downloads 与 release:install-smoke -- --platform all，并补人工打开结果。",
    source:
      "`项目文档/初创/06-第六期-打磨与发布.md`（1.1 核心交付物：CI/CD 自动构建三平台安装包、v1.0 发布；六、CI/CD 流水线；八、发布 Checklist）、`项目文档/初创/MarkNote-技术设计方案.md`（1.2 跨平台目标：macOS / Windows / Linux；Phase 6：CI/CD 构建三平台安装包）、`项目文档/00-开发约束与协作规范.md`（13.2 发布 Checklist：GitHub Release 附带安装包）",
  };
}

function buildSigningRow() {
  const readiness = readJson("release/external-readiness.json");
  const secrets = readJson("release/secrets-audit.json");
  const signing = readJson("release/signing-verification.json");
  const distribution = readJson("release/distribution-verification.json");
  const latest = readJson("release/latest.json");
  const downloads = readJson("release/downloads.json");
  const signingFailures = failedLabels(signing);
  const distributionFailures = failedLabels(distribution);
  const secretsFailures = Array.isArray(secrets?.failures) ? secrets.failures : ["secrets 审计报告缺失"];
  const externalMissing = readinessMissingLabels(readiness, [
    /updater/i,
    /macOS/i,
    /Windows/i,
    /下载|官网|Homebrew/i,
  ]);
  const latestPlatforms = latestPlatformCount(latest);
  const downloadsOk = Boolean(downloads?.version && Array.isArray(downloads?.downloads) && downloads.downloads.length > 0);
  const ok =
    externalMissing.length === 0 &&
    secretsFailures.length === 0 &&
    signingFailures.length === 0 &&
    distributionFailures.length === 0 &&
    latestPlatforms > 0 &&
    downloadsOk;

  return {
    priority: "P2",
    module: "发布能力",
    item: "macOS 签名、公证、Windows code signing、真实自动更新实发、Homebrew / 官网分发",
    ok,
    evidence: list([
      `外部配置：${readiness ? (externalMissing.length === 0 ? "通过" : `缺失（${externalMissing.join("、")}）`) : "报告缺失"}`,
      `GitHub secrets：${secrets ? (secretsFailures.length === 0 ? "通过" : `缺失（${secretsFailures.join("、")}）`) : "报告缺失"}`,
      `签名/公证：${signing ? (signingFailures.length === 0 ? "通过" : `未通过（${signingFailures.join("、")}）`) : "报告缺失"}`,
      `分发验证：${distribution ? (distributionFailures.length === 0 ? "通过" : `未通过（${distributionFailures.join("、")}）`) : "报告缺失"}`,
      `latest.json 平台条目：${latestPlatforms}`,
      `downloads.json：${downloadsOk ? "已生成" : "缺失或无下载项"}`,
    ]),
    gap: ok ? "已闭环" : "正式证书、公证凭据、updater key、稳定下载 URL、Homebrew tap / 官网分发仍未全部实跑验证。",
    next: "配置 GitHub Actions secrets、Apple / Windows 签名、公证、TAURI_SIGNING_PRIVATE_KEY、MOKNOW_UPDATER_PUBKEY、稳定 HTTPS 下载 URL、Homebrew tap 和官网分发页后，先执行 release:secrets:sync -- --write-doc 预览；确认无误后执行 release:secrets:sync -- --apply --verify --write-doc，再执行 release:secrets -- --strict、release:readiness -- --strict、release:signing -- --require-signed --require-notarized、release:metadata -- --require-base-url --require-updater-signatures 和 release:distribution -- --strict --require-reachable。",
    source:
      "`项目文档/初创/06-第六期-打磨与发布.md`（1.1 核心交付物：自动更新、代码签名、v1.0 发布；五、自动更新；七、代码签名与公证；八、发布 Checklist / Homebrew 发布）、`项目文档/初创/MarkNote-技术设计方案.md`（Phase 6：自动更新、官网）、`项目文档/00-开发约束与协作规范.md`（13.2 发布 Checklist：自动更新配置已发布、GitHub Release 已创建）",
  };
}

function markdownTable(rows) {
  return [
    "| 优先级 | 功能模块 | 未完成内容 | 自动审计结论 | 关键证据 | 未闭环原因 | 下一步 | 来源需求方案 |",
    "|---|---|---|---|---|---|---|---|",
    ...rows.map(
      (row) =>
        `| ${cleanCell(row.priority)} | ${cleanCell(row.module)} | ${cleanCell(row.item)} | ${statusText(row.ok)} | ${cleanCell(row.evidence)} | ${cleanCell(row.gap)} | ${cleanCell(row.next)} | ${cleanCell(row.source)} |`,
    ),
  ].join("\n");
}

function replaceAutoSection(path, section) {
  const start = "<!-- AUTO_FINAL_PROGRESS_AUDIT_START -->";
  const end = "<!-- AUTO_FINAL_PROGRESS_AUDIT_END -->";
  const previous = existsSync(path) ? readFileSync(path, "utf8") : "";
  const block = `${start}\n${section.trim()}\n${end}`;
  if (previous.includes(start) && previous.includes(end)) {
    return previous.replace(new RegExp(`${start}[\\s\\S]*?${end}`), block);
  }
  return `${previous.trimEnd()}\n\n## 七、自动最终进度审计\n\n${block}\n`;
}

const outputMarkdown = argValue("--output-md", "release/final-progress-audit.md");
const outputJson = argValue("--output-json", "release/final-progress-audit.json");
const docPath = argValue("--doc", "项目文档/项目进度.md");
const writeDoc = hasFlag("--write-doc");
const strict = hasFlag("--strict");
const refresh = hasFlag("--refresh");
const generatedAt = new Date().toISOString();
const refreshResults = [];

if (refresh) {
  refreshResults.push(runRefreshCommand("npm", ["run", "ai:e2e:auto", "--", "--write-doc"]));
  refreshResults.push(runRefreshCommand("npm", ["run", "ai:e2e:preflight", "--", "--write-doc"]));
  refreshResults.push(runRefreshCommand("npm", ["run", "release:readiness", "--", "--write-doc"]));
  refreshResults.push(runRefreshCommand("npm", ["run", "release:secrets", "--", "--write-doc"]));
  refreshResults.push(runRefreshCommand("npm", ["run", "release:secrets:sync", "--", "--write-doc"]));
  refreshResults.push(runRefreshCommand("npm", ["run", "release:distribution", "--", "--write-doc"]));
  refreshResults.push(runRefreshCommand("npm", ["run", "release:handoff", "--", "--write-doc"]));
  refreshResults.push(runRefreshCommand("npm", ["run", "release:submit-prep", "--", "--write-doc"]));
  refreshResults.push(runRefreshCommand("npm", ["run", "release:submission-safety", "--", "--write-doc"]));
  refreshResults.push(runRefreshCommand("npm", ["run", "release:submission-plan", "--", "--write-doc"]));
  refreshResults.push(runRefreshCommand("npm", ["run", "release:submission-manifest", "--", "--write-doc"]));
  refreshResults.push(runRefreshCommand("npm", ["run", "release:submission-preview", "--", "--write-doc"]));
  refreshResults.push(runRefreshCommand("npm", ["run", "release:push-readiness", "--", "--write-doc"]));
  refreshResults.push(runRefreshCommand("npm", ["run", "release:tracking", "--", "--write-doc"]));
  refreshResults.push(runRefreshCommand("npm", ["run", "release:ci-preflight", "--", "--write-doc"]));
  refreshResults.push(runRefreshCommand("npm", ["run", "release:workflow-validate", "--", "--write-doc"]));
  refreshResults.push(runRefreshCommand("npm", ["run", "release:remote-status", "--", "--write-doc"]));
  refreshResults.push(runRefreshCommand("npm", ["run", "release:install-smoke", "--", "--write-doc"]));
  refreshResults.push(runRefreshCommand("npm", ["run", "release:signing", "--", "--write-doc"]));
  if (existsSync("release/downloaded-artifacts")) {
    refreshResults.push(
      runRefreshCommand("npm", [
        "run",
        "release:downloads",
        "--",
        "--artifact-root",
        "release/downloaded-artifacts",
        "--platform",
        "all",
        "--write-doc",
      ]),
    );
  }
}

const rows = [buildAiRow(), buildCiRow(), buildSigningRow()];
const incompleteRows = rows.filter((row) => !row.ok);

const refreshMarkdown = refreshResults.length
  ? `\n## 刷新命令\n\n| 命令 | 结果 | 摘要 |\n|---|---|---|\n${refreshResults
      .map((result) => `| \`${cleanCell(result.command)}\` | ${result.ok ? "通过" : "未通过"} | ${cleanCell(result.output)} |`)
      .join("\n")}\n`
  : "";

const markdown = `# 项目进度最终审计

| 项目 | 值 |
|---|---|
| 生成时间 | ${generatedAt} |
| 刷新报告 | ${refresh ? "是" : "否"} |
| 严格模式 | ${strict ? "是" : "否"} |
| 未完成项数量 | ${incompleteRows.length} |

${markdownTable(rows)}
${refreshMarkdown}
> 自动审计只把可验证证据作为完成依据；缺少远端运行、真实外部服务、证书或人工实机记录时会继续判定为未完成。
`;

const json = {
  generatedAt,
  refresh,
  strict,
  incompleteCount: incompleteRows.length,
  rows,
  refreshResults,
};

mkdirSync(dirname(outputMarkdown), { recursive: true });
writeFileSync(outputMarkdown, markdown, "utf8");
writeFileSync(outputJson, `${JSON.stringify(json, null, 2)}\n`, "utf8");

if (writeDoc) {
  mkdirSync(dirname(docPath), { recursive: true });
  writeFileSync(docPath, replaceAutoSection(docPath, markdown), "utf8");
}

console.log(`Final progress audit written to ${outputMarkdown} and ${outputJson}.`);
for (const row of rows) {
  console.log(`- ${row.item}: ${statusText(row.ok)}`);
}

if (strict && incompleteRows.length > 0) {
  for (const row of incompleteRows) {
    console.error(`FAIL: ${row.item}`);
  }
  process.exit(1);
}

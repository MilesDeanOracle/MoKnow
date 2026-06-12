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
    stdout: result.stdout?.trim() ?? "",
    stderr: result.stderr?.trim() ?? "",
  };
}

function outputSummary(...values) {
  const lines = values
    .join("\n")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.slice(0, 12).join("<br>") || "无输出";
}

function pass(label, evidence, note = "") {
  return { label, status: "通过", ok: true, evidence, note };
}

function fail(label, evidence, note = "") {
  return { label, status: "未通过", ok: false, evidence, note };
}

function warn(label, evidence, note = "") {
  return { label, status: "警告", ok: true, warning: true, evidence, note };
}

function readJson(path) {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

function cleanCell(value) {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replace(/\r?\n/g, "<br>")
    .trim();
}

function markdownTable(rows) {
  return [
    "| 项目 | 结论 | 证据 | 备注 |",
    "|---|---|---|---|",
    ...rows.map((row) => `| ${cleanCell(row.label)} | ${row.status} | ${cleanCell(row.evidence)} | ${cleanCell(row.note)} |`),
  ].join("\n");
}

function replaceAutoSection(path, section) {
  const start = "<!-- AUTO_RELEASE_PUSH_READINESS_START -->";
  const end = "<!-- AUTO_RELEASE_PUSH_READINESS_END -->";
  const previous = existsSync(path) ? readFileSync(path, "utf8") : "";
  const block = `${start}\n${section.trim()}\n${end}`;
  if (previous.includes(start) && previous.includes(end)) {
    return previous.replace(new RegExp(`${start}[\\s\\S]*?${end}`), block);
  }
  return previous.trim() ? `${previous.trimEnd()}\n\n## 发布推送准备记录\n\n${block}\n` : `${block}\n`;
}

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function detectRepository(remoteUrl) {
  const sshMatch = remoteUrl.match(/github\.com[:/]([^/]+\/[^/.]+)(?:\.git)?$/i);
  const httpsMatch = remoteUrl.match(/github\.com\/([^/]+\/[^/.]+)(?:\.git)?$/i);
  return sshMatch?.[1] ?? httpsMatch?.[1] ?? "";
}

const outputMarkdown = argValue("--output-md", "release/push-readiness.md");
const outputJson = argValue("--output-json", "release/push-readiness.json");
const docPath = argValue("--doc", "项目文档/发布推送准备记录.md");
const strict = hasFlag("--strict");
const writeDoc = hasFlag("--write-doc");
const generatedAt = new Date().toISOString();
const submissionSafety = readJson("release/submission-safety.json");
const submissionPlan = readJson("release/submission-plan.json");
const submissionManifest = readJson("release/submission-manifest.json");
const submissionPreview = readJson("release/submission-preview.json");
const checks = [];

const remote = run("git", ["remote", "get-url", "origin"]);
const remoteUrl = remote.stdout;
const repository = argValue("--repo", process.env.GITHUB_REPOSITORY ?? detectRepository(remoteUrl) ?? "OWNER/REPO");
checks.push(remote.status === 0 ? pass("Git origin", remoteUrl) : fail("Git origin", outputSummary(remote.stdout, remote.stderr)));

const branch = run("git", ["branch", "--show-current"]);
const currentBranch = branch.stdout;
checks.push(currentBranch ? pass("当前分支", currentBranch) : fail("当前分支", "未识别", "需要在可推送的本地分支上执行"));

const upstream = run("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]);
checks.push(
  upstream.status === 0
    ? pass("Upstream", upstream.stdout)
    : fail("Upstream", outputSummary(upstream.stdout, upstream.stderr), "先设置 upstream，例如 git push -u origin main"),
);

let aheadBehind = { ahead: null, behind: null, raw: "" };
if (upstream.status === 0) {
  const revList = run("git", ["rev-list", "--left-right", "--count", `${upstream.stdout}...HEAD`]);
  const [behind, ahead] = revList.stdout.split(/\s+/).map((value) => Number(value));
  aheadBehind = { ahead, behind, raw: revList.stdout };
  checks.push(
    revList.status === 0
      ? pass("Ahead / behind", `ahead ${ahead}，behind ${behind}`, behind > 0 ? "推送前建议先处理远端新增提交" : "")
      : warn("Ahead / behind", outputSummary(revList.stdout, revList.stderr), "无法计算 ahead/behind"),
  );
}

const status = run("git", ["-c", "core.quotePath=false", "status", "--short"]);
checks.push(
  status.stdout
    ? warn("工作区状态", status.stdout.split(/\r?\n/).slice(0, 40).join("<br>"), "推送准备允许有未提交改动，但远端 CI 只能使用已提交并推送的内容")
    : pass("工作区状态", "干净"),
);

if (submissionSafety) {
  checks.push(
    submissionSafety.failures?.length
      ? fail("提交安全检查", submissionSafety.failures.join("<br>"))
      : pass("提交安全检查", `${submissionSafety.scannedCount} 个文件无密钥/生成产物风险`),
  );
  checks.push(
    submissionSafety.warnings?.length
      ? warn("提交安全检查警告", submissionSafety.warnings.join("<br>"))
      : pass("提交安全检查警告", "无"),
  );
} else {
  checks.push(
    warn(
      "提交安全检查报告",
      "release/submission-safety.json 缺失",
      "建议先执行 npm run release:submission-safety -- --strict --write-doc",
    ),
  );
}

if (submissionPlan) {
  checks.push(
    submissionPlan.pathspecMatchesAddable
      ? pass("提交 pathspec 覆盖", `${submissionPlan.pathspecCount} / ${submissionPlan.requiredCount} 个必需文件`)
      : fail("提交 pathspec 覆盖", "未覆盖所有可加入文件", "先执行 npm run release:submission-plan -- --strict --write-doc"),
  );
  checks.push(
    submissionPlan.gitAddDryRun?.ok
      ? pass("git add dry-run", submissionPlan.gitAddDryRun.summary || "通过")
      : fail("git add dry-run", submissionPlan.gitAddDryRun?.summary || "未通过"),
  );
  checks.push(
    submissionPlan.simulatedStrictTracking?.ok
      ? pass(
          "临时 index 严格入库模拟",
          `${submissionPlan.simulatedStrictTracking.trackedCount} / ${submissionPlan.simulatedStrictTracking.requiredCount} 个必需文件可入库`,
        )
      : fail(
          "临时 index 严格入库模拟",
          submissionPlan.simulatedStrictTracking?.failures?.join("<br>") || "未通过",
          "需修正 pathspec 或缺失文件",
        ),
  );
  checks.push(
    submissionPlan.missing?.length
      ? fail("提交计划缺失文件", submissionPlan.missing.join("<br>"))
      : pass("提交计划缺失文件", "无"),
  );
  checks.push(
    submissionPlan.ignored?.length
      ? fail("提交计划被忽略文件", submissionPlan.ignored.join("<br>"))
      : pass("提交计划被忽略文件", "无"),
  );
  checks.push(
    submissionPlan.untracked?.length
      ? warn(
          "提交计划未入库文件",
          `${submissionPlan.untracked.length} 个`,
          "执行推荐 git add 后应再运行 release:tracking -- --strict --write-doc",
        )
      : pass("提交计划未入库文件", "无"),
  );
} else {
  checks.push(
    fail(
      "提交计划报告",
      "release/submission-plan.json 缺失",
      "先执行 npm run release:submission-plan -- --strict --write-doc",
    ),
  );
}

if (submissionManifest) {
  checks.push(
    submissionManifest.failures?.length
      ? fail("提交校验清单", submissionManifest.failures.join("<br>"))
      : pass(
          "提交校验清单",
          `${submissionManifest.fileCount} 个文件，${submissionManifest.hashedFileCount ?? submissionManifest.fileCount} 个参与聚合，聚合 SHA-256 ${submissionManifest.aggregateHash}`,
        ),
  );
} else {
  checks.push(
    warn(
      "提交校验清单",
      "release/submission-manifest.json 缺失",
      "建议先执行 npm run release:submission-manifest -- --strict --write-doc",
    ),
  );
}

if (submissionPreview) {
  checks.push(
    submissionPreview.failures?.length
      ? fail("提交预演", submissionPreview.failures.join("<br>"))
      : pass("提交预演", `tree ${submissionPreview.tree || "未生成"}，${submissionPreview.requiredCount} 个必需文件已进入临时 index`),
  );
  checks.push(
    submissionPreview.warnings?.length
      ? warn("提交预演警告", submissionPreview.warnings.join("<br>"))
      : pass("提交预演警告", "无"),
  );
} else {
  checks.push(
    warn(
      "提交预演报告",
      "release/submission-preview.json 缺失",
      "建议先执行 npm run release:submission-preview -- --strict --write-doc",
    ),
  );
}

const ghVersion = run("gh", ["--version"]);
checks.push(
  ghVersion.status === 0 ? pass("GitHub CLI", outputSummary(ghVersion.stdout, ghVersion.stderr)) : fail("GitHub CLI", outputSummary(ghVersion.stdout, ghVersion.stderr)),
);

const ghAuth = run("gh", ["auth", "status"]);
checks.push(
  ghAuth.status === 0
    ? pass("GitHub CLI 登录", outputSummary(ghAuth.stdout, ghAuth.stderr))
    : fail("GitHub CLI 登录", outputSummary(ghAuth.stdout, ghAuth.stderr), "需要 gh auth login 且 token 可读取仓库/workflow"),
);

const repoView = repository && !repository.includes("OWNER/")
  ? run("gh", ["repo", "view", repository, "--json", "nameWithOwner,defaultBranchRef", "--jq", "{nameWithOwner,defaultBranch: .defaultBranchRef.name}"])
  : { status: 1, stdout: "", stderr: "无法从 origin 推断 GitHub 仓库" };
checks.push(
  repoView.status === 0
    ? pass("GitHub 仓库可读", outputSummary(repoView.stdout))
    : fail("GitHub 仓库可读", outputSummary(repoView.stdout, repoView.stderr), "确认 origin 指向 GitHub 仓库且 gh 已登录"),
);

let defaultBranch = "";
if (repoView.status === 0) {
  try {
    defaultBranch = JSON.parse(repoView.stdout).defaultBranch ?? "";
  } catch {
    defaultBranch = "";
  }
}
if (defaultBranch) {
  checks.push(
    currentBranch === defaultBranch
      ? pass("当前分支与远端默认分支", `${currentBranch} = ${defaultBranch}`)
      : warn("当前分支与远端默认分支", `当前 ${currentBranch || "未知"}，默认 ${defaultBranch}`, "workflow_dispatch 通常需要 workflow 已在默认分支存在"),
  );
}

const remoteWorkflow = repository && !repository.includes("OWNER/")
  ? run("gh", ["api", `repos/${repository}/actions/workflows/release-dry-run.yml`, "--jq", "{id,name,state,path}"])
  : { status: 1, stdout: "", stderr: "无法从 origin 推断 GitHub 仓库" };
checks.push(
  remoteWorkflow.status === 0
    ? pass("远端 Release Dry Run workflow", outputSummary(remoteWorkflow.stdout))
    : warn("远端 Release Dry Run workflow", outputSummary(remoteWorkflow.stdout, remoteWorkflow.stderr), "提交并推送 workflow 后再执行 release:ci-preflight -- --strict"),
);

const failures = checks.filter((check) => !check.ok);
const warnings = checks.filter((check) => check.warning);
const recommendedCommands = [
  "npm run release:submission-safety -- --strict --write-doc",
  "npm run release:submission-plan -- --strict --write-doc",
  "npm run release:submission-manifest -- --strict --write-doc",
  "npm run release:submission-preview -- --strict --write-doc",
  "npm run release:push-readiness -- --write-doc",
  "git add --pathspec-from-file=release/submission-pathspec.txt --pathspec-file-nul",
  "npm run release:tracking -- --strict --write-doc",
  "git status --short",
  'git commit -m "chore: add release validation workflow"',
  `git push origin ${currentBranch || "main"}`,
  "npm run release:ci-preflight -- --strict --write-doc",
  "npm run release:dry-run -- --write-doc",
];

const markdown = `# 发布推送准备记录

| 项目 | 值 |
|---|---|
| 生成时间 | ${generatedAt} |
| 仓库 | ${repository || "未知"} |
| origin | ${remoteUrl || "未知"} |
| 当前分支 | ${currentBranch || "未知"} |
| upstream | ${upstream.status === 0 ? upstream.stdout : "未配置"} |
| ahead / behind | ${aheadBehind.raw || "未计算"} |
| 严格模式 | ${strict ? "是" : "否"} |
| 失败项数量 | ${failures.length} |
| 警告项数量 | ${warnings.length} |

${markdownTable(checks)}

## 推荐执行顺序

\`\`\`bash
${recommendedCommands.join("\n")}
\`\`\`

> 本脚本只读取 Git / GitHub 状态并生成报告，不会执行 \`git add\`、\`git commit\` 或 \`git push\`。远端 workflow 的成功记录仍必须在提交并推送后由 GitHub Actions 产生。
`;

const report = {
  generatedAt,
  repository,
  remoteUrl,
  currentBranch,
  upstream: upstream.status === 0 ? upstream.stdout : "",
  aheadBehind,
  strict,
  failures: failures.map((check) => check.label),
  warnings: warnings.map((check) => check.label),
  checks,
  submissionSafety: submissionSafety
    ? {
        scannedCount: submissionSafety.scannedCount,
        failureCount: submissionSafety.failures?.length ?? 0,
        warningCount: submissionSafety.warnings?.length ?? 0,
      }
    : null,
  submissionPreview: submissionPreview
    ? {
        tree: submissionPreview.tree,
        requiredCount: submissionPreview.requiredCount,
        pathspecCount: submissionPreview.pathspecCount,
        failureCount: submissionPreview.failures?.length ?? 0,
        warningCount: submissionPreview.warnings?.length ?? 0,
      }
    : null,
  submissionManifest: submissionManifest
    ? {
        fileCount: submissionManifest.fileCount,
        aggregateHash: submissionManifest.aggregateHash,
        failureCount: submissionManifest.failures?.length ?? 0,
      }
    : null,
  submissionPlan: submissionPlan
    ? {
        requiredCount: submissionPlan.requiredCount,
        pathspecCount: submissionPlan.pathspecCount,
        pathspecMatchesAddable: submissionPlan.pathspecMatchesAddable,
        gitAddDryRunOk: Boolean(submissionPlan.gitAddDryRun?.ok),
        simulatedStrictTrackingOk: Boolean(submissionPlan.simulatedStrictTracking?.ok),
        untrackedCount: submissionPlan.untracked?.length ?? 0,
        missingCount: submissionPlan.missing?.length ?? 0,
        ignoredCount: submissionPlan.ignored?.length ?? 0,
      }
    : null,
  recommendedCommands,
};

write(outputMarkdown, markdown);
write(outputJson, `${JSON.stringify(report, null, 2)}\n`);
if (writeDoc) write(docPath, replaceAutoSection(docPath, markdown));

console.log(`Release push readiness written to ${outputMarkdown} and ${outputJson}.`);
for (const check of checks) console.log(`- ${check.label}: ${check.status}`);

if (strict && failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure.label}`);
  process.exit(1);
}

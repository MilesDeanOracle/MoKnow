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

function outputSummary(result) {
  return `${result.stdout}\n${result.stderr}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 6)
    .join("<br>") || "无输出";
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

function markdownTable(rows) {
  return [
    "| 项目 | 结论 | 证据 | 备注 |",
    "|---|---|---|---|",
    ...rows.map((row) => `| ${row.label} | ${row.status} | ${row.evidence} | ${row.note} |`),
  ].join("\n");
}

function replaceAutoSection(path, section) {
  const start = "<!-- AUTO_CI_PREFLIGHT_START -->";
  const end = "<!-- AUTO_CI_PREFLIGHT_END -->";
  const previous = existsSync(path) ? readFileSync(path, "utf8") : "";
  const block = `${start}\n${section.trim()}\n${end}`;
  if (previous.includes(start) && previous.includes(end)) {
    return previous.replace(new RegExp(`${start}[\\s\\S]*?${end}`), block).trimStart();
  }
  return previous.trim() ? `${previous.trimEnd()}\n\n${block}\n` : `${block}\n`;
}

function gitTracked(path) {
  const result = run("git", ["ls-files", "--error-unmatch", path]);
  return result.status === 0;
}

function readJson(path) {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

function workflowLocalChecks(path, requiredSnippets) {
  if (!existsSync(path)) return [fail(`${path} 本地文件`, "文件不存在", "需要先创建 workflow 文件")];
  const content = readFileSync(path, "utf8");
  const checks = [pass(`${path} 本地文件`, "文件存在")];
  for (const snippet of requiredSnippets) {
    checks.push(
      content.includes(snippet)
        ? pass(`${path} 包含 ${snippet}`, "已找到")
        : fail(`${path} 包含 ${snippet}`, "未找到", "workflow 内容未覆盖发布要求"),
    );
  }
  checks.push(
    gitTracked(path)
      ? pass(`${path} 已纳入 git 索引`, "git ls-files 可找到")
      : fail(`${path} 已纳入 git 索引`, "git ls-files 未找到", "需提交/推送后远端才可触发 workflow_dispatch"),
  );
  return checks;
}

const repo = argValue("--repo", "MilesDeanOracle/MoKnow");
const ref = argValue("--ref", run("git", ["branch", "--show-current"]).stdout.trim() || "main");
const workflow = argValue("--workflow", "release-dry-run.yml");
const outputMarkdown = argValue("--output-md", "release/ci-preflight.md");
const outputJson = argValue("--output-json", "release/ci-preflight.json");
const docPath = argValue("--doc", "项目文档/发布CI预检记录.md");
const strict = hasFlag("--strict");
const writeDoc = hasFlag("--write-doc");
const generatedAt = new Date().toISOString();
const submitPrep = readJson("release/submit-prep.json");
const submissionSafety = readJson("release/submission-safety.json");
const submissionPlan = readJson("release/submission-plan.json");
const submissionManifest = readJson("release/submission-manifest.json");
const submissionPreview = readJson("release/submission-preview.json");
const pushReadiness = readJson("release/push-readiness.json");

const checks = [];

const ghVersion = run("gh", ["--version"]);
checks.push(
  ghVersion.status === 0
    ? pass("GitHub CLI", outputSummary(ghVersion))
    : fail("GitHub CLI", outputSummary(ghVersion), "需要安装 gh 才能自动触发远端 dry-run"),
);

const ghAuth = run("gh", ["auth", "status"]);
checks.push(
  ghAuth.status === 0
    ? pass("GitHub CLI 登录", outputSummary(ghAuth))
    : fail("GitHub CLI 登录", outputSummary(ghAuth), "需要 gh auth login 且 token 包含 workflow 权限"),
);

const remote = run("git", ["remote", "get-url", "origin"]);
checks.push(remote.status === 0 ? pass("Git origin", remote.stdout.trim()) : fail("Git origin", outputSummary(remote)));

const branch = run("git", ["branch", "--show-current"]);
checks.push(branch.stdout.trim() ? pass("当前分支", branch.stdout.trim()) : warn("当前分支", "未识别", "可能处于 detached HEAD"));

const dirty = run("git", ["status", "--short", ".github/workflows", "scripts", "package.json", "Makefile", "项目文档"]);
checks.push(
  dirty.stdout.trim()
    ? warn("发布相关本地改动", dirty.stdout.trim().replaceAll("\n", "<br>"), "远端 dry-run 只能使用已推送到 ref 的内容")
    : pass("发布相关本地改动", "工作区干净"),
);

if (submitPrep) {
  checks.push(
    submitPrep.failures?.length
      ? fail("提交前准备总览", submitPrep.failures.join("<br>"))
      : pass("提交前准备总览", `提交前准备通过，tree ${submitPrep.summary?.preview?.tree || "未生成"}`),
  );
} else {
  checks.push(
    warn(
      "提交前准备总览",
      "release/submit-prep.json 缺失",
      "建议先执行 npm run release:submit-prep -- --write-doc",
    ),
  );
}

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
  const simulated = submissionPlan.simulatedStrictTracking;
  checks.push(
    simulated?.ok
      ? pass(
          "提交计划临时 index 模拟",
          `${simulated.trackedCount} / ${simulated.requiredCount} 个必需文件可被临时 index 跟踪`,
          "真实 git index 尚未变化；该项证明按 submission pathspec 暂存后本地入库条件可满足",
        )
      : fail(
          "提交计划临时 index 模拟",
          simulated ? `失败项：${(simulated.failures ?? []).join("<br>") || "未知"}` : "报告缺少 simulatedStrictTracking",
          "先执行 npm run release:submission-plan -- --strict --write-doc",
        ),
  );
  checks.push(
    submissionPlan.gitAddDryRun?.ok
      ? pass("提交计划 git add dry-run", submissionPlan.gitAddDryRun.summary || "通过")
      : fail("提交计划 git add dry-run", submissionPlan.gitAddDryRun?.summary || "未通过"),
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

if (pushReadiness) {
  checks.push(
    pushReadiness.submissionPlan?.simulatedStrictTrackingOk
      ? pass(
          "推送准备临时 index 证据",
          `${pushReadiness.submissionPlan.requiredCount} 个必需文件可按 pathspec 入库`,
          "该项不代表已提交推送，只证明推送前置文件清单可执行",
        )
      : fail(
          "推送准备临时 index 证据",
          "未通过或报告缺少 submissionPlan",
          "先执行 npm run release:push-readiness -- --write-doc",
        ),
  );
  checks.push(
    pushReadiness.failures?.length
      ? fail("推送准备失败项", pushReadiness.failures.join("<br>"))
      : pass("推送准备失败项", "无"),
  );
  checks.push(
    pushReadiness.warnings?.length
      ? warn("推送准备警告项", pushReadiness.warnings.join("<br>"))
      : pass("推送准备警告项", "无"),
  );
} else {
  checks.push(
    warn(
      "推送准备报告",
      "release/push-readiness.json 缺失",
      "建议先执行 npm run release:push-readiness -- --write-doc 记录当前分支、upstream、远端 workflow 状态",
    ),
  );
}

checks.push(
  ...workflowLocalChecks(".github/workflows/release-dry-run.yml", [
    "workflow_dispatch",
    "macos-latest",
    "windows-latest",
    "ubuntu-22.04",
    "tauri-apps/tauri-action",
    "actions/upload-artifact",
    "npm run release:artifacts",
    "npm run release:install-smoke",
    "npm run release:signing",
    "release/**/*.md",
  ]),
);
checks.push(
  ...workflowLocalChecks(".github/workflows/release.yml", [
    "push:",
    "tags:",
    "npm run release:updater-config",
    "--config src-tauri/tauri.updater.conf.json",
    "--require-updater-signatures",
    "npm run release:install-smoke",
    "npm run release:signing -- --require-signed --require-notarized",
    "release/**/*.md",
    "gh release upload",
  ]),
);

const remoteWorkflow = run("gh", ["api", `repos/${repo}/actions/workflows/${workflow}`, "--jq", "{id,name,state,path}"]);
checks.push(
  remoteWorkflow.status === 0
    ? pass("远端 Release Dry Run workflow", outputSummary(remoteWorkflow))
    : fail("远端 Release Dry Run workflow", outputSummary(remoteWorkflow), "需要先提交并推送 .github/workflows/release-dry-run.yml 到远端默认分支"),
);

const remoteRunList = run("gh", [
  "run",
  "list",
  "--repo",
  repo,
  "--workflow",
  workflow,
  "--branch",
  ref,
  "--limit",
  "3",
  "--json",
  "databaseId,status,conclusion,url,createdAt",
]);
checks.push(
  remoteRunList.status === 0
    ? pass("远端 dry-run 历史", outputSummary(remoteRunList) || "[]")
    : warn("远端 dry-run 历史", outputSummary(remoteRunList), "远端 workflow 不存在时无法查询历史"),
);

const failures = checks.filter((check) => !check.ok);
const markdown = `# 发布 CI 预检记录

| 项目 | 值 |
|---|---|
| 生成时间 | ${generatedAt} |
| 仓库 | ${repo} |
| 分支 / ref | ${ref} |
| workflow | ${workflow} |
| 严格模式 | ${strict ? "是" : "否"} |
| 失败项数量 | ${failures.length} |

${markdownTable(checks)}

## 后续命令

\`\`\`bash
npm run release:submit-prep -- --write-doc
npm run release:submission-safety -- --strict --write-doc
npm run release:submission-plan -- --strict --write-doc
npm run release:submission-manifest -- --strict --write-doc
npm run release:submission-preview -- --strict --write-doc
npm run release:push-readiness -- --write-doc
git add --pathspec-from-file=release/submission-pathspec.txt --pathspec-file-nul
npm run release:tracking -- --strict --write-doc
git commit -m "chore: add release validation workflow"
git push origin ${ref}
npm run release:ci-preflight -- --strict --write-doc
npm run release:dry-run -- --write-doc
\`\`\`

> 本记录只验证远端 CI dry-run 前置条件，不包含任何 GitHub token 或 secret。
`;

const report = {
  generatedAt,
  repo,
  ref,
  workflow,
  strict,
  failures: failures.map((check) => check.label),
  checks,
};

mkdirSync(dirname(outputMarkdown), { recursive: true });
writeFileSync(outputMarkdown, markdown, "utf8");
writeFileSync(outputJson, `${JSON.stringify(report, null, 2)}\n`, "utf8");
if (writeDoc) {
  mkdirSync(dirname(docPath), { recursive: true });
  writeFileSync(docPath, replaceAutoSection(docPath, markdown), "utf8");
}

console.log(`Release CI preflight written to ${outputMarkdown} and ${outputJson}.`);
for (const check of checks) console.log(`- ${check.label}: ${check.status}`);

if (strict && failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure.label}`);
  process.exit(1);
}

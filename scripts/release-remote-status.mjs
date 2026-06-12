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

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
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

function runRows(runs) {
  if (!Array.isArray(runs) || runs.length === 0) return "无远端运行记录";
  return runs
    .slice(0, 5)
    .map((run) => `${run.databaseId ?? "?"}: ${run.status}/${run.conclusion ?? "无结论"} ${run.createdAt ?? ""} ${run.url ?? ""}`)
    .join("<br>");
}

function artifactSummary(artifacts) {
  if (!Array.isArray(artifacts) || artifacts.length === 0) return "无 artifacts";
  return artifacts
    .slice(0, 12)
    .map((artifact) => `${artifact.name} (${artifact.size_in_bytes ?? 0} bytes, expired=${artifact.expired ? "yes" : "no"})`)
    .join("<br>");
}

function replaceAutoSection(path, section) {
  const start = "<!-- AUTO_RELEASE_REMOTE_STATUS_START -->";
  const end = "<!-- AUTO_RELEASE_REMOTE_STATUS_END -->";
  const previous = existsSync(path) ? readFileSync(path, "utf8") : "";
  const block = `${start}\n${section.trim()}\n${end}`;
  if (previous.includes(start) && previous.includes(end)) {
    return previous.replace(new RegExp(`${start}[\\s\\S]*?${end}`), block);
  }
  return previous.trim() ? `${previous.trimEnd()}\n\n## 发布远端状态\n\n${block}\n` : `${block}\n`;
}

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function latestCompletedRun(runs) {
  return runs.find((run) => run.status === "completed") ?? runs[0];
}

function artifactsForRun(repo, runId) {
  if (!runId) return { result: undefined, artifacts: [] };
  const result = run("gh", ["api", `repos/${repo}/actions/runs/${runId}/artifacts`, "--paginate"]);
  const parsed = parseJson(result.stdout, {});
  return {
    result,
    artifacts: Array.isArray(parsed.artifacts) ? parsed.artifacts : [],
  };
}

function artifactNamesIncludeAll(names, expected) {
  return expected.every((part) => names.some((name) => name.toLowerCase().includes(part)));
}

const repo = argValue("--repo", process.env.GITHUB_REPOSITORY ?? "MilesDeanOracle/MoKnow");
const ref = argValue("--ref", run("git", ["branch", "--show-current"]).stdout.trim() || "main");
const releaseVersion = argValue("--version", process.env.MOKNOW_RELEASE_VERSION ?? `v${parseJson(readFileSync("package.json", "utf8"), {}).version ?? "0.1.0"}`);
const mode = argValue("--mode", "all");
const outputMarkdown = argValue("--output-md", "release/remote-status.md");
const outputJson = argValue("--output-json", "release/remote-status.json");
const docPath = argValue("--doc", "项目文档/发布远端状态记录.md");
const writeDoc = hasFlag("--write-doc");
const strict = hasFlag("--strict");
const generatedAt = new Date().toISOString();

const allWorkflowFiles = [
  { id: "dryRun", file: "release-dry-run.yml", label: "Release Dry Run", expectedArtifacts: ["macos", "windows", "linux", "verification"] },
  { id: "release", file: "release.yml", label: "Release", expectedArtifacts: ["macos", "windows", "linux", "verification"] },
];
const workflowFiles =
  mode === "dry-run"
    ? allWorkflowFiles.filter((workflow) => workflow.id === "dryRun")
    : mode === "release"
      ? allWorkflowFiles.filter((workflow) => workflow.id === "release")
      : allWorkflowFiles;

const checks = [];
const workflows = {};

const ghVersion = run("gh", ["--version"]);
checks.push(ghVersion.status === 0 ? pass("GitHub CLI", outputSummary(ghVersion)) : fail("GitHub CLI", outputSummary(ghVersion)));

for (const workflowDef of workflowFiles) {
  const workflowResult = run("gh", ["api", `repos/${repo}/actions/workflows/${workflowDef.file}`]);
  const workflow = parseJson(workflowResult.stdout, {});
  const workflowOk = workflowResult.status === 0 && Boolean(workflow.id);
  checks.push(
    workflowOk
      ? pass(`远端 ${workflowDef.label} workflow`, `${workflow.name ?? workflowDef.label} (${workflow.state ?? "unknown"}) ${workflow.path ?? workflowDef.file}`)
      : fail(`远端 ${workflowDef.label} workflow`, outputSummary(workflowResult), "需要先提交并推送 workflow 到远端默认分支"),
  );

  const runList = run("gh", [
    "run",
    "list",
    "--repo",
    repo,
    "--workflow",
    workflowDef.file,
    "--limit",
    "5",
    "--json",
    "databaseId,status,conclusion,url,createdAt,event,headBranch,headSha,displayTitle,workflowName",
  ]);
  const runs = runList.status === 0 ? parseJson(runList.stdout, []) : [];
  checks.push(
    runList.status === 0
      ? pass(`远端 ${workflowDef.label} 最近运行`, runRows(runs), runs.length > 0 ? "" : "尚未执行过该 workflow")
      : warn(`远端 ${workflowDef.label} 最近运行`, outputSummary(runList), "workflow 不存在或无权限时无法查询运行记录"),
  );

  const latest = latestCompletedRun(runs);
  const { result: artifactResult, artifacts } = artifactsForRun(repo, latest?.databaseId);
  const artifactNames = artifacts.map((artifact) => artifact.name ?? "");
  const artifactsOk = latest?.conclusion === "success" && artifactNamesIncludeAll(artifactNames, workflowDef.expectedArtifacts);
  checks.push(
    latest
      ? artifactsOk
        ? pass(`远端 ${workflowDef.label} artifacts`, artifactSummary(artifacts), `run ${latest.databaseId} 已成功并包含目标 artifacts`)
        : fail(
            `远端 ${workflowDef.label} artifacts`,
            artifactResult?.status === 0 ? artifactSummary(artifacts) : outputSummary(artifactResult ?? { stdout: "", stderr: "未查询", status: 1 }),
            `需要成功 run，并包含 ${workflowDef.expectedArtifacts.join(" / ")} artifacts；当前 run 结论为 ${latest.conclusion ?? "无结论"}`,
          )
      : fail(`远端 ${workflowDef.label} artifacts`, "无可用 run", "需要先执行远端 workflow"),
  );

  workflows[workflowDef.id] = {
    workflow,
    workflowOk,
    runs,
    latestRun: latest,
    artifacts,
    artifactsOk,
  };
}

const releaseView =
  mode === "dry-run"
    ? undefined
    : run("gh", [
        "release",
        "view",
        releaseVersion,
        "--repo",
        repo,
        "--json",
        "tagName,name,isDraft,isPrerelease,url,createdAt,publishedAt",
      ]);
const release = releaseView?.status === 0 ? parseJson(releaseView.stdout, undefined) : undefined;
if (mode !== "dry-run") {
  checks.push(
    release
      ? pass(
          `GitHub Release ${releaseVersion}`,
          `${release.name ?? release.tagName} draft=${release.isDraft ? "yes" : "no"} prerelease=${release.isPrerelease ? "yes" : "no"} ${release.url ?? ""}`,
        )
      : warn(`GitHub Release ${releaseVersion}`, outputSummary(releaseView ?? { stdout: "", stderr: "未查询", status: 1 }), "未推送 tag 或未创建 GitHub Release 时会缺失"),
  );
}

const failures = checks.filter((check) => !check.ok);
const markdown = `# 发布远端状态记录

| 项目 | 值 |
|---|---|
| 生成时间 | ${generatedAt} |
| 仓库 | ${repo} |
| 分支 / ref | ${ref} |
| Release 版本 | ${releaseVersion} |
| 检查模式 | ${mode} |
| 严格模式 | ${strict ? "是" : "否"} |
| 失败项数量 | ${failures.length} |

${markdownTable(checks)}

## 后续命令

\`\`\`bash
npm run release:tracking -- --strict --write-doc
npm run release:ci-preflight -- --strict --write-doc
npm run release:dry-run -- --write-doc
npm run release:remote-status -- --mode dry-run --strict --write-doc
npm run release:remote-status -- --mode release --strict --write-doc
\`\`\`

> 本记录只读取 GitHub workflow、run、artifact 和 Release 元数据，不读取 secrets，不触发远端 workflow。
`;

const report = {
  generatedAt,
  repo,
  ref,
  releaseVersion,
  mode,
  strict,
  failures: failures.map((check) => check.label),
  checks,
  workflows,
  release,
};

write(outputMarkdown, markdown);
write(outputJson, `${JSON.stringify(report, null, 2)}\n`);
if (writeDoc) write(docPath, replaceAutoSection(docPath, markdown));

console.log(`Release remote status written to ${outputMarkdown} and ${outputJson}.`);
for (const check of checks) console.log(`- ${check.label}: ${check.status}`);

if (strict && failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure.label}`);
  process.exit(1);
}

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

function readJson(path) {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

function summarizeOutput(result) {
  return `${result.stdout}\n${result.stderr}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-12)
    .join("<br>") || "无输出";
}

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function replaceAutoSection(path, section) {
  const start = "<!-- AUTO_RELEASE_SUBMIT_PREP_START -->";
  const end = "<!-- AUTO_RELEASE_SUBMIT_PREP_END -->";
  const previous = existsSync(path) ? readFileSync(path, "utf8") : "";
  const block = `${start}\n${section.trim()}\n${end}`;
  if (previous.includes(start) && previous.includes(end)) {
    return previous.replace(new RegExp(`${start}[\\s\\S]*?${end}`), block);
  }
  return previous.trim() ? `${previous.trimEnd()}\n\n## 发布提交前准备总览\n\n${block}\n` : `${block}\n`;
}

function commandText(command, commandArgs) {
  return [command, ...commandArgs].join(" ");
}

const outputMarkdown = argValue("--output-md", "release/submit-prep.md");
const outputJson = argValue("--output-json", "release/submit-prep.json");
const docPath = argValue("--doc", "项目文档/发布提交准备总览.md");
const writeDoc = hasFlag("--write-doc");
const strict = hasFlag("--strict");
const skipRemote = hasFlag("--skip-remote");
const generatedAt = new Date().toISOString();

if (writeDoc && !existsSync(docPath)) {
  write(
    docPath,
    replaceAutoSection(
      docPath,
      `# 发布提交前准备总览\n\n| 项目 | 值 |\n|---|---|\n| 生成时间 | ${generatedAt} |\n| 状态 | 正在生成，等待 release:submit-prep 完整报告写回 |`,
    ),
  );
}

const steps = [
  {
    id: "bootstrap-safety-doc",
    command: "npm",
    args: ["run", "release:submission-safety", "--", "--write-doc"],
    required: false,
    purpose: "先生成提交安全检查文档，避免后续 pathspec 因文档缺失而漏项。",
  },
  {
    id: "bootstrap-preview-doc",
    command: "npm",
    args: ["run", "release:submission-preview", "--", "--write-doc"],
    required: false,
    purpose: "先生成提交预演文档，避免后续 pathspec 因文档缺失而漏项。",
  },
  {
    id: "bootstrap-manifest-doc",
    command: "npm",
    args: ["run", "release:submission-manifest", "--", "--write-doc"],
    required: false,
    purpose: "先生成提交校验清单文档，避免后续 pathspec 因文档缺失而漏项。",
  },
  {
    id: "refresh-plan",
    command: "npm",
    args: ["run", "release:submission-plan", "--", "--write-doc"],
    required: true,
    purpose: "刷新 NUL 分隔 pathspec 和提交计划。",
  },
  {
    id: "strict-safety",
    command: "npm",
    args: ["run", "release:submission-safety", "--", "--strict", "--write-doc"],
    required: true,
    purpose: "严格扫描待提交文件中的密钥、证书、私钥、生成产物和额外路径风险。",
  },
  {
    id: "strict-plan",
    command: "npm",
    args: ["run", "release:submission-plan", "--", "--strict", "--write-doc"],
    required: true,
    purpose: "严格验证 pathspec 覆盖、git add dry-run 和临时 index 入库模拟。",
  },
  {
    id: "strict-manifest",
    command: "npm",
    args: ["run", "release:submission-manifest", "--", "--strict", "--write-doc"],
    required: true,
    purpose: "严格生成待提交文件 SHA-256 校验清单。",
  },
  {
    id: "strict-preview",
    command: "npm",
    args: ["run", "release:submission-preview", "--", "--strict", "--write-doc"],
    required: true,
    purpose: "严格预演提交 tree、diff 统计和必需文件临时入库状态。",
  },
  {
    id: "push-readiness",
    command: "npm",
    args: ["run", "release:push-readiness", "--", "--write-doc"],
    required: true,
    remote: true,
    purpose: "刷新当前分支、upstream、GitHub CLI 和远端 workflow 状态。",
  },
  {
    id: "ci-preflight",
    command: "npm",
    args: ["run", "release:ci-preflight", "--", "--write-doc"],
    required: false,
    remote: true,
    purpose: "刷新远端 CI dry-run 前置条件报告；远端 workflow 未推送时允许以报告形式保留失败项。",
  },
];

const results = [];
for (const step of steps) {
  if (skipRemote && step.remote) {
    results.push({
      ...step,
      status: "skipped",
      ok: true,
      exitCode: 0,
      summary: "已按 --skip-remote 跳过",
    });
    continue;
  }
  const result = run(step.command, step.args);
  results.push({
    ...step,
    status: result.status === 0 ? "passed" : "failed",
    ok: result.status === 0 || !step.required,
    exitCode: result.status,
    summary: summarizeOutput(result),
  });
}

const safety = readJson("release/submission-safety.json");
const plan = readJson("release/submission-plan.json");
const manifest = readJson("release/submission-manifest.json");
const preview = readJson("release/submission-preview.json");
const push = readJson("release/push-readiness.json");
const ci = readJson("release/ci-preflight.json");
const requiredFailures = results.filter((result) => result.required && result.status !== "passed");
const reportFailures = [
  ...(safety?.failures?.length ? safety.failures.map((failure) => `提交安全：${failure}`) : []),
  ...(plan?.missing?.length ? plan.missing.map((path) => `提交计划缺失：${path}`) : []),
  ...(plan?.ignored?.length ? plan.ignored.map((path) => `提交计划被忽略：${path}`) : []),
  ...(manifest?.failures?.length ? manifest.failures.map((failure) => `提交校验清单：${failure}`) : []),
  ...(preview?.failures?.length ? preview.failures.map((failure) => `提交预演：${failure}`) : []),
  ...(push?.failures?.length ? push.failures.map((failure) => `推送准备：${failure}`) : []),
];
const failures = [
  ...requiredFailures.map((result) => `${result.id}: exit ${result.exitCode}`),
  ...reportFailures,
];
const commandBlock = [
  "npm run release:submit-prep -- --write-doc",
  "npm run release:submission-manifest -- --strict --write-doc",
  "git add --pathspec-from-file=release/submission-pathspec.txt --pathspec-file-nul",
  "npm run release:tracking -- --strict --write-doc",
  'git commit -m "chore: add release validation workflow"',
  "git push origin main",
  "npm run release:ci-preflight -- --strict --write-doc",
  "npm run release:dry-run -- --write-doc",
];

const markdown = `# 发布提交前准备总览

| 项目 | 值 |
|---|---|
| 生成时间 | ${generatedAt} |
| 严格模式 | ${strict ? "是" : "否"} |
| 跳过远端检查 | ${skipRemote ? "是" : "否"} |
| 失败项数量 | ${failures.length} |
| 提交安全扫描 | ${safety ? `${safety.scannedCount} 个文件，失败 ${safety.failures?.length ?? 0}` : "报告缺失"} |
| 提交计划 | ${plan ? `${plan.requiredCount} 个必需文件，pathspec ${plan.pathspecCount} 项，未入库 ${plan.untracked?.length ?? 0} 个` : "报告缺失"} |
| 提交校验清单 | ${
  manifest
    ? `${manifest.fileCount} 个文件，${manifest.hashedFileCount ?? manifest.fileCount} 个参与聚合，SHA-256 ${manifest.aggregateHash}`
    : "报告缺失"
} |
| 提交预演 | ${preview ? `tree ${preview.tree || "未生成"}，失败 ${preview.failures?.length ?? 0}` : "报告缺失"} |
| 推送准备 | ${push ? `失败 ${push.failures?.length ?? 0}，警告 ${push.warnings?.length ?? 0}` : "报告缺失"} |
| CI 预检 | ${ci ? `失败 ${ci.failures?.length ?? 0}` : "报告缺失"} |

## 执行步骤

| 步骤 | 命令 | 结论 | 必需 | 用途 | 摘要 |
|---|---|---|---|---|---|
${results
  .map(
    (result) =>
      `| ${result.id} | \`${commandText(result.command, result.args)}\` | ${result.status} | ${result.required ? "是" : "否"} | ${result.purpose} | ${result.summary} |`,
  )
  .join("\n")}

## 后续命令

\`\`\`bash
${commandBlock.join("\n")}
\`\`\`

> 本脚本只运行非破坏性检查并生成报告，不执行真实 \`git add\`、\`git commit\` 或 \`git push\`。
`;

const report = {
  generatedAt,
  strict,
  skipRemote,
  failures,
  results,
  summary: {
    safety: safety
      ? {
          scannedCount: safety.scannedCount,
          failureCount: safety.failures?.length ?? 0,
          warningCount: safety.warnings?.length ?? 0,
        }
      : null,
    plan: plan
      ? {
          requiredCount: plan.requiredCount,
          pathspecCount: plan.pathspecCount,
          untrackedCount: plan.untracked?.length ?? 0,
          gitAddDryRunOk: Boolean(plan.gitAddDryRun?.ok),
          simulatedStrictTrackingOk: Boolean(plan.simulatedStrictTracking?.ok),
        }
      : null,
    manifest: manifest
      ? {
          fileCount: manifest.fileCount,
          aggregateHash: manifest.aggregateHash,
          failureCount: manifest.failures?.length ?? 0,
        }
      : null,
    preview: preview
      ? {
          tree: preview.tree,
          requiredCount: preview.requiredCount,
          pathspecCount: preview.pathspecCount,
          failureCount: preview.failures?.length ?? 0,
        }
      : null,
    push: push
      ? {
          failureCount: push.failures?.length ?? 0,
          warningCount: push.warnings?.length ?? 0,
        }
      : null,
    ci: ci
      ? {
          failureCount: ci.failures?.length ?? 0,
        }
      : null,
  },
  commandBlock,
};

write(outputMarkdown, markdown);
write(outputJson, `${JSON.stringify(report, null, 2)}\n`);
if (writeDoc) write(docPath, replaceAutoSection(docPath, markdown));

console.log(`Release submit prep written to ${outputMarkdown} and ${outputJson}.`);
console.log(`- Failures: ${failures.length}`);
console.log(`- Required files: ${report.summary.plan?.requiredCount ?? "unknown"}`);
console.log(`- Preview tree: ${report.summary.preview?.tree ?? "not generated"}`);

if (strict && failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}

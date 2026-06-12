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

function cleanCell(value) {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replace(/\r?\n/g, "<br>")
    .trim();
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
    ...rows.map((row) => `| ${cleanCell(row.label)} | ${row.status} | ${cleanCell(row.evidence)} | ${cleanCell(row.note)} |`),
  ].join("\n");
}

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function replaceAutoSection(path, section) {
  const start = "<!-- AUTO_WORKFLOW_VALIDATION_START -->";
  const end = "<!-- AUTO_WORKFLOW_VALIDATION_END -->";
  const previous = existsSync(path) ? readFileSync(path, "utf8") : "";
  const block = `${start}\n${section.trim()}\n${end}`;
  if (previous.includes(start) && previous.includes(end)) {
    return previous.replace(new RegExp(`${start}[\\s\\S]*?${end}`), block);
  }
  return previous.trim() ? `${previous.trimEnd()}\n\n## Release Workflow 结构验证\n\n${block}\n` : `${block}\n`;
}

function parseYaml(path) {
  const result = spawnSync(
    "ruby",
    ["-ryaml", "-rjson", "-e", "puts JSON.generate(YAML.load_file(ARGV[0]))", path],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    return { ok: false, data: undefined, error: `${result.stdout}\n${result.stderr}`.trim() || "Ruby YAML parser failed" };
  }
  try {
    return { ok: true, data: JSON.parse(result.stdout), error: "" };
  } catch (error) {
    return { ok: false, data: undefined, error: error instanceof Error ? error.message : String(error) };
  }
}

function valuesFromMatrix(workflow) {
  return workflow?.jobs?.build?.strategy?.matrix?.include ?? [];
}

function stepList(workflow, jobName) {
  return workflow?.jobs?.[jobName]?.steps ?? [];
}

function stepHasRun(steps, snippet) {
  return steps.some((step) => typeof step.run === "string" && step.run.includes(snippet));
}

function stepHasUses(steps, snippet) {
  return steps.some((step) => typeof step.uses === "string" && step.uses.includes(snippet));
}

function stepWithUses(steps, snippet) {
  return steps.find((step) => typeof step.uses === "string" && step.uses.includes(snippet));
}

function textIncludesAll(text, snippets) {
  return snippets.every((snippet) => text.includes(snippet));
}

function validateWorkflow({ path, kind, expectedName }) {
  const checks = [];
  if (!existsSync(path)) {
    return { checks: [fail(`${path} 文件`, "文件不存在")], parsed: false };
  }

  const text = readFileSync(path, "utf8");
  const parsed = parseYaml(path);
  checks.push(parsed.ok ? pass(`${path} YAML 解析`, "Ruby YAML 解析通过") : fail(`${path} YAML 解析`, parsed.error));
  const workflow = parsed.data ?? {};
  const trigger = workflow.on ?? workflow.true;
  const matrix = valuesFromMatrix(workflow);
  const buildSteps = stepList(workflow, "build");
  const verifySteps = stepList(workflow, "verify");
  const platforms = matrix.map((item) => `${item.platform}:${item.os}`);

  checks.push(workflow.name === expectedName ? pass(`${path} workflow 名称`, workflow.name) : fail(`${path} workflow 名称`, workflow.name || "缺失"));
  checks.push(workflow.jobs?.build ? pass(`${path} build job`, "存在") : fail(`${path} build job`, "缺失"));
  checks.push(workflow.jobs?.verify ? pass(`${path} verify job`, "存在") : fail(`${path} verify job`, "缺失"));
  checks.push(workflow.jobs?.verify?.needs === "build" ? pass(`${path} verify needs build`, "needs: build") : fail(`${path} verify needs build`, workflow.jobs?.verify?.needs ?? "缺失"));
  checks.push(
    ["macOS:macos-latest", "Windows:windows-latest", "Linux:ubuntu-22.04"].every((value) => platforms.includes(value))
      ? pass(`${path} 三平台矩阵`, platforms.join(", "))
      : fail(`${path} 三平台矩阵`, platforms.join(", ") || "缺失"),
  );
  checks.push(stepHasUses(buildSteps, "actions/checkout") ? pass(`${path} build checkout`, "存在") : fail(`${path} build checkout`, "缺失"));
  checks.push(stepHasUses(buildSteps, "actions/setup-node") ? pass(`${path} build setup-node`, "存在") : fail(`${path} build setup-node`, "缺失"));
  checks.push(stepHasUses(buildSteps, "dtolnay/rust-toolchain") ? pass(`${path} build Rust stable`, "存在") : fail(`${path} build Rust stable`, "缺失"));
  checks.push(stepHasRun(buildSteps, "npm ci") ? pass(`${path} npm ci`, "存在") : fail(`${path} npm ci`, "缺失"));
  checks.push(stepHasRun(buildSteps, "npm run test") ? pass(`${path} 前端测试`, "存在") : fail(`${path} 前端测试`, "缺失"));
  checks.push(stepHasRun(buildSteps, "npm run build") ? pass(`${path} 前端构建`, "存在") : fail(`${path} 前端构建`, "缺失"));
  checks.push(stepHasRun(buildSteps, "npm run ai:e2e:auto -- --write-doc") ? pass(`${path} AI 证据`, "存在") : fail(`${path} AI 证据`, "缺失"));
  checks.push(text.includes("secrets.AI_E2E_API_KEY") ? pass(`${path} AI secret 透传`, "存在") : fail(`${path} AI secret 透传`, "缺失"));
  checks.push(stepHasUses(buildSteps, "tauri-apps/tauri-action") ? pass(`${path} Tauri 构建`, "存在") : fail(`${path} Tauri 构建`, "缺失"));
  checks.push(stepHasUses(buildSteps, "actions/upload-artifact") ? pass(`${path} build artifacts 上传`, "存在") : fail(`${path} build artifacts 上传`, "缺失"));
  checks.push(stepHasUses(verifySteps, "actions/download-artifact") ? pass(`${path} verify artifacts 下载`, "存在") : fail(`${path} verify artifacts 下载`, "缺失"));
  checks.push(stepHasRun(verifySteps, "npm run release:workflow-validate") ? pass(`${path} verify workflow 结构验证`, "存在") : fail(`${path} verify workflow 结构验证`, "缺失"));
  checks.push(stepHasRun(verifySteps, "npm run release:downloads") && text.includes("--platform all") ? pass(`${path} 三平台下载验证`, "存在") : fail(`${path} 三平台下载验证`, "缺失"));
  checks.push(stepHasRun(verifySteps, "npm run release:aggregate-evidence") ? pass(`${path} evidence 聚合`, "存在") : fail(`${path} evidence 聚合`, "缺失"));
  checks.push(stepHasRun(verifySteps, "npm run release:final-audit") ? pass(`${path} 最终审计`, "存在") : fail(`${path} 最终审计`, "缺失"));

  const uploadStep = stepWithUses(buildSteps, "actions/upload-artifact");
  const uploadPath = uploadStep?.with?.path ?? "";
  checks.push(
    textIncludesAll(String(uploadPath), [".dmg", ".exe", ".msi", ".AppImage", ".deb", ".rpm", "release/**/*.json", "release/**/*.md"])
      ? pass(`${path} artifact 路径覆盖`, "包含 macOS / Windows / Linux / release 报告")
      : fail(`${path} artifact 路径覆盖`, String(uploadPath) || "缺失"),
  );

  const verifyUploadStep = stepWithUses(verifySteps, "actions/upload-artifact");
  const verifyUploadPath = verifyUploadStep?.with?.path ?? "";
  checks.push(
    textIncludesAll(String(verifyUploadPath), ["release/workflow-validation.json", "release/workflow-validation.md", "release/final-progress-audit.json"])
      ? pass(`${path} verify 报告上传`, "包含 workflow validation 和 final audit")
      : fail(`${path} verify 报告上传`, String(verifyUploadPath) || "缺失"),
  );

  if (kind === "release") {
    checks.push(trigger?.push?.tags?.includes("v*") ? pass(`${path} tag 触发`, "v*") : fail(`${path} tag 触发`, JSON.stringify(trigger ?? {})));
    checks.push(stepHasRun(buildSteps, "npm run release:updater-config") ? pass(`${path} updater config`, "存在") : fail(`${path} updater config`, "缺失"));
    checks.push(text.includes("--config src-tauri/tauri.updater.conf.json") ? pass(`${path} updater config 构建参数`, "存在") : fail(`${path} updater config 构建参数`, "缺失"));
    checks.push(text.includes("--require-updater-signatures") ? pass(`${path} updater 签名要求`, "存在") : fail(`${path} updater 签名要求`, "缺失"));
    checks.push(stepHasRun(buildSteps, "npm run release:signing -- --require-signed --require-notarized") ? pass(`${path} 签名公证严格验证`, "存在") : fail(`${path} 签名公证严格验证`, "缺失"));
    checks.push(stepHasRun(buildSteps, "npm run release:metadata -- --require-base-url --require-updater-signatures") ? pass(`${path} metadata 严格生成`, "存在") : fail(`${path} metadata 严格生成`, "缺失"));
    checks.push(stepHasRun(buildSteps, "npm run release:distribution -- --strict") ? pass(`${path} 分发严格验证`, "存在") : fail(`${path} 分发严格验证`, "缺失"));
    checks.push(text.includes("gh release upload") ? pass(`${path} Draft Release 上传`, "存在") : fail(`${path} Draft Release 上传`, "缺失"));
    checks.push(
      text.includes("release/workflow-validation.json") && text.includes("release/workflow-validation.md")
        ? pass(`${path} Draft Release workflow 验证报告上传`, "存在")
        : fail(`${path} Draft Release workflow 验证报告上传`, "缺失"),
    );
  } else {
    checks.push(trigger?.workflow_dispatch !== undefined ? pass(`${path} 手动触发`, "workflow_dispatch") : fail(`${path} 手动触发`, JSON.stringify(trigger ?? {})));
    checks.push(trigger?.pull_request ? pass(`${path} PR 触发`, "pull_request") : warn(`${path} PR 触发`, "未配置"));
    checks.push(stepHasRun(buildSteps, "npm run release:artifacts") ? pass(`${path} dry-run 产物检查`, "存在") : fail(`${path} dry-run 产物检查`, "缺失"));
    checks.push(stepHasRun(buildSteps, "npm run release:install-smoke") ? pass(`${path} dry-run 安装冒烟`, "存在") : fail(`${path} dry-run 安装冒烟`, "缺失"));
    checks.push(stepHasRun(buildSteps, "npm run release:signing") ? pass(`${path} dry-run 签名报告`, "存在") : fail(`${path} dry-run 签名报告`, "缺失"));
  }

  return { checks, parsed: parsed.ok };
}

const outputMarkdown = argValue("--output-md", "release/workflow-validation.md");
const outputJson = argValue("--output-json", "release/workflow-validation.json");
const docPath = argValue("--doc", "项目文档/发布Workflow结构验证记录.md");
const writeDoc = hasFlag("--write-doc");
const strict = hasFlag("--strict");
const generatedAt = new Date().toISOString();

const validations = [
  validateWorkflow({ path: ".github/workflows/release-dry-run.yml", kind: "dry-run", expectedName: "Release Dry Run" }),
  validateWorkflow({ path: ".github/workflows/release.yml", kind: "release", expectedName: "Release" }),
];
const checks = validations.flatMap((validation) => validation.checks);
const failures = checks.filter((check) => !check.ok);

const markdown = `# Release Workflow 结构验证记录

| 项目 | 值 |
|---|---|
| 生成时间 | ${generatedAt} |
| 严格模式 | ${strict ? "是" : "否"} |
| 检查项数量 | ${checks.length} |
| 失败项数量 | ${failures.length} |

${markdownTable(checks)}

> 本验证会解析 GitHub Actions YAML，并检查三平台矩阵、build / verify job、artifact 上传下载、AI 证据、聚合验证和正式 Release 严格签名分发门禁。
`;

const report = {
  generatedAt,
  strict,
  failures: failures.map((check) => check.label),
  checks,
};

write(outputMarkdown, markdown);
write(outputJson, `${JSON.stringify(report, null, 2)}\n`);
if (writeDoc) write(docPath, replaceAutoSection(docPath, markdown));

console.log(`Release workflow validation written to ${outputMarkdown} and ${outputJson}.`);
for (const check of checks) console.log(`- ${check.label}: ${check.status}`);

if (strict && failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure.label}`);
  process.exit(1);
}

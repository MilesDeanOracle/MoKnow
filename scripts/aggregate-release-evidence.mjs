#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const args = process.argv.slice(2);

function argValue(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

function walk(root) {
  if (!existsSync(root)) return [];
  const entries = [];
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    const stat = statSync(path);
    if (stat.isDirectory()) entries.push(...walk(path));
    if (stat.isFile()) entries.push(path);
  }
  return entries;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

function asPosix(path) {
  return path.replaceAll("\\", "/");
}

function findReports(root, fileName) {
  return walk(root)
    .filter((path) => asPosix(path).endsWith(`/release/${fileName}`) || asPosix(path).endsWith(`/${fileName}`))
    .map((path) => ({ path, report: readJson(path) }))
    .filter((entry) => entry.report);
}

function evidenceScore(check) {
  let score = 0;
  if (check.ok) score += 100;
  if (check.status === "通过") score += 20;
  if (check.status === "签名通过，未确认公证") score += 15;
  if (check.status === "待平台验证") score -= 20;
  if (check.status === "未找到产物") score -= 30;
  if (check.notarized) score += 10;
  if (String(check.evidence ?? "").includes("需要在")) score -= 10;
  return score;
}

function mergeChecks(reports, options = {}) {
  const byLabel = new Map();
  for (const { path, report } of reports) {
    for (const check of report.checks ?? []) {
      if (options.skipManualOpen && check.label === "实机打开与仓库读写") continue;
      const enriched = {
        ...check,
        sourceReport: relative(".", path),
      };
      const previous = byLabel.get(check.label);
      if (!previous || evidenceScore(enriched) > evidenceScore(previous)) {
        byLabel.set(check.label, enriched);
      }
    }
  }
  return [...byLabel.values()];
}

function mergeManualOpen(reports) {
  const checks = reports.flatMap(({ path, report }) =>
    (report.checks ?? [])
      .filter((check) => check.label === "实机打开与仓库读写")
      .map((check) => ({ ...check, sourceReport: relative(".", path) })),
  );
  if (checks.some((check) => check.status === "通过" || check.ok === true)) {
    return { ...checks.find((check) => check.status === "通过" || check.ok === true), status: "通过", ok: true };
  }
  if (checks.some((check) => check.status === "未通过" || check.ok === false)) {
    return { ...checks.find((check) => check.status === "未通过" || check.ok === false), status: "未通过", ok: false };
  }
  return {
    label: "实机打开与仓库读写",
    ok: true,
    status: "待人工",
    evidence: "待实机执行",
    note: "人工安装后打开应用，创建/打开仓库，创建 Markdown，保存并重启确认可读取",
    sourceReport: checks.map((check) => check.sourceReport).join("<br>") || "无平台报告",
  };
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function markdownTable(rows) {
  return [
    "| 项目 | 结论 | 证据 | 来源报告 | 备注 |",
    "|---|---|---|---|---|",
    ...rows.map((row) => `| ${row.label} | ${row.status ?? (row.ok ? "通过" : "未通过")} | ${row.evidence} | ${row.sourceReport ?? ""} | ${row.note ?? ""} |`),
  ].join("\n");
}

const artifactRoot = argValue("--artifact-root", "release/downloaded-artifacts");
const outputDir = argValue("--output-dir", "release");
const installOutputJson = argValue("--install-output-json", join(outputDir, "install-smoke.json"));
const installOutputMarkdown = argValue("--install-output-md", join(outputDir, "install-smoke.md"));
const signingOutputJson = argValue("--signing-output-json", join(outputDir, "signing-verification.json"));
const signingOutputMarkdown = argValue("--signing-output-md", join(outputDir, "signing-verification.md"));
const aggregateOutputJson = argValue("--output-json", join(outputDir, "aggregate-evidence.json"));
const aggregateOutputMarkdown = argValue("--output-md", join(outputDir, "aggregate-evidence.md"));
const generatedAt = new Date().toISOString();

const installReports = findReports(artifactRoot, "install-smoke.json");
const signingReports = findReports(artifactRoot, "signing-verification.json");
const installChecks = [...mergeChecks(installReports, { skipManualOpen: true }), mergeManualOpen(installReports)];
const signingChecks = mergeChecks(signingReports);
const selectedPlatforms = unique([
  ...installReports.flatMap(({ report }) => report.selectedPlatforms ?? []),
  ...signingReports.flatMap(({ report }) => report.selectedPlatforms ?? []),
]);

const installReport = {
  generatedAt,
  source: "Aggregated GitHub Actions artifact reports",
  artifactRoot,
  selectedPlatforms,
  checks: installChecks,
  sourceReports: installReports.map((entry) => relative(".", entry.path)),
};

const signingReport = {
  generatedAt,
  artifactRoot,
  selectedPlatforms,
  requireSigned: false,
  requireNotarized: false,
  checks: signingChecks,
  sourceReports: signingReports.map((entry) => relative(".", entry.path)),
};

const aggregateReport = {
  generatedAt,
  artifactRoot,
  installReports: installReport.sourceReports,
  signingReports: signingReport.sourceReports,
  selectedPlatforms,
  installCheckCount: installChecks.length,
  signingCheckCount: signingChecks.length,
};

const installMarkdown = `# 发布产物安装冒烟验证

| 项目 | 值 |
|---|---|
| 生成时间 | ${generatedAt} |
| 来源 | Aggregated GitHub Actions artifact reports |
| 目录 | ${artifactRoot} |
| 平台范围 | ${selectedPlatforms.join(", ") || "未知"} |

${markdownTable(installChecks)}
`;

const signingMarkdown = `# 发布签名与公证验证记录

| 项目 | 值 |
|---|---|
| 生成时间 | ${generatedAt} |
| 来源 | Aggregated GitHub Actions artifact reports |
| 目录 | ${artifactRoot} |
| 平台范围 | ${selectedPlatforms.join(", ") || "未知"} |

${markdownTable(signingChecks)}
`;

const aggregateMarkdown = `# 发布证据聚合记录

| 项目 | 值 |
|---|---|
| 生成时间 | ${generatedAt} |
| 目录 | ${artifactRoot} |
| 安装冒烟来源报告 | ${installReport.sourceReports.length} |
| 签名验证来源报告 | ${signingReport.sourceReports.length} |
| 平台范围 | ${selectedPlatforms.join(", ") || "未知"} |

## 安装冒烟

${markdownTable(installChecks)}

## 签名与公证

${markdownTable(signingChecks)}
`;

for (const path of [installOutputJson, installOutputMarkdown, signingOutputJson, signingOutputMarkdown, aggregateOutputJson, aggregateOutputMarkdown]) {
  mkdirSync(dirname(path), { recursive: true });
}
writeFileSync(installOutputJson, `${JSON.stringify(installReport, null, 2)}\n`, "utf8");
writeFileSync(installOutputMarkdown, installMarkdown, "utf8");
writeFileSync(signingOutputJson, `${JSON.stringify(signingReport, null, 2)}\n`, "utf8");
writeFileSync(signingOutputMarkdown, signingMarkdown, "utf8");
writeFileSync(aggregateOutputJson, `${JSON.stringify(aggregateReport, null, 2)}\n`, "utf8");
writeFileSync(aggregateOutputMarkdown, aggregateMarkdown, "utf8");

console.log(`Aggregated ${installReports.length} install smoke report(s) and ${signingReports.length} signing report(s).`);
console.log(`Install smoke aggregate written to ${installOutputJson}.`);
console.log(`Signing aggregate written to ${signingOutputJson}.`);

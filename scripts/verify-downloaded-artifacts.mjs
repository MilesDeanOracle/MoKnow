#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";

const args = process.argv.slice(2);

function argValue(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

function hasFlag(name) {
  return args.includes(name);
}

function walk(root) {
  if (!existsSync(root)) return [];
  const entries = [];
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      entries.push(...walk(path));
    } else if (stat.isFile()) {
      entries.push(path);
    }
  }
  return entries;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

function asPosix(path) {
  return path.replaceAll("\\", "/").toLowerCase();
}

function classify(file) {
  const normalized = asPosix(file);
  const name = basename(file).toLowerCase();
  if (name.endsWith(".sig")) return "updater signature";
  if (name === "latest.json") return "updater latest.json";
  if (name === "downloads.json") return "downloads manifest";
  if (normalized.endsWith("/homebrew/moknow.rb") || name === "moknow.rb") return "Homebrew cask";
  if (name.endsWith(".dmg") || name.endsWith(".app.tar.gz")) return "macos";
  if (name.endsWith(".msi") || name.endsWith(".exe")) return "windows";
  if (name.endsWith(".appimage") || name.endsWith(".deb") || name.endsWith(".rpm")) return "linux";
  if (name.endsWith(".tar.gz") || name.endsWith(".zip")) return "updater bundle";
  return undefined;
}

function markdownTable(rows) {
  return [
    "| 项目 | 结论 | 文件数 | 备注 |",
    "|---|---|---:|---|",
    ...rows.map((row) => `| ${row.label} | ${row.ok ? "通过" : "未通过"} | ${row.count} | ${row.note} |`),
  ].join("\n");
}

function readLatestJson(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return parsed?.platforms && typeof parsed.platforms === "object" ? Object.keys(parsed.platforms).length : 0;
  } catch {
    return 0;
  }
}

function replaceAutoSection(path, section) {
  const start = "<!-- AUTO_DOWNLOAD_VERIFY_START -->";
  const end = "<!-- AUTO_DOWNLOAD_VERIFY_END -->";
  const previous = existsSync(path) ? readFileSync(path, "utf8") : "";
  const block = `${start}\n${section.trim()}\n${end}`;
  if (previous.includes(start) && previous.includes(end)) {
    return previous.replace(new RegExp(`${start}[\\s\\S]*?${end}`), block);
  }
  return `${previous.trimEnd()}\n\n## 自动下载完整性验证\n\n${block}\n`;
}

const artifactRoot = argValue("--artifact-root", "release/downloaded-artifacts");
const outputJson = argValue("--output-json", "release/download-verification.json");
const outputMarkdown = argValue("--output-md", "release/download-verification.md");
const docPath = argValue("--doc", "项目文档/发布产物验证记录.md");
const source = argValue("--source", "GitHub Actions artifact download");
const platform = argValue("--platform", "all");
const requireUpdaterSignatures = hasFlag("--require-updater-signatures");
const requireMetadata = hasFlag("--require-metadata");
const writeDoc = hasFlag("--write-doc");
const selectedPlatforms = platform === "all" ? ["macos", "windows", "linux"] : platform.split(",").map((item) => item.trim()).filter(Boolean);
const knownPlatforms = new Set(["macos", "windows", "linux"]);

for (const selectedPlatform of selectedPlatforms) {
  if (!knownPlatforms.has(selectedPlatform)) {
    console.error(`Unknown platform ${selectedPlatform}. Expected one of: macos, windows, linux, all.`);
    process.exit(1);
  }
}

const files = walk(artifactRoot);
const grouped = new Map();
for (const file of files) {
  const type = classify(file);
  if (!type) continue;
  if (!grouped.has(type)) grouped.set(type, []);
  grouped.get(type).push(file);
}

const latestJsonFiles = grouped.get("updater latest.json") ?? [];
const latestPlatformCount = latestJsonFiles.reduce((total, file) => total + readLatestJson(file), 0);

const platformChecks = {
  macos: {
    label: "macOS 安装包",
    ok: (grouped.get("macos") ?? []).length > 0,
    count: (grouped.get("macos") ?? []).length,
    note: "需要包含 .dmg 或 .app.tar.gz",
  },
  windows: {
    label: "Windows 安装包",
    ok: (grouped.get("windows") ?? []).length > 0,
    count: (grouped.get("windows") ?? []).length,
    note: "需要包含 .exe 或 .msi",
  },
  linux: {
    label: "Linux 安装包",
    ok: (grouped.get("linux") ?? []).length > 0,
    count: (grouped.get("linux") ?? []).length,
    note: "需要包含 .AppImage、.deb 或 .rpm",
  },
};

const checks = [
  ...selectedPlatforms.map((selectedPlatform) => platformChecks[selectedPlatform]),
  {
    label: "分发元数据",
    ok: (grouped.get("downloads manifest") ?? []).length > 0 && latestJsonFiles.length > 0 && (grouped.get("Homebrew cask") ?? []).length > 0,
    count: (grouped.get("downloads manifest") ?? []).length + latestJsonFiles.length + (grouped.get("Homebrew cask") ?? []).length,
    note: "需要 downloads.json、latest.json 和 homebrew/moknow.rb",
  },
  {
    label: "Updater 签名",
    ok: !requireUpdaterSignatures || ((grouped.get("updater signature") ?? []).length > 0 && latestPlatformCount > 0),
    count: (grouped.get("updater signature") ?? []).length,
    note: requireUpdaterSignatures ? "需要 .sig 且 latest.json 至少包含一个平台" : "未强制要求",
  },
];

const failures = [];
for (const check of checks) {
  if (!check.ok && (check.label !== "分发元数据" || requireMetadata)) {
    failures.push(`${check.label} 未通过：${check.note}`);
  }
}

const artifacts = [];
for (const [type, groupFiles] of [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  for (const file of groupFiles.sort()) {
    const stat = statSync(file);
    artifacts.push({
      type,
      path: relative(".", file),
      size: stat.size,
      sizeText: formatBytes(stat.size),
      sha256: sha256(file),
    });
  }
}

const generatedAt = new Date().toISOString();
const report = {
  generatedAt,
  source,
  artifactRoot,
  checks,
  artifacts,
};

mkdirSync(dirname(outputJson), { recursive: true });
writeFileSync(outputJson, `${JSON.stringify(report, null, 2)}\n`, "utf8");

const markdown = `# 发布产物下载完整性验证

| 项目 | 值 |
|---|---|
| 生成时间 | ${generatedAt} |
| 来源 | ${source} |
| 目录 | ${artifactRoot} |
| 平台范围 | ${selectedPlatforms.join(", ")} |

${markdownTable(checks)}

## 文件清单

| 类型 | 文件 | 大小 | SHA-256 |
|---|---|---:|---|
${artifacts.map((artifact) => `| ${artifact.type} | \`${artifact.path}\` | ${artifact.sizeText} | \`${artifact.sha256}\` |`).join("\n") || "| 无 | 无 | 0 B | 无 |"}
`;

mkdirSync(dirname(outputMarkdown), { recursive: true });
writeFileSync(outputMarkdown, markdown, "utf8");

if (writeDoc) {
  writeFileSync(docPath, replaceAutoSection(docPath, markdown), "utf8");
}

console.log(`Downloaded artifact verification written to ${outputMarkdown} and ${outputJson}.`);
for (const check of checks) {
  console.log(`- ${check.label}: ${check.ok ? "passed" : "failed"} (${check.count})`);
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}

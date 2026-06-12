#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";

const args = process.argv.slice(2);

function argValue(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

function hasFlag(name) {
  return args.includes(name);
}

function readJson(path) {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

function currentPlatform() {
  if (process.platform === "darwin") return "macos";
  if (process.platform === "win32") return "windows";
  return "linux";
}

function walkEntries(root) {
  if (!existsSync(root)) return [];
  const entries = [];
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    const stat = statSync(path);
    entries.push({ path, stat });
    if (stat.isDirectory()) entries.push(...walkEntries(path));
  }
  return entries;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

function asPosix(path) {
  return path.replaceAll("\\", "/");
}

function run(command, commandArgs) {
  return spawnSync(command, commandArgs, {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
}

function readPlistJson(plistPath) {
  if (process.platform !== "darwin") return undefined;
  const result = run("plutil", ["-convert", "json", "-o", "-", plistPath]);
  if (result.status !== 0 || !result.stdout) return undefined;
  try {
    return JSON.parse(result.stdout);
  } catch {
    return undefined;
  }
}

function inspectMacApp(appPath) {
  const infoPlist = join(appPath, "Contents", "Info.plist");
  const plist = existsSync(infoPlist) ? readPlistJson(infoPlist) : undefined;
  const executableName = plist?.CFBundleExecutable ?? "moknow";
  const executablePath = join(appPath, "Contents", "MacOS", executableName);
  const executableStat = existsSync(executablePath) ? statSync(executablePath) : undefined;
  const executableOk = Boolean(executableStat?.isFile()) && (process.platform !== "darwin" || (executableStat.mode & 0o111) !== 0);

  return {
    appPath,
    productName: plist?.CFBundleDisplayName ?? plist?.CFBundleName ?? basename(appPath, ".app"),
    version: plist?.CFBundleShortVersionString ?? plist?.CFBundleVersion ?? "unknown",
    identifier: plist?.CFBundleIdentifier ?? "unknown",
    executableName,
    infoPlistOk: existsSync(infoPlist),
    executableOk,
    ok: existsSync(infoPlist) && executableOk,
  };
}

function inspectDmg(dmgPath) {
  const stat = statSync(dmgPath);
  const result =
    process.platform === "darwin"
      ? run("hdiutil", ["imageinfo", dmgPath])
      : { status: 0, stdout: "Skipped hdiutil imageinfo outside macOS." };
  return {
    path: dmgPath,
    size: stat.size,
    sizeText: formatBytes(stat.size),
    imageInfoOk: result.status === 0,
    ok: stat.isFile() && stat.size > 0 && result.status === 0,
  };
}

function inspectInstaller(path, minimumSize = 1024 * 1024) {
  const stat = statSync(path);
  return {
    path,
    size: stat.size,
    sizeText: formatBytes(stat.size),
    ok: stat.isFile() && stat.size >= minimumSize,
  };
}

function markdownTable(rows) {
  return [
    "| 项目 | 结论 | 证据 | 备注 |",
    "|---|---|---|---|",
    ...rows.map((row) => `| ${row.label} | ${row.status ?? (row.ok ? "通过" : "未通过")} | ${row.evidence} | ${row.note} |`),
  ].join("\n");
}

function replaceAutoSection(path, section) {
  const start = "<!-- AUTO_INSTALL_SMOKE_START -->";
  const end = "<!-- AUTO_INSTALL_SMOKE_END -->";
  const previous = existsSync(path) ? readFileSync(path, "utf8") : "";
  const block = `${start}\n${section.trim()}\n${end}`;
  if (previous.includes(start) && previous.includes(end)) {
    return previous.replace(new RegExp(`${start}[\\s\\S]*?${end}`), block);
  }
  return `${previous.trimEnd()}\n\n## 自动安装冒烟验证\n\n${block}\n`;
}

const artifactRoot = argValue("--artifact-root", "src-tauri/target/release/bundle");
const outputJson = argValue("--output-json", "release/install-smoke.json");
const outputMarkdown = argValue("--output-md", "release/install-smoke.md");
const docPath = argValue("--doc", "项目文档/发布产物验证记录.md");
const source = argValue("--source", "Local Tauri bundle");
const platform = argValue("--platform", currentPlatform());
const writeDoc = hasFlag("--write-doc");
const requireManualOpen = hasFlag("--require-manual-open");
const manualEvidenceJson = argValue("--manual-evidence-json", "release/manual-install-smoke.json");
const manualEvidence = readJson(manualEvidenceJson);
const manualOpenProvided = args.includes("--manual-open");
const manualOpenResult = argValue("--manual-open", manualOpenProvided ? "pending" : (manualEvidence?.result ?? "pending"));
const selectedPlatforms = platform === "all" ? ["macos", "windows", "linux"] : platform.split(",").map((item) => item.trim()).filter(Boolean);
const knownPlatforms = new Set(["macos", "windows", "linux"]);

for (const selectedPlatform of selectedPlatforms) {
  if (!knownPlatforms.has(selectedPlatform)) {
    console.error(`Unknown platform ${selectedPlatform}. Expected one of: macos, windows, linux, all.`);
    process.exit(1);
  }
}

if (!["pending", "passed", "failed"].includes(manualOpenResult)) {
  console.error("--manual-open must be one of: pending, passed, failed.");
  process.exit(1);
}

const entries = walkEntries(artifactRoot);
const paths = entries.map((entry) => asPosix(entry.path));
const fileEntries = entries.filter((entry) => entry.stat.isFile());
const dirEntries = entries.filter((entry) => entry.stat.isDirectory());

const macApps = dirEntries
  .filter((entry) => entry.path.endsWith(".app"))
  .map((entry) => inspectMacApp(entry.path));
const dmgs = fileEntries
  .filter((entry) => entry.path.toLowerCase().endsWith(".dmg"))
  .map((entry) => inspectDmg(entry.path));
const windowsInstallers = fileEntries
  .filter((entry) => /\.(msi|exe)$/i.test(entry.path))
  .map((entry) => inspectInstaller(entry.path));
const linuxInstallers = fileEntries
  .filter((entry) => /\.(appimage|deb|rpm)$/i.test(entry.path))
  .map((entry) => inspectInstaller(entry.path));

const checks = [];

if (selectedPlatforms.includes("macos")) {
  checks.push({
    label: "macOS .app 入口",
    ok: macApps.some((app) => app.ok),
    evidence:
      macApps.map((app) => `${relative(".", app.appPath)} (${app.identifier}, ${app.version}, ${app.executableName})`).join("<br>") ||
      "未找到 .app",
    note: "检查 Info.plist、bundle identifier、版本号和可执行文件",
  });
  checks.push({
    label: "macOS DMG 镜像",
    ok: dmgs.some((dmg) => dmg.ok),
    evidence: dmgs.map((dmg) => `${relative(".", dmg.path)} (${dmg.sizeText})`).join("<br>") || "未找到 .dmg",
    note: "macOS 上会额外执行 hdiutil imageinfo",
  });
}

if (selectedPlatforms.includes("windows")) {
  checks.push({
    label: "Windows 安装器",
    ok: windowsInstallers.some((installer) => installer.ok),
    evidence: windowsInstallers.map((installer) => `${relative(".", installer.path)} (${installer.sizeText})`).join("<br>") || "未找到 .msi/.exe",
    note: "检查安装包存在且大小超过 1 MiB",
  });
}

if (selectedPlatforms.includes("linux")) {
  checks.push({
    label: "Linux 安装器",
    ok: linuxInstallers.some((installer) => installer.ok),
    evidence: linuxInstallers.map((installer) => `${relative(".", installer.path)} (${installer.sizeText})`).join("<br>") || "未找到 .AppImage/.deb/.rpm",
    note: "检查安装包存在且大小超过 1 MiB",
  });
}

checks.push({
  label: "实机打开与仓库读写",
  ok: manualOpenResult === "passed" || (!requireManualOpen && manualOpenResult === "pending"),
  status: manualOpenResult === "passed" ? "通过" : manualOpenResult === "failed" ? "未通过" : "待人工",
  evidence:
    manualOpenResult === "passed"
      ? `已记录人工通过${manualEvidence?.generatedAt ? `（${manualEvidence.generatedAt}）` : ""}`
      : manualOpenResult === "failed"
        ? `已记录人工失败${manualEvidence?.generatedAt ? `（${manualEvidence.generatedAt}）` : ""}`
        : "待实机执行",
  note: manualEvidence?.note
    ? `人工安装后打开应用，创建/打开仓库，创建 Markdown，保存并重启确认可读取；备注：${manualEvidence.note}`
    : "人工安装后打开应用，创建/打开仓库，创建 Markdown，保存并重启确认可读取",
});

const failures = checks.filter((check) => !check.ok).map((check) => `${check.label} 未通过`);
const generatedAt = new Date().toISOString();
const manualChecklist = [
  "安装当前平台产物，并确认系统没有拦截或损坏提示。",
  "打开 MoKnow，创建一个临时仓库或打开已有仓库。",
  "创建 Markdown 文件，写入内容并保存。",
  "关闭并重新打开应用，确认最近仓库、文件树和保存内容可恢复。",
  "在命令面板执行“检查应用更新”，正式 updater endpoint 配置前可接受无更新或环境提示。",
];

const report = {
  generatedAt,
  source,
  artifactRoot,
  selectedPlatforms,
  entries: paths.map((path) => relative(".", path)),
  macApps: macApps.map((app) => ({ ...app, appPath: relative(".", app.appPath) })),
  dmgs: dmgs.map((dmg) => ({ ...dmg, path: relative(".", dmg.path) })),
  windowsInstallers: windowsInstallers.map((installer) => ({ ...installer, path: relative(".", installer.path) })),
  linuxInstallers: linuxInstallers.map((installer) => ({ ...installer, path: relative(".", installer.path) })),
  checks,
  manualEvidence: manualEvidence
    ? {
        generatedAt: manualEvidence.generatedAt,
        result: manualEvidence.result,
        platform: manualEvidence.platform,
        operator: manualEvidence.operator,
        note: manualEvidence.note,
        source: manualEvidenceJson,
      }
    : undefined,
  manualChecklist,
};

mkdirSync(dirname(outputJson), { recursive: true });
writeFileSync(outputJson, `${JSON.stringify(report, null, 2)}\n`, "utf8");

const markdown = `# 发布产物安装冒烟验证

| 项目 | 值 |
|---|---|
| 生成时间 | ${generatedAt} |
| 来源 | ${source} |
| 目录 | ${artifactRoot} |
| 平台范围 | ${selectedPlatforms.join(", ")} |
| 人工验收记录 | ${manualEvidence ? manualEvidenceJson : "未提供"} |

${markdownTable(checks)}

## 人工打开验证清单

${manualChecklist.map((item, index) => `${index + 1}. ${item}`).join("\n")}
`;

mkdirSync(dirname(outputMarkdown), { recursive: true });
writeFileSync(outputMarkdown, markdown, "utf8");

if (writeDoc) {
  writeFileSync(docPath, replaceAutoSection(docPath, markdown), "utf8");
}

console.log(`Release install smoke report written to ${outputMarkdown} and ${outputJson}.`);
for (const check of checks) {
  console.log(`- ${check.label}: ${check.status ?? (check.ok ? "passed" : "failed")} (${check.evidence.replaceAll("<br>", "; ")})`);
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}

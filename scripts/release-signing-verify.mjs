#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const args = process.argv.slice(2);

function argValue(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

function hasFlag(name) {
  return args.includes(name);
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

function run(command, commandArgs) {
  return spawnSync(command, commandArgs, {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
}

function oneLine(value) {
  return (value || "").replaceAll("\r", "\n").split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 6).join("<br>") || "无输出";
}

function commandSummary(result) {
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  return {
    status: result.status ?? 1,
    output,
    summary: oneLine(output),
  };
}

function markdownTable(rows) {
  return [
    "| 项目 | 结论 | 证据 | 备注 |",
    "|---|---|---|---|",
    ...rows.map((row) => `| ${row.label} | ${row.status} | ${row.evidence} | ${row.note} |`),
  ].join("\n");
}

function replaceAutoSection(path, section) {
  const start = "<!-- AUTO_SIGNING_VERIFY_START -->";
  const end = "<!-- AUTO_SIGNING_VERIFY_END -->";
  const previous = existsSync(path) ? readFileSync(path, "utf8") : "";
  const block = `${start}\n${section.trim()}\n${end}`;
  if (previous.includes(start) && previous.includes(end)) {
    return previous.replace(new RegExp(`${start}[\\s\\S]*?${end}`), block).trimStart();
  }
  return previous.trim() ? `${previous.trimEnd()}\n\n${block}\n` : `${block}\n`;
}

function inspectMacCodeSignature(path, type) {
  if (process.platform !== "darwin") {
    return {
      label: `macOS ${type} 签名`,
      ok: false,
      notarized: false,
      status: "待平台验证",
      evidence: `${relative(".", path)} 需要在 macOS 上运行 codesign / spctl`,
      note: "非 macOS 环境无法验证 Gatekeeper 签名状态",
    };
  }

  const displayPath = relative(".", path);
  const details = commandSummary(run("codesign", ["-dv", "--verbose=4", path]));
  const verifyArgs = type === "DMG" ? ["--verify", "--verbose=4", path] : ["--verify", "--deep", "--strict", "--verbose=4", path];
  const verify = commandSummary(run("codesign", verifyArgs));
  const spctlArgs =
    type === "DMG"
      ? ["--assess", "--type", "open", "--context", "context:primary-signature", "--verbose=4", path]
      : ["--assess", "--type", "execute", "--verbose=4", path];
  const spctl = commandSummary(run("spctl", spctlArgs));
  const stapler = commandSummary(run("xcrun", ["stapler", "validate", path]));
  const detailsOutput = details.output.toLowerCase();
  const signed = details.status === 0 && !detailsOutput.includes("signature=adhoc") && !detailsOutput.includes("not signed");
  const verified = verify.status === 0;
  const accepted = spctl.status === 0;
  const notarized = stapler.status === 0;
  const ok = signed && verified && accepted;

  return {
    label: `macOS ${type} 签名`,
    ok,
    notarized,
    status: ok ? (notarized ? "通过" : "签名通过，未确认公证") : "未通过",
    evidence: `${displayPath}<br>codesign: ${details.summary}<br>verify: ${verify.summary}<br>spctl: ${spctl.summary}<br>stapler: ${stapler.summary}`,
    note: type === "DMG" ? "正式发布需 Developer ID 签名，且建议公证/装订" : "正式发布需 Developer ID Application 签名并通过 Gatekeeper",
  };
}

function inspectWindowsSignature(path) {
  const displayPath = relative(".", path);
  if (process.platform !== "win32") {
    return {
      label: "Windows code signing",
      ok: false,
      notarized: true,
      status: "待平台验证",
      evidence: `${displayPath} 需要在 Windows 上运行 Get-AuthenticodeSignature`,
      note: "正式发布需 Authenticode 签名和可信时间戳",
    };
  }

  const result = commandSummary(
    run("powershell", [
      "-NoProfile",
      "-Command",
      `Get-AuthenticodeSignature -FilePath '${path.replaceAll("'", "''")}' | ConvertTo-Json -Depth 4`,
    ]),
  );
  let parsed;
  try {
    parsed = JSON.parse(result.output);
  } catch {
    parsed = undefined;
  }
  const ok = parsed?.Status === 0 || parsed?.Status === "Valid";
  return {
    label: "Windows code signing",
    ok,
    notarized: true,
    status: ok ? "通过" : "未通过",
    evidence: `${displayPath}<br>${result.summary}`,
    note: "正式发布需 Authenticode 签名和可信时间戳",
  };
}

const artifactRoot = argValue("--artifact-root", "src-tauri/target/release/bundle");
const outputJson = argValue("--output-json", "release/signing-verification.json");
const outputMarkdown = argValue("--output-md", "release/signing-verification.md");
const docPath = argValue("--doc", "项目文档/发布签名验证记录.md");
const platform = argValue("--platform", currentPlatform());
const writeDoc = hasFlag("--write-doc");
const requireSigned = hasFlag("--require-signed") || hasFlag("--strict");
const requireNotarized = hasFlag("--require-notarized") || hasFlag("--strict");
const selectedPlatforms = platform === "all" ? ["macos", "windows", "linux"] : platform.split(",").map((item) => item.trim()).filter(Boolean);
const knownPlatforms = new Set(["macos", "windows", "linux"]);

for (const selectedPlatform of selectedPlatforms) {
  if (!knownPlatforms.has(selectedPlatform)) {
    console.error(`Unknown platform ${selectedPlatform}. Expected one of: macos, windows, linux, all.`);
    process.exit(1);
  }
}

const entries = walkEntries(artifactRoot);
const fileEntries = entries.filter((entry) => entry.stat.isFile());
const dirEntries = entries.filter((entry) => entry.stat.isDirectory());
const checks = [];

if (selectedPlatforms.includes("macos")) {
  const macApps = dirEntries.filter((entry) => entry.path.endsWith(".app"));
  const dmgs = fileEntries.filter((entry) => entry.path.toLowerCase().endsWith(".dmg"));
  if (macApps.length === 0) {
    checks.push({
      label: "macOS app 签名",
      ok: false,
      notarized: false,
      status: "未找到产物",
      evidence: `未在 ${artifactRoot} 下找到 .app`,
      note: "需要先构建 macOS app bundle",
    });
  } else {
    checks.push(...macApps.map((entry) => inspectMacCodeSignature(entry.path, "app")));
  }
  if (dmgs.length === 0) {
    checks.push({
      label: "macOS DMG 签名",
      ok: false,
      notarized: false,
      status: "未找到产物",
      evidence: `未在 ${artifactRoot} 下找到 .dmg`,
      note: "需要先构建 macOS DMG",
    });
  } else {
    checks.push(...dmgs.map((entry) => inspectMacCodeSignature(entry.path, "DMG")));
  }
}

if (selectedPlatforms.includes("windows")) {
  const windowsInstallers = fileEntries.filter((entry) => /\.(msi|exe)$/i.test(entry.path));
  if (windowsInstallers.length === 0) {
    checks.push({
      label: "Windows code signing",
      ok: false,
      notarized: true,
      status: "未找到产物",
      evidence: `未在 ${artifactRoot} 下找到 .msi/.exe`,
      note: "需要先构建 Windows 安装包",
    });
  } else {
    checks.push(...windowsInstallers.map((entry) => inspectWindowsSignature(entry.path)));
  }
}

if (selectedPlatforms.includes("linux")) {
  const linuxInstallers = fileEntries.filter((entry) => /\.(appimage|deb|rpm)$/i.test(entry.path));
  checks.push({
    label: "Linux 安装包签名策略",
    ok: linuxInstallers.length > 0,
    notarized: true,
    status: linuxInstallers.length > 0 ? "待分发策略确认" : "未找到产物",
    evidence:
      linuxInstallers.map((entry) => `${relative(".", entry.path)}`).join("<br>") ||
      `未在 ${artifactRoot} 下找到 .AppImage/.deb/.rpm`,
    note: "Linux 无统一 code signing 要求；正式发布需至少保留 SHA-256，按渠道补充 GPG / repo 签名",
  });
}

const generatedAt = new Date().toISOString();
const failures = [];
if (requireSigned) {
  for (const check of checks) {
    if (!check.ok) failures.push(`${check.label} 未通过签名验证`);
  }
}
if (requireNotarized) {
  for (const check of checks) {
    if (!check.notarized) failures.push(`${check.label} 未通过公证/装订验证`);
  }
}

const markdown = `# 发布签名与公证验证记录

| 项目 | 值 |
|---|---|
| 生成时间 | ${generatedAt} |
| 目录 | ${artifactRoot} |
| 平台范围 | ${selectedPlatforms.join(", ")} |
| 强制签名 | ${requireSigned ? "是" : "否"} |
| 强制公证/装订 | ${requireNotarized ? "是" : "否"} |

${markdownTable(checks)}

## 正式发布验证命令

\`\`\`bash
npm run release:signing -- --require-signed --require-notarized --write-doc
\`\`\`

> 本报告只记录签名、公证、Gatekeeper / Authenticode 验证结果，不写入证书、私钥或密码。
`;

const report = {
  generatedAt,
  artifactRoot,
  selectedPlatforms,
  requireSigned,
  requireNotarized,
  checks,
};

mkdirSync(dirname(outputMarkdown), { recursive: true });
writeFileSync(outputMarkdown, markdown, "utf8");
writeFileSync(outputJson, `${JSON.stringify(report, null, 2)}\n`, "utf8");
if (writeDoc) {
  mkdirSync(dirname(docPath), { recursive: true });
  writeFileSync(docPath, replaceAutoSection(docPath, markdown), "utf8");
}

console.log(`Release signing verification written to ${outputMarkdown} and ${outputJson}.`);
for (const check of checks) {
  console.log(`- ${check.label}: ${check.status}`);
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}

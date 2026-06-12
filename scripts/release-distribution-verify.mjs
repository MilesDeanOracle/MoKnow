#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

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

function safeRead(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function redactUrl(value) {
  if (!value) return "缺失";
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return String(value).replace(/([?&](?:api[_-]?key|token|key)=)[^&]+/gi, "$1<redacted>");
  }
}

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isPlaceholderUrl(value) {
  return /OWNER\/REPO|example\.com|localhost|127\.0\.0\.1/i.test(value ?? "");
}

function caskField(content, field) {
  return content.match(new RegExp(`^\\s*${field}\\s+"([^"]+)"`, "m"))?.[1] ?? "";
}

function statusText(ok) {
  return ok ? "通过" : "未通过";
}

function check(label, ok, evidence, note) {
  return { label, ok, status: statusText(ok), evidence, note };
}

async function checkReachable(url, timeoutMs) {
  if (!url) return { ok: false, evidence: "URL 缺失" };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response = await fetch(url, { method: "HEAD", redirect: "follow", signal: controller.signal });
    if (response.status === 405 || response.status === 403) {
      response = await fetch(url, { method: "GET", redirect: "follow", signal: controller.signal });
    }
    return { ok: response.ok, evidence: `${response.status} ${response.statusText}`.trim() };
  } catch (error) {
    return { ok: false, evidence: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeout);
  }
}

function markdownTable(rows) {
  return [
    "| 项目 | 结论 | 证据 | 备注 |",
    "|---|---|---|---|",
    ...rows.map((row) => `| ${row.label} | ${row.status} | ${row.evidence} | ${row.note} |`),
  ].join("\n");
}

function replaceAutoSection(path, section) {
  const start = "<!-- AUTO_DISTRIBUTION_VERIFY_START -->";
  const end = "<!-- AUTO_DISTRIBUTION_VERIFY_END -->";
  const previous = existsSync(path) ? readFileSync(path, "utf8") : "";
  const block = `${start}\n${section.trim()}\n${end}`;
  if (previous.includes(start) && previous.includes(end)) {
    return previous.replace(new RegExp(`${start}[\\s\\S]*?${end}`), block);
  }
  return previous.trim() ? `${previous.trimEnd()}\n\n## 自动分发验证\n\n${block}\n` : `${block}\n`;
}

const metadataDir = argValue("--metadata-dir", "release");
const outputJson = argValue("--output-json", "release/distribution-verification.json");
const outputMarkdown = argValue("--output-md", "release/distribution-verification.md");
const docPath = argValue("--doc", "项目文档/发布分发验证记录.md");
const timeoutMs = Number(argValue("--timeout-ms", "8000"));
const strict = hasFlag("--strict");
const requireReachable = hasFlag("--require-reachable");
const writeDoc = hasFlag("--write-doc");
const generatedAt = new Date().toISOString();

const downloadsPath = join(metadataDir, "downloads.json");
const latestPath = join(metadataDir, "latest.json");
const caskPath = join(metadataDir, "homebrew", "moknow.rb");
const downloads = readJson(downloadsPath);
const latest = readJson(latestPath);
const cask = safeRead(caskPath);
const downloadItems = Array.isArray(downloads?.downloads) ? downloads.downloads : [];
const downloadUrls = downloadItems.map((item) => item.url).filter(Boolean);
const latestPlatforms = latest?.platforms && typeof latest.platforms === "object" ? Object.values(latest.platforms) : [];
const updaterUrls = latestPlatforms.map((platform) => platform?.url).filter(Boolean);
const caskUrl = caskField(cask, "url");
const caskHomepage = caskField(cask, "homepage");
const caskSha = caskField(cask, "sha256");
const releaseBaseUrl = process.env.MOKNOW_RELEASE_DOWNLOAD_BASE_URL ?? "";
const homepageUrl = process.env.MOKNOW_HOMEPAGE_URL ?? caskHomepage;
const updaterEndpoint = process.env.MOKNOW_UPDATER_ENDPOINT ?? "";
const homebrewTap = process.env.MOKNOW_HOMEBREW_TAP ?? "";

const checks = [
  check("downloads.json", Boolean(downloads && downloadItems.length > 0), `${downloadItems.length} 个下载项`, "需要生成下载清单"),
  check(
    "下载 URL",
    downloadItems.length > 0 && downloadItems.every((item) => item.url && isHttpsUrl(item.url) && !isPlaceholderUrl(item.url)),
    downloadItems.length ? downloadItems.map((item) => `${item.name}: ${redactUrl(item.url) || "缺失"}`).join("<br>") : "无下载项",
    "每个下载项都应指向真实 HTTPS Release 资产 URL",
  ),
  check(
    "latest.json updater 平台",
    latestPlatforms.length > 0 && updaterUrls.every((url) => isHttpsUrl(url) && !isPlaceholderUrl(url)),
    `${latestPlatforms.length} 个平台条目`,
    "真实自动更新需 latest.json 包含带签名的 updater 平台 URL",
  ),
  check(
    "Homebrew cask",
    Boolean(cask && caskUrl && caskSha.length === 64),
    cask ? `url=${redactUrl(caskUrl)}<br>sha256=${caskSha || "缺失"}` : "cask 缺失",
    "需要生成可发布的 Homebrew cask",
  ),
  check(
    "Homebrew cask URL",
    Boolean(caskUrl && isHttpsUrl(caskUrl) && !isPlaceholderUrl(caskUrl)),
    redactUrl(caskUrl),
    "cask URL 需指向真实 HTTPS DMG 资产，不能保留 OWNER/REPO 占位符",
  ),
  check(
    "官网 / 项目主页",
    Boolean(homepageUrl && isHttpsUrl(homepageUrl) && !isPlaceholderUrl(homepageUrl)),
    redactUrl(homepageUrl),
    "官网或项目主页需是真实 HTTPS URL",
  ),
  check(
    "Release 下载 Base URL",
    Boolean(releaseBaseUrl && isHttpsUrl(releaseBaseUrl) && !isPlaceholderUrl(releaseBaseUrl)),
    redactUrl(releaseBaseUrl),
    "用于生成 downloads.json、latest.json 和 cask URL",
  ),
  check(
    "Updater endpoint",
    Boolean(updaterEndpoint && isHttpsUrl(updaterEndpoint) && !isPlaceholderUrl(updaterEndpoint)),
    redactUrl(updaterEndpoint),
    "正式自动更新需配置真实 HTTPS latest.json endpoint",
  ),
  check("Homebrew tap", Boolean(homebrewTap), homebrewTap || "缺失", "正式 Homebrew 分发需记录 owner/homebrew-tap"),
];

if (requireReachable) {
  const urlsToProbe = [
    ...downloadUrls.map((url) => ["下载资产可达", url]),
    ...updaterUrls.map((url) => ["Updater 资产可达", url]),
    ...(updaterEndpoint ? [["Updater endpoint 可达", updaterEndpoint]] : []),
    ...(homepageUrl ? [["官网 / 项目主页可达", homepageUrl]] : []),
    ...(caskUrl ? [["Homebrew cask URL 可达", caskUrl]] : []),
  ];
  for (const [label, url] of urlsToProbe) {
    const result = await checkReachable(url, timeoutMs);
    checks.push(check(`${label}: ${redactUrl(url)}`, result.ok, result.evidence, "执行 HEAD，必要时回退 GET"));
  }
}

const failures = checks.filter((item) => !item.ok);
const markdown = `# 发布分发验证记录

| 项目 | 值 |
|---|---|
| 生成时间 | ${generatedAt} |
| 元数据目录 | ${metadataDir} |
| 严格模式 | ${strict ? "是" : "否"} |
| 网络可达验证 | ${requireReachable ? "是" : "否"} |
| 失败项数量 | ${failures.length} |

${markdownTable(checks)}

## 正式发布验证命令

\`\`\`bash
MOKNOW_RELEASE_DOWNLOAD_BASE_URL=https://github.com/{owner}/{repo}/releases/download/vX.Y.Z \\
MOKNOW_HOMEPAGE_URL=https://github.com/{owner}/{repo} \\
MOKNOW_UPDATER_ENDPOINT=https://github.com/{owner}/{repo}/releases/latest/download/latest.json \\
MOKNOW_HOMEBREW_TAP=owner/homebrew-tap \\
npm run release:distribution -- --strict --require-reachable --write-doc
\`\`\`

> 本报告只记录 URL、状态和哈希，不记录 token、证书或私钥。
`;

const report = {
  generatedAt,
  metadataDir,
  strict,
  requireReachable,
  failures: failures.map((item) => item.label),
  checks,
};

mkdirSync(dirname(outputMarkdown), { recursive: true });
writeFileSync(outputMarkdown, markdown, "utf8");
writeFileSync(outputJson, `${JSON.stringify(report, null, 2)}\n`, "utf8");
if (writeDoc) {
  mkdirSync(dirname(docPath), { recursive: true });
  writeFileSync(docPath, replaceAutoSection(docPath, markdown), "utf8");
}

console.log(`Release distribution verification written to ${outputMarkdown} and ${outputJson}.`);
for (const item of checks) console.log(`- ${item.label}: ${item.status}`);

if (strict && failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure.label}`);
  process.exit(1);
}

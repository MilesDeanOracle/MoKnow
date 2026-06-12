#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";

const args = process.argv.slice(2);

function argValue(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

function hasFlag(name) {
  return args.includes(name);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
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

function normalizeBaseUrl(baseUrl) {
  return baseUrl.replace(/\/+$/, "");
}

function urlFor(baseUrl, file) {
  return `${normalizeBaseUrl(baseUrl)}/${encodeURIComponent(basename(file))}`;
}

function inferArch(file) {
  const name = basename(file).toLowerCase();
  if (name.includes("aarch64") || name.includes("arm64")) return "aarch64";
  if (name.includes("x64") || name.includes("x86_64") || name.includes("amd64")) return "x86_64";
  return process.arch === "arm64" ? "aarch64" : "x86_64";
}

function inferUpdaterPlatform(file) {
  const normalized = file.replaceAll("\\", "/").toLowerCase();
  const arch = inferArch(file);
  if (normalized.includes("/macos/") && normalized.endsWith(".app.tar.gz")) return `darwin-${arch}`;
  if (normalized.includes("/appimage/") && normalized.endsWith(".appimage")) return `linux-${arch}`;
  if (normalized.includes("/nsis/") && normalized.endsWith(".nsis.zip")) return `windows-${arch}`;
  if (normalized.includes("/msi/") && normalized.endsWith(".msi.zip")) return `windows-${arch}`;
  return undefined;
}

function isDownloadArtifact(file) {
  return [
    ".AppImage",
    ".deb",
    ".dmg",
    ".exe",
    ".msi",
    ".rpm",
    ".sig",
    ".tar.gz",
    ".zip",
  ].some((suffix) => file.endsWith(suffix));
}

function findMacDmg(files) {
  return files.find((file) => file.replaceAll("\\", "/").includes("/dmg/") && file.endsWith(".dmg"));
}

function caskTemplate({ appName, version, identifier, url, sha256Hash, homepage }) {
  return `cask "moknow" do
  version "${version}"
  sha256 "${sha256Hash}"

  url "${url}"
  name "${appName}"
  desc "Markdown desktop notebook for local knowledge and diary workflows"
  homepage "${homepage}"

  app "${appName}.app"

  zap trash: [
    "~/Library/Application Support/${identifier}",
    "~/Library/Preferences/${identifier}.plist",
  ]
end
`;
}

const packageJson = readJson("package.json");
const tauriConfig = readJson("src-tauri/tauri.conf.json");
const version = packageJson.version;
const appName = tauriConfig.productName ?? "MoKnow";
const identifier = tauriConfig.identifier ?? "com.moknow.desktop";
const bundleRoot = argValue("--bundle-root", "src-tauri/target/release/bundle");
const outputDir = argValue("--output-dir", "release");
const baseUrl = argValue("--base-url", process.env.MOKNOW_RELEASE_DOWNLOAD_BASE_URL ?? "");
const homepage = argValue("--homepage", process.env.MOKNOW_HOMEPAGE_URL ?? packageJson.homepage ?? "https://github.com/OWNER/REPO");
const requireBaseUrl = hasFlag("--require-base-url");
const requireUpdaterSignatures = hasFlag("--require-updater-signatures");

if ((requireBaseUrl || process.env.CI) && !baseUrl) {
  console.error("MOKNOW_RELEASE_DOWNLOAD_BASE_URL or --base-url is required to generate release metadata URLs.");
  process.exit(1);
}

const files = walk(bundleRoot).filter(isDownloadArtifact);
const failures = [];
const warnings = [];
if (files.length === 0) {
  failures.push(`No release artifacts were found under ${bundleRoot}.`);
}
const downloads = files.map((file) => ({
  name: basename(file),
  path: relative(".", file),
  size: readFileSync(file).byteLength,
  sha256: sha256(file),
  url: baseUrl ? urlFor(baseUrl, file) : "",
}));

const signatures = new Map(files.filter((file) => file.endsWith(".sig")).map((file) => [file.slice(0, -4), file]));
const platforms = {};
for (const file of files) {
  const platform = inferUpdaterPlatform(file);
  if (!platform) continue;
  const signatureFile = signatures.get(file);
  if (!signatureFile) {
    warnings.push(`Missing updater signature for ${relative(".", file)}.`);
    continue;
  }
  platforms[platform] = {
    signature: readFileSync(signatureFile, "utf8").trim(),
    url: baseUrl ? urlFor(baseUrl, file) : "",
  };
}

if (requireUpdaterSignatures && Object.keys(platforms).length === 0) {
  failures.push("No signed updater platform entries could be generated.");
}

mkdirSync(outputDir, { recursive: true });
writeFileSync(
  join(outputDir, "downloads.json"),
  `${JSON.stringify({ version, generatedAt: new Date().toISOString(), downloads }, null, 2)}\n`,
  "utf8",
);

writeFileSync(
  join(outputDir, "latest.json"),
  `${JSON.stringify(
    {
      version,
      notes: `MoKnow ${version}`,
      pub_date: new Date().toISOString(),
      platforms,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

const macDmg = findMacDmg(files);
if (macDmg) {
  mkdirSync(join(outputDir, "homebrew"), { recursive: true });
  writeFileSync(
    join(outputDir, "homebrew/moknow.rb"),
    caskTemplate({
      appName,
      version,
      identifier,
      url: baseUrl ? urlFor(baseUrl, macDmg) : `https://github.com/OWNER/REPO/releases/download/v${version}/${basename(macDmg)}`,
      sha256Hash: sha256(macDmg),
      homepage,
    }),
    "utf8",
  );
} else {
  warnings.push("No macOS DMG found; Homebrew cask was not generated.");
}

for (const warning of warnings) console.warn(`WARN: ${warning}`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}

console.log(`Release metadata written to ${outputDir}.`);

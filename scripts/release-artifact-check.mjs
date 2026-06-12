#!/usr/bin/env node
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

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
    } else {
      entries.push(path);
    }
  }
  return entries;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

function currentPlatform() {
  if (process.platform === "darwin") return "macos";
  if (process.platform === "win32") return "windows";
  return "linux";
}

const bundleRoot = argValue("--bundle-root", "src-tauri/target/release/bundle");
const platform = argValue("--platform", currentPlatform());
const requireUpdaterSignatures = hasFlag("--require-updater-signatures");
const requireAll = hasFlag("--all");

const platformRules = {
  macos: [
    { label: "macOS app bundle", test: (file) => file.includes("/macos/") && file.endsWith(".app.tar.gz") },
    { label: "macOS DMG", test: (file) => file.includes("/dmg/") && file.endsWith(".dmg") },
  ],
  windows: [
    { label: "Windows MSI", test: (file) => file.includes("/msi/") && file.endsWith(".msi") },
    { label: "Windows NSIS installer", test: (file) => file.includes("/nsis/") && file.endsWith(".exe") },
  ],
  linux: [
    { label: "Linux AppImage", test: (file) => file.includes("/appimage/") && file.endsWith(".AppImage") },
    { label: "Linux Debian package", test: (file) => file.includes("/deb/") && file.endsWith(".deb") },
    { label: "Linux RPM package", test: (file) => file.includes("/rpm/") && file.endsWith(".rpm") },
  ],
};

const selectedPlatforms = requireAll ? Object.keys(platformRules) : [platform];
const files = walk(bundleRoot);
const normalizedFiles = files.map((file) => file.replaceAll("\\", "/"));
const failures = [];
const warnings = [];
const found = [];

for (const selectedPlatform of selectedPlatforms) {
  const rules = platformRules[selectedPlatform];
  if (!rules) {
    failures.push(`Unknown platform ${selectedPlatform}. Expected one of: ${Object.keys(platformRules).join(", ")}.`);
    continue;
  }

  const platformMatches = [];
  for (const rule of rules) {
    const matches = normalizedFiles.filter(rule.test);
    if (matches.length > 0) {
      for (const match of matches) {
        const stat = statSync(match);
        platformMatches.push(match);
        found.push({
          label: rule.label,
          file: match,
          size: stat.size,
        });
      }
    }
  }

  if (platformMatches.length === 0) {
    failures.push(`No ${selectedPlatform} release bundle was found under ${bundleRoot}.`);
  }
}

const updaterSignatures = normalizedFiles.filter((file) => file.endsWith(".sig"));
if (requireUpdaterSignatures && updaterSignatures.length === 0) {
  failures.push("No updater .sig files were found. Set TAURI_SIGNING_PRIVATE_KEY and build updater artifacts before release.");
} else if (updaterSignatures.length === 0) {
  warnings.push("No updater .sig files were found. This is expected for unsigned local builds, but release builds must include updater signatures.");
}

console.log(`MoKnow release artifact check (${selectedPlatforms.join(", ")})`);
for (const item of found) {
  console.log(`- ${item.label}: ${relative(".", item.file)} (${formatBytes(item.size)})`);
}
for (const signature of updaterSignatures) {
  console.log(`- Updater signature: ${relative(".", signature)}`);
}
for (const warning of warnings) {
  console.warn(`WARN: ${warning}`);
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}

console.log("Release artifact check passed.");

#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith("--")));

function argValue(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${commandArgs.join(" ")} failed with exit code ${result.status ?? "unknown"}`);
  }
}

const failures = [];
const warnings = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

function warn(condition, message) {
  if (!condition) warnings.push(message);
}

const packageJson = readJson("package.json");
const tauriConfig = readJson("src-tauri/tauri.conf.json");
const desktopCapability = existsSync("src-tauri/capabilities/desktop.json") ? readJson("src-tauri/capabilities/desktop.json") : undefined;
const cargoToml = readFileSync("src-tauri/Cargo.toml", "utf8");
const changelog = readFileSync("CHANGELOG.md", "utf8");
const releaseWorkflow = existsSync(".github/workflows/release.yml") ? readFileSync(".github/workflows/release.yml", "utf8") : "";
const releaseDryRunWorkflow = existsSync(".github/workflows/release-dry-run.yml") ? readFileSync(".github/workflows/release-dry-run.yml", "utf8") : "";
const releaseRequiredFiles = existsSync("scripts/release-required-files.mjs")
  ? readFileSync("scripts/release-required-files.mjs", "utf8")
  : "";
const cargoVersion = cargoToml.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
const version = packageJson.version;
const expectedTag = `v${version}`;
const providedTag = argValue("--tag") ?? process.env.GITHUB_REF_NAME;

check(Boolean(version), "package.json must define version.");
check(tauriConfig.version === version, `src-tauri/tauri.conf.json version (${tauriConfig.version}) must match package.json (${version}).`);
check(cargoVersion === version, `src-tauri/Cargo.toml version (${cargoVersion}) must match package.json (${version}).`);
if (providedTag) check(providedTag === expectedTag, `release tag ${providedTag} must match ${expectedTag}.`);

check(existsSync("CHANGELOG.md"), "CHANGELOG.md must exist.");
if (providedTag) {
  check(changelog.includes(`## [${version}]`), `CHANGELOG.md must contain a release section for ${version} before tagging.`);
} else {
  warn(changelog.includes("## [Unreleased]") || changelog.includes(`## [${version}]`), "CHANGELOG.md should contain [Unreleased] or the current version section.");
}

check(existsSync(".github/workflows/release.yml"), "GitHub Release workflow must exist at .github/workflows/release.yml.");
check(releaseWorkflow.includes("macos-latest"), "GitHub Release workflow must include a macOS build.");
check(releaseWorkflow.includes("windows-latest"), "GitHub Release workflow must include a Windows build.");
check(releaseWorkflow.includes("ubuntu-22.04") || releaseWorkflow.includes("ubuntu-latest"), "GitHub Release workflow must include a Linux build.");
check(releaseWorkflow.includes("tauri-apps/tauri-action"), "GitHub Release workflow must use tauri-apps/tauri-action.");
check(releaseWorkflow.includes("actions/upload-artifact"), "GitHub Release workflow must upload platform artifacts for download verification.");
check(releaseWorkflow.includes("npm run release:updater-config"), "GitHub Release workflow must generate a Tauri updater config before building.");
check(releaseWorkflow.includes("npm run ai:e2e:auto -- --write-doc"), "GitHub Release workflow must generate AI E2E evidence when AI secrets are configured.");
check(releaseWorkflow.includes("secrets.AI_E2E_API_KEY"), "GitHub Release workflow must pass AI_E2E_API_KEY to AI E2E evidence generation.");
check(releaseWorkflow.includes("--config src-tauri/tauri.updater.conf.json"), "GitHub Release workflow must build with the generated updater config.");
check(releaseWorkflow.includes("--require-updater-signatures"), "GitHub Release workflow must require updater signatures for release artifacts and metadata.");
check(releaseWorkflow.includes("npm run release:install-smoke"), "GitHub Release workflow must generate install smoke reports.");
check(releaseWorkflow.includes("npm run release:signing -- --require-signed --require-notarized"), "GitHub Release workflow must require signing and notarization verification.");
check(releaseWorkflow.includes("npm run release:metadata"), "GitHub Release workflow must generate release metadata.");
check(releaseWorkflow.includes("npm run release:distribution"), "GitHub Release workflow must verify distribution metadata and endpoints.");
check(releaseWorkflow.includes("npm run release:final-audit"), "GitHub Release workflow must generate a final progress audit report.");
check(releaseWorkflow.includes("npm run release:workflow-validate -- --write-doc"), "GitHub Release workflow must validate workflow structure in CI.");
check(releaseWorkflow.includes("needs: build"), "GitHub Release workflow must include a post-matrix verification job.");
check(releaseWorkflow.includes("actions/download-artifact"), "GitHub Release workflow must download all platform artifacts for aggregate verification.");
check(releaseWorkflow.includes("npm run release:aggregate-evidence"), "GitHub Release workflow must aggregate platform evidence after downloading artifacts.");
check(releaseWorkflow.includes("gh release upload"), "GitHub Release workflow must upload release metadata to the draft release.");
check(releaseWorkflow.includes("release/**/*.md"), "GitHub Release workflow must upload release verification markdown reports.");
check(existsSync(".github/workflows/release-dry-run.yml"), "GitHub Release dry-run workflow must exist at .github/workflows/release-dry-run.yml.");
check(releaseDryRunWorkflow.includes("workflow_dispatch"), "GitHub Release dry-run workflow must support manual dispatch.");
check(releaseDryRunWorkflow.includes("macos-latest"), "GitHub Release dry-run workflow must include a macOS build.");
check(releaseDryRunWorkflow.includes("windows-latest"), "GitHub Release dry-run workflow must include a Windows build.");
check(releaseDryRunWorkflow.includes("ubuntu-22.04") || releaseDryRunWorkflow.includes("ubuntu-latest"), "GitHub Release dry-run workflow must include a Linux build.");
check(releaseDryRunWorkflow.includes("tauri-apps/tauri-action"), "GitHub Release dry-run workflow must use tauri-apps/tauri-action.");
check(releaseDryRunWorkflow.includes("npm run ai:e2e:auto -- --write-doc"), "GitHub Release dry-run workflow must generate AI E2E evidence when AI secrets are configured.");
check(releaseDryRunWorkflow.includes("secrets.AI_E2E_API_KEY"), "GitHub Release dry-run workflow must pass AI_E2E_API_KEY to AI E2E evidence generation.");
check(releaseDryRunWorkflow.includes("actions/upload-artifact"), "GitHub Release dry-run workflow must upload platform artifacts for download verification.");
check(releaseDryRunWorkflow.includes("npm run release:artifacts"), "GitHub Release dry-run workflow must validate local release artifacts.");
check(releaseDryRunWorkflow.includes("npm run release:install-smoke"), "GitHub Release dry-run workflow must generate install smoke reports.");
check(releaseDryRunWorkflow.includes("npm run release:signing"), "GitHub Release dry-run workflow must generate signing verification reports.");
check(releaseDryRunWorkflow.includes("npm run release:final-audit"), "GitHub Release dry-run workflow must generate a final progress audit report.");
check(releaseDryRunWorkflow.includes("npm run release:workflow-validate -- --write-doc"), "GitHub Release dry-run workflow must validate workflow structure in CI.");
check(releaseDryRunWorkflow.includes("needs: build"), "GitHub Release dry-run workflow must include a post-matrix verification job.");
check(releaseDryRunWorkflow.includes("actions/download-artifact"), "GitHub Release dry-run workflow must download all platform artifacts for aggregate verification.");
check(releaseDryRunWorkflow.includes("npm run release:aggregate-evidence"), "GitHub Release dry-run workflow must aggregate platform evidence after downloading artifacts.");
check(releaseDryRunWorkflow.includes("release/**/*.md"), "GitHub Release dry-run workflow must upload release verification markdown reports.");
check(tauriConfig.bundle?.active === true, "Tauri bundle.active must be true.");
check(tauriConfig.bundle?.targets === "all" || Array.isArray(tauriConfig.bundle?.targets), "Tauri bundle.targets must be configured.");
check((tauriConfig.bundle?.icon ?? []).some((icon) => existsSync(`src-tauri/${icon}`)), "At least one configured Tauri icon must exist.");
check(packageJson.dependencies?.["@tauri-apps/plugin-updater"], "Tauri updater npm plugin must be installed.");
check(cargoToml.includes("tauri-plugin-updater"), "Tauri updater Rust plugin must be installed.");
check(desktopCapability?.permissions?.includes("updater:default"), "Desktop capability must grant updater:default permission.");
check(existsSync("scripts/ai-provider-e2e.mjs"), "AI provider E2E script must exist.");
check(existsSync("scripts/ai-provider-preflight.mjs"), "AI provider E2E preflight script must exist.");
check(existsSync("scripts/ai-provider-auto-e2e.mjs"), "AI provider auto E2E discovery script must exist.");
check(existsSync("scripts/ai-provider-mock-e2e.mjs"), "AI provider mock E2E script must exist.");
check(existsSync("scripts/prepare-tauri-updater-config.mjs"), "Tauri updater config preparation script must exist.");
check(existsSync("scripts/release-artifact-check.mjs"), "Release artifact check script must exist.");
check(existsSync("scripts/verify-downloaded-artifacts.mjs"), "Downloaded artifact verification script must exist.");
check(existsSync("scripts/release-install-smoke.mjs"), "Release install smoke script must exist.");
check(existsSync("scripts/record-install-smoke-evidence.mjs"), "Release manual install evidence script must exist.");
check(existsSync("scripts/release-signing-verify.mjs"), "Release signing verification script must exist.");
check(existsSync("scripts/aggregate-release-evidence.mjs"), "Release evidence aggregation script must exist.");
check(existsSync("scripts/validate-release-workflows.mjs"), "Release workflow validation script must exist.");
check(existsSync("scripts/release-ci-preflight.mjs"), "Release CI preflight script must exist.");
check(existsSync("scripts/release-remote-status.mjs"), "Release remote status script must exist.");
check(existsSync("scripts/generate-release-metadata.mjs"), "Release metadata generation script must exist.");
check(existsSync("scripts/release-distribution-verify.mjs"), "Release distribution verification script must exist.");
check(existsSync("scripts/release-secrets-audit.mjs"), "Release secrets audit script must exist.");
check(existsSync("scripts/sync-release-secrets.mjs"), "Release secrets sync script must exist.");
check(existsSync("scripts/release-external-readiness.mjs"), "Release external readiness script must exist.");
check(existsSync("scripts/generate-external-closure-handoff.mjs"), "Release external closure handoff script must exist.");
check(existsSync("scripts/release-closure-gate.mjs"), "Release closure gate script must exist.");
check(existsSync("scripts/release-tracking-gate.mjs"), "Release tracking gate script must exist.");
check(existsSync("scripts/release-required-files.mjs"), "Release required files shared list must exist.");
check(existsSync("scripts/release-submit-prep.mjs"), "Release submit prep script must exist.");
check(existsSync("scripts/release-submission-safety.mjs"), "Release submission safety script must exist.");
check(existsSync("scripts/release-submission-plan.mjs"), "Release submission plan script must exist.");
check(existsSync("scripts/release-submission-manifest.mjs"), "Release submission manifest script must exist.");
check(existsSync("scripts/release-submission-preview.mjs"), "Release submission preview script must exist.");
check(existsSync("scripts/release-push-readiness.mjs"), "Release push readiness script must exist.");
check(existsSync("scripts/final-progress-audit.mjs"), "Final progress audit script must exist.");
check(existsSync("scripts/run-release-dry-run.mjs"), "Release dry-run automation script must exist.");
check(readFileSync("scripts/run-release-dry-run.mjs", "utf8").includes("release:workflow-validate"), "Release dry-run automation must validate workflow structure before dispatch.");
check(readFileSync("scripts/run-release-dry-run.mjs", "utf8").includes("release:ci-preflight"), "Release dry-run automation must run CI preflight before dispatch.");
check(readFileSync("scripts/run-release-dry-run.mjs", "utf8").includes("release:remote-status"), "Release dry-run automation must refresh remote status after the run.");
check(readFileSync("scripts/run-release-dry-run.mjs", "utf8").includes("release:aggregate-evidence"), "Release dry-run automation must aggregate downloaded platform evidence before final audit.");
check(readFileSync("scripts/run-release-dry-run.mjs", "utf8").includes("release:final-audit"), "Release dry-run automation must generate the final progress audit after verification.");
check(readFileSync("scripts/generate-external-closure-handoff.mjs", "utf8").includes("release:closure"), "Release handoff must include the closure gate command.");
check(readFileSync("scripts/generate-external-closure-handoff.mjs", "utf8").includes("release:remote-status"), "Release handoff must include the remote status command.");
check(readFileSync("scripts/generate-external-closure-handoff.mjs", "utf8").includes("release:submit-prep"), "Release handoff must include the submit prep command.");
check(readFileSync("scripts/generate-external-closure-handoff.mjs", "utf8").includes("release:submission-safety"), "Release handoff must include the submission safety command.");
check(readFileSync("scripts/generate-external-closure-handoff.mjs", "utf8").includes("release:submission-plan"), "Release handoff must include the submission plan command.");
check(readFileSync("scripts/generate-external-closure-handoff.mjs", "utf8").includes("release:submission-manifest"), "Release handoff must include the submission manifest command.");
check(readFileSync("scripts/generate-external-closure-handoff.mjs", "utf8").includes("release:submission-preview"), "Release handoff must include the submission preview command.");
check(readFileSync("scripts/generate-external-closure-handoff.mjs", "utf8").includes("release:push-readiness"), "Release handoff must include the push readiness command.");
check(readFileSync("scripts/release-closure-gate.mjs", "utf8").includes("release:workflow-validate"), "Release closure gate must include workflow structure validation.");
check(readFileSync("scripts/release-closure-gate.mjs", "utf8").includes("release:remote-status"), "Release closure gate must include remote status verification.");
check(readFileSync("scripts/release-closure-gate.mjs", "utf8").includes("release:submit-prep"), "Release closure gate must include submit prep generation.");
check(readFileSync("scripts/release-closure-gate.mjs", "utf8").includes("release:submission-safety"), "Release closure gate must include submission safety scanning.");
check(readFileSync("scripts/release-closure-gate.mjs", "utf8").includes("release:submission-plan"), "Release closure gate must include submission plan generation.");
check(readFileSync("scripts/release-closure-gate.mjs", "utf8").includes("release:submission-manifest"), "Release closure gate must include submission manifest generation.");
check(readFileSync("scripts/release-closure-gate.mjs", "utf8").includes("release:submission-preview"), "Release closure gate must include submission preview generation.");
check(readFileSync("scripts/release-closure-gate.mjs", "utf8").includes("release:push-readiness"), "Release closure gate must include push readiness generation.");
check(readFileSync("scripts/release-ci-preflight.mjs", "utf8").includes("submit-prep.json"), "Release CI preflight must read the submit prep report.");
check(readFileSync("scripts/release-ci-preflight.mjs", "utf8").includes("submission-safety.json"), "Release CI preflight must read the submission safety report.");
check(readFileSync("scripts/release-ci-preflight.mjs", "utf8").includes("submission-plan.json"), "Release CI preflight must read the submission plan report.");
check(readFileSync("scripts/release-ci-preflight.mjs", "utf8").includes("submission-manifest.json"), "Release CI preflight must read the submission manifest report.");
check(readFileSync("scripts/release-ci-preflight.mjs", "utf8").includes("submission-preview.json"), "Release CI preflight must read the submission preview report.");
check(readFileSync("scripts/release-ci-preflight.mjs", "utf8").includes("push-readiness.json"), "Release CI preflight must read the push readiness report.");
check(readFileSync("scripts/release-submission-plan.mjs", "utf8").includes("pathspecMatchesAddable"), "Release submission plan must verify pathspec coverage.");
check(readFileSync("scripts/release-submission-plan.mjs", "utf8").includes("duplicatePathspecEntries"), "Release submission plan must detect duplicate pathspec entries.");
check(readFileSync("scripts/release-submission-plan.mjs", "utf8").includes("gitAddDryRun"), "Release submission plan must verify the pathspec with git add --dry-run.");
check(readFileSync("scripts/release-submission-plan.mjs", "utf8").includes("simulatedStrictTracking"), "Release submission plan must simulate strict tracking with a temporary git index.");
for (const requiredSubmissionFile of [
  "package.json",
  "package-lock.json",
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
  "src-tauri/capabilities/desktop.json",
  "src-tauri/src/lib.rs",
  "src-tauri/src/services/credential_service.rs",
  "src/services/appUpdateService.ts",
  "scripts/release-submit-prep.mjs",
  "scripts/release-submission-safety.mjs",
  "scripts/release-submission-manifest.mjs",
  "scripts/release-submission-preview.mjs",
  "scripts/release-push-readiness.mjs",
  "项目文档/发布提交准备总览.md",
  "项目文档/发布提交安全检查记录.md",
  "项目文档/发布提交校验清单.md",
  "项目文档/发布提交预演记录.md",
  "项目文档/发布推送准备记录.md",
]) {
  check(
    releaseRequiredFiles.includes(requiredSubmissionFile),
    `Release required files list must include ${requiredSubmissionFile}.`,
  );
}
check(readFileSync("scripts/final-progress-audit.mjs", "utf8").includes("release:remote-status"), "Final progress audit refresh must include remote status verification.");
check(readFileSync("scripts/final-progress-audit.mjs", "utf8").includes("release:submit-prep"), "Final progress audit refresh must include submit prep verification.");
check(readFileSync("scripts/final-progress-audit.mjs", "utf8").includes("release:submission-safety"), "Final progress audit refresh must include submission safety verification.");
check(readFileSync("scripts/final-progress-audit.mjs", "utf8").includes("release:submission-manifest"), "Final progress audit refresh must include submission manifest verification.");
check(readFileSync("scripts/final-progress-audit.mjs", "utf8").includes("release:submission-preview"), "Final progress audit refresh must include submission preview verification.");
check(readFileSync("scripts/final-progress-audit.mjs", "utf8").includes("release:push-readiness"), "Final progress audit refresh must include push readiness verification.");
check(packageJson.scripts?.["release:updater-config"]?.includes("prepare-tauri-updater-config.mjs"), "package.json must expose release:updater-config.");
check(packageJson.scripts?.["ai:e2e:preflight"]?.includes("ai-provider-preflight.mjs"), "package.json must expose ai:e2e:preflight.");
check(packageJson.scripts?.["ai:e2e:auto"]?.includes("ai-provider-auto-e2e.mjs"), "package.json must expose ai:e2e:auto.");
check(packageJson.scripts?.["ai:e2e:mock"]?.includes("ai-provider-mock-e2e.mjs"), "package.json must expose ai:e2e:mock.");
check(packageJson.scripts?.["release:downloads"]?.includes("verify-downloaded-artifacts.mjs"), "package.json must expose release:downloads.");
check(packageJson.scripts?.["release:install-smoke"]?.includes("release-install-smoke.mjs"), "package.json must expose release:install-smoke.");
check(packageJson.scripts?.["release:install-manual"]?.includes("record-install-smoke-evidence.mjs"), "package.json must expose release:install-manual.");
check(packageJson.scripts?.["release:signing"]?.includes("release-signing-verify.mjs"), "package.json must expose release:signing.");
check(packageJson.scripts?.["release:aggregate-evidence"]?.includes("aggregate-release-evidence.mjs"), "package.json must expose release:aggregate-evidence.");
check(packageJson.scripts?.["release:workflow-validate"]?.includes("validate-release-workflows.mjs"), "package.json must expose release:workflow-validate.");
check(packageJson.scripts?.["release:ci-preflight"]?.includes("release-ci-preflight.mjs"), "package.json must expose release:ci-preflight.");
check(packageJson.scripts?.["release:remote-status"]?.includes("release-remote-status.mjs"), "package.json must expose release:remote-status.");
check(packageJson.scripts?.["release:distribution"]?.includes("release-distribution-verify.mjs"), "package.json must expose release:distribution.");
check(packageJson.scripts?.["release:secrets"]?.includes("release-secrets-audit.mjs"), "package.json must expose release:secrets.");
check(packageJson.scripts?.["release:secrets:sync"]?.includes("sync-release-secrets.mjs"), "package.json must expose release:secrets:sync.");
check(packageJson.scripts?.["release:readiness"]?.includes("release-external-readiness.mjs"), "package.json must expose release:readiness.");
check(packageJson.scripts?.["release:handoff"]?.includes("generate-external-closure-handoff.mjs"), "package.json must expose release:handoff.");
check(packageJson.scripts?.["release:closure"]?.includes("release-closure-gate.mjs"), "package.json must expose release:closure.");
check(packageJson.scripts?.["release:final-audit"]?.includes("final-progress-audit.mjs"), "package.json must expose release:final-audit.");
check(packageJson.scripts?.["release:tracking"]?.includes("release-tracking-gate.mjs"), "package.json must expose release:tracking.");
check(packageJson.scripts?.["release:submit-prep"]?.includes("release-submit-prep.mjs"), "package.json must expose release:submit-prep.");
check(packageJson.scripts?.["release:submission-safety"]?.includes("release-submission-safety.mjs"), "package.json must expose release:submission-safety.");
check(packageJson.scripts?.["release:submission-plan"]?.includes("release-submission-plan.mjs"), "package.json must expose release:submission-plan.");
check(packageJson.scripts?.["release:submission-manifest"]?.includes("release-submission-manifest.mjs"), "package.json must expose release:submission-manifest.");
check(packageJson.scripts?.["release:submission-preview"]?.includes("release-submission-preview.mjs"), "package.json must expose release:submission-preview.");
check(packageJson.scripts?.["release:push-readiness"]?.includes("release-push-readiness.mjs"), "package.json must expose release:push-readiness.");
check(packageJson.scripts?.["release:dry-run"]?.includes("run-release-dry-run.mjs"), "package.json must expose release:dry-run.");

const externalRequirements = [
  {
    label: "AI external provider E2E",
    env: ["AI_E2E_ENDPOINT", "AI_E2E_MODEL", "AI_E2E_API_KEY"],
  },
  {
    label: "Updater signing",
    env: ["TAURI_SIGNING_PRIVATE_KEY"],
  },
  {
    label: "Updater public key",
    env: ["MOKNOW_UPDATER_PUBKEY"],
  },
  {
    label: "macOS signing certificate",
    env: ["APPLE_CERTIFICATE", "APPLE_CERTIFICATE_PASSWORD"],
  },
  {
    label: "macOS notarization",
    any: [
      ["APPLE_ID", "APPLE_PASSWORD", "APPLE_TEAM_ID"],
      ["APPLE_API_KEY", "APPLE_API_ISSUER"],
    ],
  },
  {
    label: "Windows code signing",
    any: [["WINDOWS_CERTIFICATE", "WINDOWS_CERTIFICATE_PASSWORD"], ["TAURI_WINDOWS_SIGNTOOL_PATH"]],
  },
  {
    label: "Distribution URL",
    env: ["MOKNOW_RELEASE_DOWNLOAD_BASE_URL", "MOKNOW_HOMEPAGE_URL"],
  },
  {
    label: "Homebrew tap",
    env: ["MOKNOW_HOMEBREW_TAP"],
  },
];

function requirementSatisfied(requirement) {
  if (requirement.env) return requirement.env.every((name) => Boolean(process.env[name]));
  return requirement.any.some((group) => group.every((name) => Boolean(process.env[name])));
}

for (const requirement of externalRequirements) {
  const satisfied = requirementSatisfied(requirement);
  warn(satisfied, `${requirement.label} environment is not configured.`);
  if (flags.has("--strict-external")) {
    check(satisfied, `${requirement.label} environment must be configured for strict release checks.`);
  }
}

const gitStatus = spawnSync("git", ["status", "--short"], { encoding: "utf8" });
if (gitStatus.status === 0 && gitStatus.stdout.trim()) {
  warn(!flags.has("--strict-dirty"), "Working tree has uncommitted changes. Pass --strict-dirty to fail on this warning.");
  check(!flags.has("--strict-dirty"), "Working tree must be clean for a strict release check.");
}

console.log(`MoKnow release check for ${expectedTag}`);
console.log("Required external release items:");
console.log("- AI_E2E_ENDPOINT, AI_E2E_MODEL, and AI_E2E_API_KEY for real external AI provider E2E verification.");
console.log("- GitHub Actions secrets for code signing, notarization, and updater signing when signing is enabled.");
console.log("- Apple Developer ID certificate, Apple ID / ASC provider details, or App Store Connect API details for macOS.");
console.log("- Windows code-signing certificate, signtool/custom signing command, and timestamp server configuration for Windows.");
console.log("- TAURI_SIGNING_PRIVATE_KEY, MOKNOW_UPDATER_PUBKEY, HTTPS update endpoint, release download base URL, homepage URL, and Homebrew tap before enabling automatic updates/distribution.");
console.log("- Run npm run release:handoff -- --write-doc to generate the external closure checklist and env template.");

if (flags.has("--run-tests")) run("npm", ["run", "test"]);
if (flags.has("--run-build")) run("npm", ["run", "build"]);
if (flags.has("--run-tauri-build")) run("npm", ["run", "tauri:build"]);
if (flags.has("--run-artifact-check")) run("npm", ["run", "release:artifacts"]);
if (flags.has("--run-install-smoke")) run("npm", ["run", "release:install-smoke"]);
if (flags.has("--run-signing-check")) run("npm", ["run", "release:signing"]);
if (flags.has("--run-ci-preflight")) run("npm", ["run", "release:ci-preflight"]);

for (const warning of warnings) console.warn(`WARN: ${warning}`);

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}

console.log("Release check passed.");

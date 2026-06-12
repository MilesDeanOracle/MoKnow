#!/usr/bin/env node
import { existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);

function argValue(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

function hasFlag(name) {
  return args.includes(name);
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_./:=@-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function commandText(command, commandArgs) {
  return [command, ...commandArgs].map(shellQuote).join(" ");
}

function run(command, commandArgs, options = {}) {
  if (printOnly) {
    console.log(commandText(command, commandArgs));
    return { stdout: "" };
  }

  const result = spawnSync(command, commandArgs, {
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    shell: process.platform === "win32",
    timeout: options.timeoutSeconds ? options.timeoutSeconds * 1000 : undefined,
  });

  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${commandText(command, commandArgs)} failed with exit code ${result.status ?? "unknown"}${detail ? `\n${detail}` : ""}`);
  }

  return { stdout: result.stdout ?? "" };
}

function currentBranch() {
  const result = spawnSync("git", ["branch", "--show-current"], { encoding: "utf8" });
  if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
  return "main";
}

function getLatestRunId({ workflow, ref }) {
  const result = run(
    "gh",
    [
      "run",
      "list",
      "--workflow",
      workflow,
      "--branch",
      ref,
      "--event",
      "workflow_dispatch",
      "--limit",
      "1",
      "--json",
      "databaseId,status,conclusion,url,createdAt",
    ],
    { capture: true },
  );
  const runs = JSON.parse(result.stdout || "[]");
  const run = runs[0];
  if (!run?.databaseId) {
    throw new Error(`No workflow_dispatch run was found for ${workflow} on ${ref}.`);
  }
  console.log(`Using dry-run workflow run ${run.databaseId}: ${run.url ?? ""}`);
  return String(run.databaseId);
}

const workflow = argValue("--workflow", "release-dry-run.yml");
const ref = argValue("--ref", process.env.GITHUB_REF_NAME ?? currentBranch());
const artifactRoot = argValue("--artifact-root", "release/downloaded-artifacts");
const platform = argValue("--platform", "all");
const timeoutSeconds = String(Number(argValue("--timeout-minutes", "90")) * 60);
const printOnly = hasFlag("--print-only");
const skipPreflight = hasFlag("--skip-preflight");
const noWait = hasFlag("--no-wait");
const skipDownload = hasFlag("--skip-download");
const skipVerify = hasFlag("--skip-verify");
const skipInstallSmoke = hasFlag("--skip-install-smoke");
const skipSigning = hasFlag("--skip-signing");
const skipAggregateEvidence = hasFlag("--skip-aggregate-evidence");
const skipFinalAudit = hasFlag("--skip-final-audit");
const writeDoc = hasFlag("--write-doc");
const keepArtifacts = hasFlag("--keep-artifacts");
const skipWorkflowValidate = hasFlag("--skip-workflow-validate");
const skipRemoteStatus = hasFlag("--skip-remote-status");

try {
  console.log(`Release dry-run workflow: ${workflow}`);
  console.log(`Ref: ${ref}`);
  console.log(`Artifact root: ${artifactRoot}`);

  if (!skipPreflight) {
    if (!skipWorkflowValidate) {
      run("npm", [
        "run",
        "release:workflow-validate",
        "--",
        "--strict",
        ...(writeDoc ? ["--write-doc"] : []),
      ]);
    }

    run("npm", [
      "run",
      "release:ci-preflight",
      "--",
      "--strict",
      "--ref",
      ref,
      "--workflow",
      workflow,
      ...(writeDoc ? ["--write-doc"] : []),
    ]);
  }

  run("gh", ["workflow", "run", workflow, "--ref", ref]);

  if (noWait) {
    console.log("Dry-run workflow dispatched. Skipping wait/download because --no-wait was provided.");
    process.exit(0);
  }

  if (!printOnly) {
    // Give GitHub a short moment to make the newly dispatched run visible to `gh run list`.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000);
  }

  const runId = printOnly ? "<latest-run-id>" : getLatestRunId({ workflow, ref });
  run("gh", ["run", "watch", runId, "--exit-status", "--interval", "30"], { timeoutSeconds: Number(timeoutSeconds) });

  if (!skipRemoteStatus) {
    run("npm", [
      "run",
      "release:remote-status",
      "--",
      "--mode",
      "dry-run",
      "--strict",
      "--ref",
      ref,
      ...(writeDoc ? ["--write-doc"] : []),
    ]);
  }

  if (!skipDownload) {
    if (!printOnly && !keepArtifacts && existsSync(artifactRoot)) {
      rmSync(artifactRoot, { recursive: true, force: true });
    }
    run("gh", ["run", "download", runId, "--dir", artifactRoot]);
  }

  if (!skipVerify) {
    run("npm", [
      "run",
      "release:downloads",
      "--",
      "--artifact-root",
      artifactRoot,
      "--platform",
      platform,
      "--source",
      `GitHub Actions Release Dry Run ${runId}`,
      ...(writeDoc ? ["--write-doc"] : []),
    ]);

    if (!skipInstallSmoke) {
      run("npm", [
        "run",
        "release:install-smoke",
        "--",
        "--artifact-root",
        artifactRoot,
        "--platform",
        platform,
        ...(writeDoc ? ["--write-doc"] : []),
      ]);
    }

    if (!skipSigning) {
      run("npm", [
        "run",
        "release:signing",
        "--",
        "--artifact-root",
        artifactRoot,
        "--platform",
        platform,
        ...(writeDoc ? ["--write-doc"] : []),
      ]);
    }

    if (!skipAggregateEvidence) {
      run("npm", [
        "run",
        "release:aggregate-evidence",
        "--",
        "--artifact-root",
        artifactRoot,
      ]);
    }

    if (!skipFinalAudit) {
      const finalAuditArgs = ["run", "release:final-audit"];
      if (writeDoc) finalAuditArgs.push("--", "--write-doc");
      run("npm", finalAuditArgs);
    }
  }

  console.log("Release dry-run automation completed.");
} catch (error) {
  console.error(`Release dry-run automation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

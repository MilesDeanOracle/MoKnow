#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith("--")));

function argValue(name, fallback = undefined) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function splitEndpoints(value) {
  return value
    .split(",")
    .map((endpoint) => endpoint.trim())
    .filter(Boolean);
}

const outputPath = resolve(argValue("--out", "src-tauri/tauri.updater.conf.json"));
const releaseBaseUrl = (argValue("--base-url", process.env.MOKNOW_RELEASE_DOWNLOAD_BASE_URL ?? "") ?? "").replace(/\/+$/, "");
const explicitEndpoints = argValue("--endpoint", process.env.MOKNOW_UPDATER_ENDPOINT ?? "");
const pubkey = argValue("--pubkey", process.env.MOKNOW_UPDATER_PUBKEY ?? "");
const allowInsecure = flags.has("--allow-insecure");
const createUpdaterArtifacts = flags.has("--v1-compatible") ? "v1Compatible" : true;

const endpoints = explicitEndpoints
  ? splitEndpoints(explicitEndpoints)
  : releaseBaseUrl
    ? [`${releaseBaseUrl}/latest.json`]
    : [];

if (!pubkey) {
  fail("MOKNOW_UPDATER_PUBKEY or --pubkey is required to generate the Tauri updater config.");
}

if (endpoints.length === 0) {
  fail("MOKNOW_UPDATER_ENDPOINT, MOKNOW_RELEASE_DOWNLOAD_BASE_URL, --endpoint, or --base-url is required.");
}

for (const endpoint of endpoints) {
  if (!/^https:\/\//i.test(endpoint)) {
    const isLocalEndpoint = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::|\/|$)/i.test(endpoint);
    if (!allowInsecure || !isLocalEndpoint) {
      fail(`Updater endpoint must use HTTPS for release builds: ${endpoint}`);
    }
  }
}

const updaterConfig = {
  $schema: "https://schema.tauri.app/config/2",
  bundle: {
    createUpdaterArtifacts,
  },
  plugins: {
    updater: {
      pubkey,
      endpoints,
      windows: {
        installMode: "passive",
      },
      ...(allowInsecure ? { dangerousInsecureTransportProtocol: true } : {}),
    },
  },
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(updaterConfig, null, 2)}\n`);

console.log(`Generated Tauri updater config: ${outputPath}`);
console.log(`Updater endpoints: ${endpoints.join(", ")}`);

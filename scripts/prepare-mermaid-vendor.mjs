#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

const sourceRoot = "node_modules/mermaid/dist";
const targetRoot = "public/vendor/mermaid";
const sourceEntry = join(sourceRoot, "mermaid.esm.min.mjs");
const sourceChunks = join(sourceRoot, "chunks/mermaid.esm.min");
const targetEntry = join(targetRoot, "mermaid.esm.min.mjs");
const targetChunks = join(targetRoot, "chunks/mermaid.esm.min");

if (!existsSync(sourceEntry) || !existsSync(sourceChunks)) {
  console.error("Mermaid dist files were not found. Run npm install first.");
  process.exit(1);
}

rmSync(targetRoot, { recursive: true, force: true });
mkdirSync(dirname(targetEntry), { recursive: true });
mkdirSync(dirname(targetChunks), { recursive: true });

cpSync(sourceEntry, targetEntry);
cpSync(sourceChunks, targetChunks, {
  recursive: true,
  filter: (source) => statSync(source).isDirectory() || source.endsWith(".mjs"),
});

console.log("Prepared Mermaid vendor runtime in public/vendor/mermaid.");

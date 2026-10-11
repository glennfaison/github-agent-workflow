#!/usr/bin/env node
// Copies package.json's version into .claude-plugin/plugin.json.
// Runs as part of `npm run version`, right after `changeset version`.
// With --check it changes nothing and exits 1 if the two versions differ.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pluginPath = join(root, ".claude-plugin", "plugin.json");

const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const source = readFileSync(pluginPath, "utf8");
const plugin = JSON.parse(source);

if (plugin.version === version) {
  console.log(`plugin.json version is ${version} (already in sync)`);
  process.exit(0);
}

if (process.argv.includes("--check")) {
  console.error(`plugin.json version is ${plugin.version}, package.json is ${version}. Run \`node scripts/sync-plugin-version.mjs\`.`);
  process.exit(1);
}

// Rewrite only the version line, so key order and formatting stay as they are.
const updated = source.replace(/("version"\s*:\s*")[^"]*(")/, `$1${version}$2`);
if (updated === source) {
  console.error("could not find a version line in plugin.json");
  process.exit(1);
}
writeFileSync(pluginPath, updated);
console.log(`plugin.json version set to ${version}`);

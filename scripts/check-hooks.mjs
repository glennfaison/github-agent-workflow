#!/usr/bin/env node
// Fails when this checkout's git hooks are not the ones the package installs, so a hook that is
// silently not running shows up as an error instead of a hunch. `npm test` runs it first.
//
//   node scripts/check-hooks.mjs
//
// A hook never runs when `core.hooksPath` points somewhere else, when `npm install` was skipped
// (`prepare` is what installs husky), or when HUSKY=0. The fix is `npm install` (or `npm run prepare`).
// The check is skipped where hooks do not apply: CI, no .git directory, or HUSKY=0.

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOOKS = ["pre-commit", "pre-push"];

if (process.env.CI || process.env.HUSKY === "0" || !existsSync(join(root, ".git"))) {
  console.log("hooks: skipped (CI, HUSKY=0 or no .git)");
  process.exit(0);
}

const problems = [];
const hooksPath = spawnSync("git", ["config", "--get", "core.hooksPath"], { cwd: root, encoding: "utf8" }).stdout.trim();
if (hooksPath !== ".husky/_") problems.push(`core.hooksPath is ${hooksPath ? `"${hooksPath}"` : "not set"}, expected ".husky/_"`);
for (const h of HOOKS) {
  if (!existsSync(join(root, ".husky", h))) problems.push(`.husky/${h} is missing`);
  else if (!existsSync(join(root, ".husky", "_", h))) problems.push(`.husky/_/${h} is not installed`);
}

if (problems.length) {
  console.error(`hooks: not installed\n  - ${problems.join("\n  - ")}\nRun \`npm run prepare\` (or \`npm install\`) in the package root.`);
  process.exit(1);
}
console.log("hooks: installed");

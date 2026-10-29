#!/usr/bin/env node
// Lints files without any configuration. The pre-commit hook passes it the staged files (through
// lint-staged); CI runs it on every tracked file, so a skipped hook is caught there.
//
//   node scripts/lint-files.mjs FILE...     lint these files
//   node scripts/lint-files.mjs --all       lint every file git tracks
//
// What it checks, by file type:
//   *.mjs, *.js          the syntax parses (node --check)
//   *.sh                 the syntax parses (bash -n); shellcheck at error severity when installed
//   *.json               valid JSON
//   *.yml, *.yaml        valid YAML
//   *.md                 front matter, when present, is valid YAML (an unquoted ": " in a skill's
//                        description makes harnesses skip the skill)
//   any text file        no unresolved merge conflict markers
//
// Package-wide rules (names, links, generated files) stay in `npm run validate`. Exit code 1 on any error.

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { extname } from "node:path";
import { parse, parseAllDocuments } from "yaml";

const args = process.argv.slice(2);
const git = (a) => spawnSync("git", a, { encoding: "utf8" });

let files;
if (args.includes("--all")) {
  const r = git(["ls-files", "-z"]);
  if (r.status !== 0) { console.error("lint: git ls-files failed"); process.exit(2); }
  files = r.stdout.split("\0").filter(Boolean);
} else {
  files = args.filter((a) => !a.startsWith("-"));
}

const hasShellcheck = spawnSync("shellcheck", ["--version"]).status === 0;
const errors = [];
const err = (file, msg) => errors.push(`${file}: ${msg}`);
const run = (cmd, a) => spawnSync(cmd, a, { encoding: "utf8" });
const firstLine = (s) => (s || "").trim().split("\n").filter(Boolean).slice(0, 3).join(" | ");

export function lintYaml(text, file) {
  for (const d of parseAllDocuments(text)) {
    for (const e of d.errors) err(file, `invalid YAML: ${e.message.split("\n")[0]}`);
  }
}

function frontMatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  return m ? m[1] : null;
}

for (const file of files) {
  if (!existsSync(file)) continue; // deleted in the commit
  const ext = extname(file);
  let text;
  try { text = readFileSync(file, "utf8"); } catch { continue; }
  if (text.includes("\0")) continue; // binary

  if (/^(<{7}|>{7})( |$)/m.test(text)) err(file, "unresolved merge conflict marker");

  if (ext === ".mjs" || ext === ".js") {
    const r = run("node", ["--check", file]);
    if (r.status !== 0) err(file, `syntax error: ${firstLine(r.stderr)}`);
  } else if (ext === ".sh") {
    const r = run("bash", ["-n", file]);
    if (r.status !== 0) err(file, `syntax error: ${firstLine(r.stderr)}`);
    else if (hasShellcheck) {
      const s = run("shellcheck", ["--severity=error", "--format=gcc", file]);
      if (s.status !== 0) err(file, `shellcheck: ${firstLine(s.stdout)}`);
    }
  } else if (ext === ".json") {
    try { JSON.parse(text); } catch (e) { err(file, `invalid JSON: ${e.message}`); }
  } else if (ext === ".yml" || ext === ".yaml") {
    lintYaml(text, file);
  } else if (ext === ".md") {
    const fm = frontMatter(text);
    if (fm !== null) {
      try { parse(fm, { strict: true }); } catch (e) { err(file, `invalid front matter YAML: ${e.message.split("\n")[0]}`); }
    }
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  console.error(`\n${errors.length} lint error(s).`);
  process.exit(1);
}
console.log(`lint: ${files.length} file(s) OK`);

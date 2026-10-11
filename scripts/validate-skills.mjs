#!/usr/bin/env node
// Validates the skills in this package. No dependencies. Exit code 1 on any error.
//
// Layout:  skills/<bucket>/<skill>/SKILL.md   (exactly three levels)
//
// Checks, per skill:
//   - front matter is valid for the strict parsers real harnesses use (an unquoted ": " in a plain
//     scalar makes a harness skip the skill), `name` matches the directory, `description` is present
//     and at most 1024 characters
//   - agents/openai.yaml exists, and its invocation policy agrees with disable-model-invocation
//   - every skill named next to "Skill tool" exists in this package or in external-skills.json, and is
//     not user-invoked (a user-invoked skill cannot be reached by another skill)
//   - `references/...` and `scripts/...` paths exist in the skill, or in agent-workflow-protocol
//   - relative markdown links resolve
//   - nothing repository-specific has leaked into skills/, scripts/ or tests/
//   - every $KEY a skill names exists in config.defaults.env, and every key there is used
// Package-wide:
//   - .claude-plugin/plugin.json lists exactly the promoted skills
//   - bucket READMEs and the root README link every skill

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const NOT_PROMOTED = new Set(["deprecated", "in-progress"]);
const PROTOCOL = "agent-workflow-protocol";
const LEAKS = [
  [/livepage/i, "mentions LivePage"],
  [/pagecrafter/i, "mentions pagecrafter"],
  [/glennfaison/i, "mentions glennfaison"],
  [/\.agents\/docs\/(?!github-agent-workflow\.env)/, "points at .agents/docs/ (except the sanctioned config file)"],
  [/scripts\/agent\//, "points at scripts/agent/"],
  [/\.agents\/skills\/agent-workflow-protocol/, "hard-codes the protocol skill's path"],
  [/`(?:develop|main)`/, "hard-codes a branch name (use $PR_BASE_BRANCH)"],
];

const errors = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);
const read = (p) => readFileSync(p, "utf8");
const dirs = (p) => (existsSync(p) ? readdirSync(p).filter((n) => statSync(join(p, n)).isDirectory()) : []);

// ---- discover ----------------------------------------------------------
const skills = []; // { name, bucket, dir, md, fm, body, promoted }
for (const bucket of dirs(join(root, "skills"))) {
  for (const name of dirs(join(root, "skills", bucket))) {
    const dir = join(root, "skills", bucket, name);
    const md = join(dir, "SKILL.md");
    if (!existsSync(md)) { err(`skills/${bucket}/${name}`, "no SKILL.md"); continue; }
    skills.push({ name, bucket, dir, md, rel: `skills/${bucket}/${name}`, promoted: !NOT_PROMOTED.has(bucket) });
  }
}

// ---- front matter --------------------------------------------------------
function parseFrontMatter(text, where) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) { err(where, "no front matter"); return null; }
  const fm = {};
  for (const line of m[1].split("\n")) {
    if (!line.trim() || line.startsWith(" ")) continue;
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) { err(where, `front matter line is not "key: value": ${line}`); continue; }
    let [, key, value] = kv;
    const quoted = /^(".*"|'.*')$/.test(value);
    const block = /^[>|]/.test(value);
    if (!quoted && !block) {
      if (/: /.test(value)) err(where, `front matter "${key}" has an unquoted ": " (invalid YAML, harnesses skip the skill). Reword it or quote it.`);
      if (/ #/.test(value)) err(where, `front matter "${key}" has an unquoted " #" (starts a YAML comment)`);
    }
    fm[key] = quoted ? value.slice(1, -1) : value;
  }
  return fm;
}

const byName = new Map();
for (const s of skills) {
  const text = read(s.md);
  s.fm = parseFrontMatter(text, s.rel) ?? {};
  s.body = text.replace(/^---\n[\s\S]*?\n---\n?/, "");
  s.userInvoked = String(s.fm["disable-model-invocation"]) === "true";
  if (s.fm.name !== s.name) err(s.rel, `name "${s.fm.name}" does not match directory "${s.name}"`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s.name) || s.name.length > 64) err(s.rel, "directory name must be kebab-case, at most 64 chars");
  if (!s.fm.description) err(s.rel, "missing description");
  else if (s.fm.description.length > 1024) err(s.rel, `description is ${s.fm.description.length} chars (max 1024)`);
  if (byName.has(s.name)) err(s.rel, `duplicate skill name, also in ${byName.get(s.name).rel}`);
  byName.set(s.name, s);
}

// ---- agents/openai.yaml --------------------------------------------------
for (const s of skills) {
  const y = join(s.dir, "agents", "openai.yaml");
  if (!existsSync(y)) { err(s.rel, "missing agents/openai.yaml"); continue; }
  const text = read(y);
  if (!/display_name:\s*\S/.test(text)) err(`${s.rel}/agents/openai.yaml`, "missing interface.display_name");
  if (!/short_description:\s*\S/.test(text)) err(`${s.rel}/agents/openai.yaml`, "missing interface.short_description");
  const blocksImplicit = /allow_implicit_invocation:\s*false/.test(text);
  if (blocksImplicit !== s.userInvoked) {
    err(s.rel, "disable-model-invocation and agents/openai.yaml policy.allow_implicit_invocation must agree (both set, or neither)");
  }
}

// ---- external skills -----------------------------------------------------
const external = new Set();
const extPath = join(root, "external-skills.json");
if (existsSync(extPath)) {
  for (const pkg of Object.values(JSON.parse(read(extPath)))) {
    for (const n of [...(pkg.required ?? []), ...(pkg.optional ?? [])]) external.add(n);
  }
}

// ---- references inside each skill ---------------------------------------
const protocol = byName.get(PROTOCOL);
for (const s of skills) {
  // Skill-tool calls
  // Only the names right after "Skill tool with" / "Skill tool twice, for" count: the same sentence
  // may go on to mention other backticked words.
  const calls = [...s.body.matchAll(/Skill tool (?:with|twice, for|for)\s+((?:`[^`]+`(?:(?:,|\s+and|\s+for)+\s*)?)+)/g)];
  for (const [, list] of calls) {
    for (const [, n] of list.matchAll(/`([^`]+)`/g)) {
      const target = byName.get(n);
      if (target) {
        if (target.userInvoked) err(s.rel, `calls the Skill tool with "${n}", which is user-invoked and cannot be reached that way`);
      } else if (!external.has(n)) {
        err(s.rel, `calls the Skill tool with "${n}", which is neither in this package nor in external-skills.json`);
      }
    }
  }
  // file paths
  for (const [, p] of s.body.matchAll(/`((?:references|scripts)\/[A-Za-z0-9_./-]+)`/g)) {
    const here = existsSync(join(s.dir, p));
    const inProtocol = protocol && existsSync(join(protocol.dir, p));
    if (!here && !inProtocol) err(s.rel, `refers to \`${p}\`, which exists neither here nor in ${PROTOCOL}`);
  }
  // markdown links
  for (const [, target] of s.body.matchAll(/\]\(([^)#\s]+)[^)]*\)/g)) {
    if (/^(https?:|mailto:)/.test(target)) continue;
    if (!existsSync(join(s.dir, target))) err(s.rel, `broken link: ${target}`);
  }
}
// reference docs too
for (const s of skills) {
  for (const f of existsSync(join(s.dir, "references")) ? readdirSync(join(s.dir, "references")) : []) {
    const text = read(join(s.dir, "references", f));
    for (const [, target] of text.matchAll(/\]\(([^)#\s]+)[^)]*\)/g)) {
      if (/^(https?:|mailto:)/.test(target)) continue;
      if (!existsSync(join(s.dir, "references", target))) err(`${s.rel}/references/${f}`, `broken link: ${target}`);
    }
  }
}

// ---- no repository-specific leakage -------------------------------------
function walk(p, out = []) {
  for (const n of readdirSync(p)) {
    const full = join(p, n);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}
for (const base of ["skills", "scripts", "tests"]) {
  const p = join(root, base);
  if (!existsSync(p)) continue;
  for (const file of walk(p)) {
    if (file.endsWith("validate-skills.mjs")) continue; // holds the patterns themselves
    const text = read(file);
    for (const [re, why] of LEAKS) if (re.test(text)) err(relative(root, file), why);
  }
}

// ---- config keys -----------------------------------------------------------
// A skill that names $SOME_KEY must find it in config.defaults.env, and every key there must be used.
if (protocol) {
  const cfgPath = join(protocol.dir, "config.defaults.env");
  const keys = new Set([...read(cfgPath).matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]));
  const SHELL_VARS = new Set(["RUN_ID", "SHA"]); // set by lib.sh or by the skill itself
  const mdFiles = walk(join(root, "skills")).filter((f) => f.endsWith(".md"));
  const text = mdFiles.map((f) => [f, read(f)]);
  for (const [file, body] of text) {
    for (const [, v] of body.matchAll(/\$\{?([A-Z][A-Z0-9_]+)/g)) {
      if (!keys.has(v) && !SHELL_VARS.has(v)) err(relative(root, file), `uses $${v}, which is not in config.defaults.env`);
    }
  }
  for (const k of keys) {
    if (!text.some(([, body]) => body.includes(k))) err(relative(root, cfgPath), `${k} is not used by any skill`);
  }
}

// ---- plugin manifest -----------------------------------------------------
const pluginPath = join(root, ".claude-plugin", "plugin.json");
if (existsSync(pluginPath)) {
  const plugin = JSON.parse(read(pluginPath));
  const listed = new Set((plugin.skills ?? []).map((p) => p.replace(/^\.\//, "")));
  const promoted = new Set(skills.filter((s) => s.promoted).map((s) => s.rel));
  for (const r of promoted) if (!listed.has(r)) err(".claude-plugin/plugin.json", `does not list ${r}`);
  for (const r of listed) {
    if (!promoted.has(r)) err(".claude-plugin/plugin.json", `lists ${r}, which is not a promoted skill on disk`);
  }
}

// ---- READMEs link every skill -------------------------------------------
const rootReadme = existsSync(join(root, "README.md")) ? read(join(root, "README.md")) : "";
for (const s of skills.filter((x) => x.promoted)) {
  if (!rootReadme.includes(`${s.rel}/SKILL.md`)) err("README.md", `does not link ${s.rel}/SKILL.md`);
  const bucketReadme = join(root, "skills", s.bucket, "README.md");
  if (!existsSync(bucketReadme)) err(`skills/${s.bucket}`, "missing README.md");
  else if (!read(bucketReadme).includes(`](./${s.name}/SKILL.md)`)) err(`skills/${s.bucket}/README.md`, `does not link ./${s.name}/SKILL.md`);
}

// ---- report --------------------------------------------------------------
if (errors.length) {
  console.error(`${errors.length} problem(s):\n`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}
console.log(`${skills.length} skills OK (${skills.filter((s) => s.promoted).length} promoted, ${skills.filter((s) => s.userInvoked).length} user-invoked)`);

// Checks the `## Contract` block that every pipeline skill carries (see **Contracts** in
// agent-workflow-protocol). Pure functions: no file access, so tests/contracts.test.mjs can feed
// them synthetic skills. scripts/validate-skills.mjs reads the files and calls checkContracts.
//
// A skill is described to this module as:
//   { name, rel, bucket, body, inputKeys, userInvoked }
// where `body` is the SKILL.md text without front matter and `inputKeys` are the keys in the rows
// of its `## Inputs` table.

import { parse } from "yaml";

export const STEPS = ["Exploring", "Triaging", "Implementing", "Shepherding", "Reviewing"];
export const KINDS = ["item", "group"];
export const WRITE_SCOPES = ["claimed", "repository", "other", "shared"];

const COMMON = ["kind", "step", "params", "requires", "returns", "ensures", "effects", "never", "calls", "idempotent", "terminates"];
const REQUIRED = { item: ["target", ...COMMON], group: ["dispatches", ...COMMON] };
const ALLOWED = new Set([...COMMON, "target", "types", "dispatches"]);

// Prose sections that the contract replaces. A skill that still has one has two sources of truth.
export const FOLDED_SECTIONS = ["Eligibility", "Context read", "Outputs", "Result", "Never", "Success criteria"];

const PROTOCOL = "agent-workflow-protocol";

/** The YAML text of the first ```yaml fence inside the `## Contract` section, or null. */
export function extractContract(body) {
  const lines = body.split("\n");
  const start = lines.findIndex((l) => /^## Contract\s*$/.test(l));
  if (start === -1) return null;
  let open = -1;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) return null;
    if (open === -1 && /^```yaml\s*$/.test(lines[i])) open = i;
    else if (open !== -1 && /^```\s*$/.test(lines[i])) {
      return { yaml: lines.slice(open + 1, i).join("\n"), text: lines.slice(start, i + 1).join("\n") };
    }
  }
  return null;
}

const isStrings = (v) => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string" && x.trim() !== "");
const isText = (v) => typeof v === "string" && v.trim() !== "";
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

/** The first word of a result line such as "#N PR #P opened" (-> "PR"), or null for a placeholder. */
export function resultHead(line) {
  const m = line.match(/^#N\s+([A-Za-z][A-Za-z-]*)/);
  return m ? m[1] : null;
}

/** Headings of the sections in a skill body. */
export function headings(body) {
  return [...body.matchAll(/^## (.+?)\s*$/gm)].map((m) => m[1].replace(/[`*]/g, "").trim());
}

/**
 * @param {Array} skills        pipeline skills to check
 * @param {Map<string, object>} byName  every skill in the package, by name
 * @param {Set<string>} external names of skills the package needs from elsewhere
 * @returns {string[]} one message per problem, each starting with the skill's path
 */
export function checkContracts(skills, byName, external = new Set()) {
  const errors = [];
  const parsed = new Map();

  for (const s of skills) {
    const err = (msg) => errors.push(`${s.rel}: contract: ${msg}`);
    const found = extractContract(s.body);
    if (!found) { err("no `## Contract` section with a ```yaml block"); continue; }
    let c;
    try { c = parse(found.yaml); } catch (e) { err(`invalid YAML: ${String(e.message).split("\n")[0]}`); continue; }
    if (!c || typeof c !== "object" || Array.isArray(c)) { err("the block is not a YAML mapping"); continue; }
    parsed.set(s.name, c);

    for (const k of Object.keys(c)) if (!ALLOWED.has(k)) err(`unknown key \`${k}\``);
    if (!KINDS.includes(c.kind)) { err(`kind must be one of ${KINDS.join(", ")}`); continue; }
    if (!STEPS.includes(c.step)) err(`step must be one of ${STEPS.join(", ")}`);
    for (const k of REQUIRED[c.kind]) if (c[k] === undefined) err(`missing \`${k}\``);
    if (c.kind === "item" && c.dispatches !== undefined) err("an item skill does not dispatch");

    // params are the Inputs table
    if (!isStrings(c.params) && !(Array.isArray(c.params) && c.params.length === 0)) err("`params` must be a list of names");
    else {
      const missing = s.inputKeys.filter((k) => !c.params.includes(k));
      const extra = c.params.filter((k) => !s.inputKeys.includes(k));
      if (missing.length) err(`\`params\` is missing ${missing.map((k) => `\`${k}\``).join(", ")}, which the Inputs table lists`);
      if (extra.length) err(`\`params\` has ${extra.map((k) => `\`${k}\``).join(", ")}, which the Inputs table does not list`);
    }

    // target
    if (c.target !== undefined) {
      const t = c.target;
      if (!t || typeof t !== "object" || (!t.param && !t.from) || !isText(t.type)) err("`target` needs `param` or `from`, and a `type`");
      else if (t.param && !(c.params ?? []).includes(t.param)) err(`target.param \`${t.param}\` is not in \`params\``);
    }
    const argTarget = c.target?.param ? c.target.param : null;

    for (const k of ["requires", "returns", "ensures", "never"]) {
      if (c[k] !== undefined && !isStrings(c[k])) err(`\`${k}\` must be a non-empty list of strings`);
    }
    for (const k of ["idempotent", "terminates"]) {
      if (c[k] !== undefined && !isText(c[k])) err(`\`${k}\` must be a sentence`);
    }

    // effects
    const e = c.effects;
    if (e !== undefined) {
      if (!e || typeof e !== "object") err("`effects` must be a mapping");
      else {
        if (!isStrings(e.reads)) err("`effects.reads` must be a non-empty list of strings");
        if (!e.writes || typeof e.writes !== "object" || Array.isArray(e.writes)) err("`effects.writes` must be a mapping (it may be empty)");
        else {
          for (const [scope, list] of Object.entries(e.writes)) {
            if (!WRITE_SCOPES.includes(scope)) err(`effects.writes scope \`${scope}\` is not one of ${WRITE_SCOPES.join(", ")}`);
            else if (!isStrings(list)) err(`effects.writes.${scope} must be a non-empty list of strings`);
          }
          if (c.kind === "group" && e.writes.claimed) err("a group skill never claims, so it has no `effects.writes.claimed`");
          if (c.kind === "item" && argTarget && !e.writes.claimed) err("an item skill that is given an issue or PR claims it, so it needs `effects.writes.claimed`");
        }
        if (e.external !== undefined && !isStrings(e.external)) err("`effects.external` must be a non-empty list of strings");
      }
    }

    // the prose must not keep a second copy of what the contract says
    for (const h of headings(s.body)) {
      if (FOLDED_SECTIONS.includes(h)) err(`has a \`## ${h}\` section. That belongs in the contract now`);
    }

    // results
    const prose = s.body.replace(found.text, "");
    if (argTarget && isStrings(c.returns)) {
      const heads = new Set();
      for (const r of c.returns) {
        const h = resultHead(r);
        if (!h) err(`result \`${r}\` must look like \`#N <outcome>\``);
        else heads.add(h);
      }
      for (const need of ["skipped", "failed"]) if (!heads.has(need)) err(`\`returns\` has no \`#N ${need}: <reason>\``);
      if (/references\/escalate\.md/.test(prose) && !heads.has("escalated")) err("the skill can escalate (it cites references/escalate.md) but `returns` has no `#N escalated: <reason>`");
      for (const [, rest] of prose.matchAll(/`#N ([^`]+)`/g)) {
        if (rest.startsWith("<")) continue; // a placeholder such as `#N <outcome>`
        const h = rest.match(/^[A-Za-z][A-Za-z-]*/)?.[0];
        if (h && !heads.has(h)) err(`the text returns \`#N ${rest}\`, which is not in \`returns\``);
      }
    }

    // calls: skills reached through the Skill tool
    const known = (n) => byName.get(n) ?? (external.has(n) ? { external: true } : null);
    for (const n of c.calls ?? []) {
      const t = known(n);
      if (!t) err(`calls \`${n}\`, which is neither in this package nor in external-skills.json`);
      else if (t.userInvoked) err(`calls \`${n}\`, which is user-invoked and cannot be called`);
    }
    if (c.calls !== undefined && !Array.isArray(c.calls)) err("`calls` must be a list");
    const mentioned = new Set();
    for (const [, list] of prose.matchAll(/Skill tool (?:with|twice, for|for)\s+((?:`[^`]+`(?:(?:,|\s+and|\s+for)+\s*)?)+)/g)) {
      for (const [, n] of list.matchAll(/`([^`]+)`/g)) if (n !== PROTOCOL) mentioned.add(n);
    }
    for (const n of mentioned) if (!(c.calls ?? []).includes(n)) err(`the text calls \`${n}\` through the Skill tool, but \`calls\` does not list it`);
  }

  // dispatch targets are item skills of the same step
  for (const s of skills) {
    const c = parsed.get(s.name);
    if (!c || c.kind !== "group" || c.dispatches === undefined) continue;
    const t = byName.get(c.dispatches);
    const tc = parsed.get(c.dispatches);
    if (!t) errors.push(`${s.rel}: contract: dispatches \`${c.dispatches}\`, which is not a skill in this package`);
    else if (!tc) errors.push(`${s.rel}: contract: dispatches \`${c.dispatches}\`, which has no contract`);
    else {
      if (tc.kind !== "item") errors.push(`${s.rel}: contract: dispatches \`${c.dispatches}\`, which is not an item skill`);
      if (tc.step !== c.step) errors.push(`${s.rel}: contract: dispatches \`${c.dispatches}\`, which belongs to ${tc.step} and not ${c.step}`);
      if (t.userInvoked) errors.push(`${s.rel}: contract: dispatches \`${c.dispatches}\`, which is user-invoked`);
      if (tc.effects?.writes?.shared && !(tc.params ?? []).includes("write_log")) {
        errors.push(`${s.rel}: contract: dispatches \`${c.dispatches}\`, which writes the run log but has no \`write_log\` param, so the group cannot stop it logging twice`);
      }
    }
  }
  return { errors, contracts: parsed };
}

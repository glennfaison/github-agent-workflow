// Checks the `## Contract` block that every skill carries (see **Contracts** in
// agent-workflow-protocol), except the ones listed as pending (see `options.pending`). Pure functions: no file access, so tests/contracts.test.mjs can feed
// them synthetic skills. scripts/validate-skills.mjs reads the files and calls checkContracts.
//
// A skill is described to this module as:
//   { name, rel, bucket, body, inputKeys, userInvoked }
// where `body` is the SKILL.md text without front matter and `inputKeys` are the keys in the rows
// of its `## Inputs` table.

import { parse } from "yaml";

export const STEPS = ["Exploring", "Triaging", "Implementing", "Shepherding", "Reviewing"];
export const PIPELINE_KINDS = ["item", "group", "sweep"];
export const KINDS = [...PIPELINE_KINDS, "utility", "reference"];
export const WRITE_SCOPES = ["claimed", "repository", "other", "shared"];

const COMMON = ["kind", "step", "params", "requires", "returns", "ensures", "effects", "never", "calls", "idempotent", "terminates"];
// A utility skill is called from other skills and has no step of its own, but says who calls it.
const UTILITY = COMMON.filter((k) => k !== "step").concat("used_by");
const REQUIRED = {
  item: ["target", ...COMMON],
  group: ["dispatches", ...COMMON],
  sweep: [...COMMON],
  utility: UTILITY,
  reference: ["kind"], // reference material is exempt from everything else, and says so
};
const ALLOWED = new Set([...COMMON, "target", "types", "dispatches", "used_by"]);

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

/**
 * How much a skill can change, from `effects.writes` alone:
 *   pure             writes nothing
 *   claimed          writes only the item it holds a lease on
 *   writes elsewhere writes anything else (`repository`, `other`, `shared`)
 * A reference skill is never run, so it has no class of its own. Returns null for a malformed contract.
 */
export function purity(c) {
  if (c?.kind === "reference") return "reference";
  const w = c?.effects?.writes;
  if (!w || typeof w !== "object" || Array.isArray(w)) return null;
  const scopes = Object.keys(w);
  if (scopes.length === 0) return "pure";
  return scopes.every((k) => k === "claimed") ? "claimed" : "writes elsewhere";
}

/** Headings of the sections in a skill body. */
export function headings(body) {
  return [...body.matchAll(/^## (.+?)\s*$/gm)].map((m) => m[1].replace(/[`*]/g, "").trim());
}

/**
 * @param {Array} skills        the skills to check. A pipeline skill must have a contract; so must any
 *                              other skill, unless it is in `options.pending`
 * @param {Map<string, object>} byName  every skill in the package, by name
 * @param {Set<string>} external names of skills the package needs from elsewhere
 * @param {{pending?: Set<string>}} options  `pending`: skills that do not have a contract yet. A
 *                              pipeline skill may call one. The set only shrinks: a skill that gains
 *                              a contract must leave it
 * @returns {{errors: string[], contracts: Map<string, object>}} one message per problem, each
 *                              starting with the skill's path
 */
export function checkContracts(skills, byName, external = new Set(), { pending = new Set() } = {}) {
  const errors = [];
  const parsed = new Map();

  for (const s of skills) {
    const err = (msg) => errors.push(`${s.rel}: contract: ${msg}`);
    const found = extractContract(s.body);
    if (!found) { if (!pending.has(s.name)) err("no `## Contract` section with a ```yaml block"); continue; }
    if (pending.has(s.name)) err("has a contract, so it must leave the pending list (`CONTRACT_PENDING` in scripts/validate-skills.mjs)");
    let c;
    try { c = parse(found.yaml); } catch (e) { err(`invalid YAML: ${String(e.message).split("\n")[0]}`); continue; }
    if (!c || typeof c !== "object" || Array.isArray(c)) { err("the block is not a YAML mapping"); continue; }
    parsed.set(s.name, c);

    for (const k of Object.keys(c)) if (!ALLOWED.has(k)) err(`unknown key \`${k}\``);
    if (!KINDS.includes(c.kind)) { err(`kind must be one of ${KINDS.join(", ")}`); continue; }
    if (c.kind === "reference") {
      // Reference material is never run: no effects, no returns, no scenarios. Nothing else is allowed, so
      // a skill cannot claim the exemption and also carry half a contract.
      for (const k of Object.keys(c)) if (k !== "kind") err(`a reference skill has only \`kind\`, not \`${k}\``);
      continue;
    }
    if (c.step === undefined ? c.kind !== "utility" : !STEPS.includes(c.step)) err(`step must be one of ${STEPS.join(", ")}`);
    for (const k of REQUIRED[c.kind]) if (c[k] === undefined) err(`missing \`${k}\``);
    if (c.kind !== "group" && c.dispatches !== undefined) err("only a group skill dispatches");
    if (c.kind !== "utility" && c.used_by !== undefined) err("only a utility skill has `used_by`");

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
    const argTarget = c.kind === "item" && c.target?.param ? c.target.param : null;

    // eligibility only reads: a precondition that calls a writing helper is a hidden side effect
    for (const r of Array.isArray(c.requires) ? c.requires : []) {
      const w = typeof r === "string" && r.match(/\b(clear_stale_lease|claim|renew|release|fail_item|log_run)\b/);
      if (w) err(`\`requires\` mentions \`${w[1]}\`, which writes. Checking eligibility must only read`);
    }
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
          if (c.kind !== "item" && e.writes.claimed) err("only an item skill claims, so a group or sweep skill has no `effects.writes.claimed`");
          if (c.kind === "item" && argTarget && !e.writes.claimed) err("an item skill that is given an issue or PR claims it, so it needs `effects.writes.claimed`");
        }
        if (e.external !== undefined && !isStrings(e.external)) err("`effects.external` must be a non-empty list of strings");
      }
    }

    // the prose must not keep a second copy of what the contract says
    for (const h of headings(s.body)) {
      if (FOLDED_SECTIONS.includes(h)) err(`has a \`## ${h}\` section. That belongs in the contract now`);
    }

    // A utility skill returns a document, so `returns` describes its shape: sections, or the verdicts it may give.
    if (c.kind === "utility" && isStrings(c.returns)) {
      for (const r of c.returns) if (/^#N\b/.test(r)) err(`result \`${r}\` is an item result. A utility skill returns a document, so \`returns\` describes its sections or verdicts`);
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
  // The loop between callers and callees. A skill a contracted skill calls must have a contract of its
  // own, and a utility skill's `used_by` must list the callers, and only the callers.
  const callable = (n) => byName.get(n) && !byName.get(n).userInvoked;
  for (const s of skills) {
    const c = parsed.get(s.name);
    if (!c || c.kind === "reference" || !Array.isArray(c.calls)) continue;
    for (const n of c.calls) {
      if (!callable(n) || external.has(n) || n === s.name) continue; // reported above, or not ours to check
      const tc = parsed.get(n);
      if (!tc) {
        if (!pending.has(n)) errors.push(`${s.rel}: contract: calls \`${n}\`, which has no \`## Contract\``);
      } else if (tc.kind === "utility" && Array.isArray(tc.used_by) && !tc.used_by.includes(s.name)) {
        errors.push(`${s.rel}: contract: calls \`${n}\`, but its \`used_by\` does not list \`${s.name}\``);
      }
    }
  }
  for (const s of skills) {
    const c = parsed.get(s.name);
    if (!c || c.kind !== "utility" || c.used_by === undefined) continue;
    const err = (msg) => errors.push(`${s.rel}: contract: ${msg}`);
    if (!Array.isArray(c.used_by) || !c.used_by.every((x) => typeof x === "string" && x.trim() !== "")) { err("`used_by` must be a list of skill names"); continue; }
    if (s.userInvoked) {
      if (c.used_by.length) err("it is user-invoked, so no skill can call it and `used_by` must be `[]`");
      continue;
    }
    if (c.used_by.length === 0) err("`used_by` is empty, but nothing is a caller of a skill that is not user-invoked. List the skills that call it");
    for (const n of c.used_by) {
      const caller = byName.get(n);
      const cc = parsed.get(n);
      if (!caller) err(`used_by \`${n}\`, which is not a skill in this package`);
      else if (!cc) { if (!pending.has(n)) err(`used_by \`${n}\`, which has no \`## Contract\``); }
      else if (cc.kind === "reference") err(`used_by \`${n}\`, which is reference material and calls nothing`);
      else if (!(cc.calls ?? []).includes(s.name)) err(`used_by \`${n}\`, but \`${n}\` does not list \`${s.name}\` in \`calls\``);
    }
  }
  return { errors, contracts: parsed };
}

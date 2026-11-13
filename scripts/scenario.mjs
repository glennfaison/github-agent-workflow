// Checks a scenario against a skill's contract. Pure functions, no GitHub and no model. The one file it reads is
// the protocol's references/labels.md, which the setup scenarios need.
//
// A scenario says: this skill, these inputs, this world. The expected result is one line, and the
// expected effects are the net changes the run leaves behind. The checker then asks four things:
//   1. Is the result one of the contract's `returns`?
//   2. Is every effect in a scope the contract's `effects.writes` allows?
//   3. Do the invariants hold in the world after the effects (one state label, lease released, ...)?
//   4. Do the executable eligibility oracles agree with the result?
//
// It does not run a skill. A real run is checked the same way: `diffWorlds(before, after)` turns the
// change a run left behind into effects, and the result line goes with them. See docs/adr/0012-scenarios.md.

import { isDeepStrictEqual } from "node:util";
import { readFileSync } from "node:fs";
import { contractOf } from "./skill-contracts.mjs";
import { ALLOW_OPS, REPOSITORY_OPS, allowsOf } from "./contracts.mjs";
import { canSplit, depthOf } from "../skills/meta/agent-workflow-protocol/scripts/helpers.mjs";

export const MUTEX_ISSUE = ["needs-info", "ready-for-agent", "ready-for-human", "agent:pr-open"];
export const MUTEX_PR = ["agent:needs-work", "agent:ready-for-review", "agent:human-merge"];
export const LEASE_LABELS = ["agent:triage", "agent:in-progress"];
// `unmodelled` is not something a skill does: diffWorlds reports a change it cannot express with it.
const OPS = [...ALLOW_OPS, "unmodelled"];

// ---- repository state: the label set and the agent instructions file ------------------------------
// A world may hold `labels: [{name, description}]` (the repository's label set) and `files: {path: text}`.
// Effects: `label_create {name, description}`, `label_update {name, description}` (a label that exists, reset)
// and `write_file {path, text}`. All three are `repository` writes.

/**
 * The labels the setup block of the protocol's references/labels.md creates, read from that file so a
 * scenario cannot drift from it: [{ name, description?, force }]. `force` is `--force`, which resets an
 * existing label's description. A label made without it is left alone when it exists.
 */
export function labelCatalog(markdown) {
  const section = markdown.split(/^## Setup.*$/m)[1] ?? "";
  return [...section.matchAll(/^gh label create "([^"]+)"(.*)$/gm)].map(([, name, rest]) => {
    const description = rest.match(/--description "([^"]*)"/)?.[1];
    return { name, ...(description !== undefined ? { description } : {}), force: /--force\b/.test(rest) };
  });
}
export const SETTINGS = ["pr_base_branch", "app_url", "merge_method", "human_reviewer", "human_merge_paths", "build_cmd", "git_hooks_path", "repo_guidance", "trusted_authors"];
export const LABEL_CATALOG = labelCatalog(readFileSync(new URL("../skills/meta/agent-workflow-protocol/references/labels.md", import.meta.url), "utf8"));

/** The effects that running the setup block against `labels` leaves behind. */
export function syncLabels(labels, catalog = LABEL_CATALOG) {
  return catalog.flatMap((c) => {
    const have = (labels ?? []).find((l) => l.name === c.name);
    if (!have) return [{ op: "label_create", name: c.name, ...(c.description !== undefined ? { description: c.description } : {}) }];
    if (c.force && (have.description ?? "") !== (c.description ?? "")) return [{ op: "label_update", name: c.name, description: c.description ?? "" }];
    return [];
  });
}

/**
 * Expands the two shorthands a scenario may use for the catalog, so that it never lists labels itself:
 * `{from: labels.md}` inside `world.labels` is every label of the catalog (a later entry of the same name
 * overrides it), and `{op: labels_sync}` in `expect.effects` is what the setup block does to that world.
 * Tests expand a scenario before they apply its effects. checkScenario expands it too, which is harmless.
 */
export function expandScenario(sc, catalog = LABEL_CATALOG) {
  const c = structuredClone(sc);
  if (Array.isArray(c.world?.labels)) {
    const out = new Map();
    for (const l of c.world.labels) {
      if (l.from === "labels.md") for (const x of catalog) out.set(x.name, { name: x.name, ...(x.description !== undefined ? { description: x.description } : {}) });
      else out.set(l.name, l);
    }
    c.world.labels = [...out.values()];
  }
  if (Array.isArray(c.expect?.effects)) c.expect.effects = c.expect.effects.flatMap((e) => (e.op === "labels_sync" ? syncLabels(c.world?.labels ?? [], catalog) : [e]));
  return c;
}

/** "pr#40" -> { kind: "pr", n: 40 } */
export function ref(t) {
  const m = /^(issue|pr)#(\d+)$/.exec(String(t));
  if (!m) throw new Error(`bad target \`${t}\`: expected issue#N or pr#N`);
  return { kind: m[1], n: Number(m[2]) };
}

export function item(world, target) {
  const { kind, n } = ref(target);
  return (kind === "issue" ? world.issues : world.prs)?.find((x) => x.number === n);
}

/** The merge-lane holder: another open PR carrying agent:ready-for-review, or null. */
export function laneHolder(world, n) {
  return world.prs?.find((p) => p.number !== n && p.state === "open" && (p.labels ?? []).includes("agent:ready-for-review")) ?? null;
}

/** "no-checks-yet" | "pending" | "failing" | "green", as shepherd-github-pr reads it. */
export function checkState(pr) {
  const c = pr.checks ?? [];
  if (c.length === 0) return "no-checks-yet";
  if (c.includes("pending")) return "pending";
  if (c.includes("fail") || c.includes("cancel")) return "failing";
  return "green";
}

// ---- oracles: eligibility written as code, from the skill's `requires` -------------------------

/**
 * The lease clause every item skill's `requires` ends its first clause with. The world models a
 * lease as `lease: live | stale | none` on the item (none when absent). A lease label whose lease is
 * not live is stale and does not count. With `lease_held=true` the caller holds the lease, so it
 * must be live. Returns a reason when the item is not eligible, otherwise null.
 */
export function leaseProblem(it, leaseLabels, inputs = {}) {
  const lease = it.lease ?? "none";
  if (inputs.lease_held === true) return lease === "live" ? null : "lease_held=true but the caller's lease is not live";
  const held = (it.labels ?? []).some((l) => leaseLabels.includes(l)) && lease === "live";
  return held ? "another run holds a live lease" : null;
}

/** True when a trusted comment on the item carries the marker. A world comment is `{marker, trusted?, text?}`, trusted unless it says `trusted: false`: who wrote a comment is part of the world, and a run only adds its own. */
export const hasTrustedMarker = (it, m) => (it.comments ?? []).some((c) => c.marker === m && c.trusted !== false);

/** The issues that are sub-issues of `n` in the world: those whose `parent` is `n`. */
export const childrenOf = (world, n) => (world.issues ?? []).filter((i) => i.parent === n);

/**
 * How many ancestors issue `n` has in the world, from each issue's `parent` (null for none). Null when a link
 * leads to an issue the world does not hold or loops: that depth could not be read, and an unread depth never splits.
 */
export function worldDepth(world, n) {
  const parents = Object.fromEntries((world.issues ?? []).map((i) => [i.number, i.parent ?? null]));
  try { return depthOf(n, parents); } catch { return null; }
}

/** How many `requires` entries each oracle mirrors. A test fails when a skill's count differs. */
export const ORACLE_REQUIRES = {
  "triage-github-issue": 3,
  "implement-github-issue": 3,
  "review-github-pr": 2,
  "shepherd-github-pr": 4,
};

const NOT_TRIAGEABLE = ["ready-for-agent", "ready-for-human", "needs-info", "agent:pr-open", "agent:stuck", "agent:log", "agent:difficulty"];

export const ORACLES = {
  /** Mirrors the `requires` of triage-github-issue. `needs-triage` does not exclude an issue. */
  "triage-github-issue"(world, target, inputs = {}) {
    const issue = item(world, target);
    const L = issue.labels ?? [];
    if (issue.state !== "open") return { eligible: false, reason: "not open" };
    const hit = NOT_TRIAGEABLE.find((l) => L.includes(l));
    if (hit) return { eligible: false, reason: `carries ${hit}` };
    const lease = leaseProblem(issue, ["agent:triage", "agent:in-progress"], inputs);
    return lease ? { eligible: false, reason: lease } : { eligible: true };
  },

  /** Mirrors the `requires` of implement-github-issue. */
  "implement-github-issue"(world, target, inputs = {}) {
    const issue = item(world, target);
    const L = issue.labels ?? [];
    if (issue.state !== "open" || !L.includes("ready-for-agent") || L.includes("agent:stuck")) {
      return { eligible: false, reason: "not an open ready-for-agent issue" };
    }
    if (hasTrustedMarker(issue, "agent:split")) return { eligible: false, reason: "already split" };
    const lease = leaseProblem(issue, ["agent:in-progress"], inputs);
    return lease ? { eligible: false, reason: lease } : { eligible: true };
  },

  /** Mirrors the `requires` of review-github-pr. */
  "review-github-pr"(world, target, inputs = {}) {
    const pr = item(world, target);
    const L = pr.labels ?? [];
    if (pr.state !== "open" || pr.draft || !L.includes("agent:ready-for-review") || L.includes("agent:stuck") || L.includes("agent:human-merge")) {
      return { eligible: false, reason: "not an open, non-draft agent:ready-for-review PR" };
    }
    const lease = leaseProblem(pr, ["agent:in-progress"], inputs);
    return lease ? { eligible: false, reason: lease } : { eligible: true };
  },

  /** Mirrors the `requires` of shepherd-github-pr. Returns { eligible, reason }. */
  "shepherd-github-pr"(world, target, inputs = {}) {
    const pr = item(world, target);
    const L = pr.labels ?? [];
    if (pr.state !== "open" || !L.includes("agent:needs-work") || L.includes("agent:stuck") || L.includes("agent:human-merge")) {
      return { eligible: false, reason: "not an open agent:needs-work PR" };
    }
    const lease = leaseProblem(pr, ["agent:in-progress"], inputs);
    if (lease) return { eligible: false, reason: lease };
    const checks = checkState(pr);
    const conflict = pr.mergeState === "DIRTY";
    if (!(checks === "failing" || checks === "green" || conflict)) return { eligible: false, reason: `checks ${checks}` };
    const needsFix = checks === "failing" || (pr.openFindings ?? 0) > 0 || conflict;
    if (!needsFix) {
      const holder = laneHolder(world, pr.number);
      if (holder) return { eligible: false, reason: `merge lane held by #${holder.number}` };
      if (pr.mergeState === "UNKNOWN") return { eligible: false, reason: "merge state not computed" };
    }
    return { eligible: true };
  },
};

// ---- effects -----------------------------------------------------------------------------------

/** Which scope of `effects.writes` an effect falls in. */
export function scopeOf(effect, ctx) {
  if (effect.op === "unmodelled") return "unmodelled";
  if (REPOSITORY_OPS.includes(effect.op)) return "repository";
  if (effect.op === "comment" || effect.op === "comment_edit") {
    const t = item(ctx.world, effect.target);
    if (t && (t.labels ?? []).includes("agent:log")) return "shared";
  }
  if (ctx.claimed.has(effect.target) && effect.op !== "create_issue") return "claimed";
  return "other";
}

/** `*` matches any run of characters, and nothing else is special: labels and markers are plain names. */
export function globMatches(glob, s) {
  const re = glob.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${re}$`).test(s);
}

/**
 * The marker of the comment an effect writes. A `comment` names its own. A `comment_edit` names only the index, so the
 * marker is the one on that comment in the world the run started from. `null`: the comment has no marker.
 * `undefined`: it cannot be found, which no `allow` matches.
 */
export function markerOf(effect, ctx) {
  if (effect.op === "comment") return effect.marker ?? null;
  const c = item(ctx.world, effect.target)?.comments?.[effect.index];
  return c ? (c.marker ?? null) : undefined;
}

/** The first of the structured `allow` mappings that permits the effect, or null. `op` must match, and so must `label` and `marker` where the mapping has them. */
export function allowedBy(effect, allows, ctx) {
  for (const a of allows) {
    if (a.op !== effect.op) continue;
    if (a.label !== undefined && !(typeof effect.label === "string" && globMatches(a.label, effect.label))) continue;
    if ("marker" in a) {
      const m = markerOf(effect, ctx);
      if (a.marker === null ? m !== null : !(typeof m === "string" && globMatches(a.marker, m))) continue;
    }
    return a;
  }
  return null;
}

const describe = (x) => [x.op, x.label !== undefined && `\`${x.label}\``, "marker" in x && (x.marker === null ? "(no marker)" : `\`${x.marker}\``)].filter(Boolean).join(" ");

/**
 * Why the contract does not allow an effect, or null when it does. First the scope must be one `effects.writes` lists.
 * Then, if that scope has structured entries (`allow`), one of them must match: the scope alone is not enough, because
 * a skill that may add its own labels could otherwise add any label. `why` ends the sentence that the caller starts.
 * Throws when the effect cannot be placed (it names an item that is not in the world).
 */
export function forbiddenWrite(contract, effect, ctx) {
  const scope = scopeOf(effect, ctx);
  const writes = contract.effects?.writes ?? {};
  if (!Object.hasOwn(writes, scope)) return { scope, why: `is a \`${scope}\` write, which the contract does not allow` };
  const allows = allowsOf(writes[scope]);
  if (allows.length === 0 || allowedBy(effect, allows, ctx)) return null;
  return { scope, why: `is a \`${scope}\` write, but it is not one the contract's \`allow\` entries permit (${describe({ ...effect, ...(effect.op === "comment_edit" ? { marker: markerOf(effect, ctx) } : {}) })}). It allows: ${allows.map(describe).join("; ")}` };
}

/** The item that a `create_pr` or `create_issue` effect adds to the world `w`. */
export function createdItem(w, e) {
  if (e.op === "create_pr") return { ...e.data, number: e.number, state: "open", labels: e.labels ?? [], draft: false, head: e.sha ?? "new", base: e.base ?? w.default_branch ?? "main", checks: [], openFindings: 0, closes: e.closes ?? [], comments: [] };
  return { ...e.data, number: e.number, state: "open", labels: e.labels ?? [], comments: [] };
}

/**
 * What a new item is made with, besides what a `create_*` effect names: its title, its body, when it was created, who
 * opened it, (for a PR) its branch and (for an issue) the parent it is a sub-issue of. A `create_*` effect carries these as `data`. Editing one later is still `unmodelled`.
 */
export const CREATION_DATA = ["title", "body", "createdAt", "author", "branch", "parent"];

/** Apply effects to a copy of the world. Throws when an effect is impossible. */
export function applyEffects(world, effects) {
  const w = structuredClone(world);
  w.issues ??= []; w.prs ??= [];
  for (const e of effects) {
    if (!OPS.includes(e.op)) throw new Error(`unknown effect op \`${e.op}\``);
    if (e.op === "create_pr") { w.prs.push(createdItem(w, e)); continue; }
    if (e.op === "create_issue") { w.issues.push(createdItem(w, e)); continue; }
    if (e.op === "unmodelled") continue; // a change the checker cannot express: scope-checked, never applied
    if (e.op === "label_create") {
      w.labels ??= [];
      if (w.labels.some((l) => l.name === e.name)) throw new Error(`creates label \`${e.name}\`, which already exists`);
      w.labels.push({ name: e.name, ...(e.description ? { description: e.description } : {}) });
      continue;
    }
    if (e.op === "label_update") {
      const l = w.labels?.find((x) => x.name === e.name);
      if (!l) throw new Error(`updates label \`${e.name}\`, which does not exist`);
      if (e.description) l.description = e.description; else delete l.description;
      continue;
    }
    if (e.op === "write_file") { w.files ??= {}; w.files[e.path] = e.text; continue; }
    const t = item(w, e.target);
    if (!t) throw new Error(`effect ${e.op} targets ${e.target}, which is not in the world`);
    t.labels ??= []; t.comments ??= [];
    switch (e.op) {
      case "label_add": if (!t.labels.includes(e.label)) t.labels.push(e.label); break;
      case "label_remove":
        if (!t.labels.includes(e.label)) throw new Error(`removes \`${e.label}\` from ${e.target}, which does not carry it`);
        t.labels = t.labels.filter((l) => l !== e.label); break;
      case "comment": t.comments.push({ marker: e.marker, text: e.text, ...(e.trusted !== undefined ? { trusted: e.trusted } : {}) }); break;
      // A comment the run edited in place (a lease): `index` is its place among the item's comments, `text` its new text.
      case "comment_edit": {
        const c = t.comments[e.index];
        if (!c) throw new Error(`\`comment_edit\` on ${e.target}: it has no comment ${e.index}`);
        c.text = e.text;
        break;
      }
      case "close": t.state = "closed"; if (e.reason) t.closeReason = e.reason; break;
      case "push": t.head = e.sha ?? `${t.head}+`; t.pushed = true; break;
      case "merge": t.state = "merged"; break;
      case "delete_branch": t.branchDeleted = true; break;
      case "review_request": break;
    }
  }
  return w;
}

// ---- diffWorlds: what a run changed, as effects ----------------------------------------------------

// What a world is, for comparing two of them. Labels are a set. Items are ordered by number. A comment
// is its marker and its text: who wrote it, and whether that author is trusted, belong to the world and
// are not something a run does. `pushed` says what the run did, not what the world is, and a branch that is
// not deleted is the same as one with no `branchDeleted`.
export function canonicalWorld(world) {
  const item = (kind) => (i) => {
    const c = JSON.parse(JSON.stringify(i)); // plain data: drops `undefined`
    c.labels = [...new Set(c.labels ?? [])].sort();
    c.comments = (c.comments ?? []).map((m) => ({ marker: m.marker, text: m.text })).map((m) => JSON.parse(JSON.stringify(m)));
    if (kind === "pr") { delete c.pushed; if (!c.branchDeleted) delete c.branchDeleted; }
    return c;
  };
  const { issues = [], prs = [], ...rest } = JSON.parse(JSON.stringify(world));
  if (rest.labels) rest.labels = rest.labels.map((l) => ({ name: l.name, ...(l.description ? { description: l.description } : {}) })).sort((a, b) => a.name.localeCompare(b.name));
  return {
    ...rest,
    issues: issues.map(item("issue")).sort((a, b) => a.number - b.number),
    prs: prs.map(item("pr")).sort((a, b) => a.number - b.number),
  };
}

/** True when two worlds are the same world by `canonicalWorld`. */
export const sameWorld = (a, b) => isDeepStrictEqual(canonicalWorld(a), canonicalWorld(b));

const MODELLED = { issue: ["number", "labels", "comments", "state", "closeReason"], pr: ["number", "labels", "comments", "state", "head", "pushed", "branchDeleted"] };
const defined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/**
 * The net effects that turn `before` into `after`, in the ops `applyEffects` accepts, so that
 * `sameWorld(applyEffects(before, diffWorlds(before, after)), after)` holds whenever the result has no
 * `unmodelled` effect. A label added and removed in one run does not appear. The lease label and the
 * `agent:lease` comment are ordinary effects here: the checker adds a claim's marker to a scenario's
 * effects itself, so a caller that passes a diff to `checkScenario` leaves that comment out of it.
 *
 * Anything that no op can express (a changed title, body, checks or base of an item that already existed; an edited or removed comment;
 * a reopened item; a removed item) becomes `{ op: "unmodelled", target, field, before, after }`.
 * `checkScenario` rejects it unless the contract lists an `unmodelled` write scope. `review_request`
 * changes nothing in a world, so a diff never contains one.
 *
 * @returns {object[]} effects: creations first, then each item's changes, then `unmodelled` ones
 */
export function diffWorlds(before, after) {
  const created = [], changed = [], unmodelled = [];
  const odd = (target, field, b, a) => unmodelled.push({ op: "unmodelled", target, field, before: b, after: a });
  const kinds = [["issue", "issues"], ["pr", "prs"]];

  const diffItem = (kind, b, a) => {
    const target = `${kind}#${a.number}`;
    const out = [];
    const bl = new Set(b.labels ?? []), al = new Set(a.labels ?? []);
    for (const label of bl) if (!al.has(label)) out.push({ op: "label_remove", target, label });
    for (const label of al) if (!bl.has(label)) out.push({ op: "label_add", target, label });

    if (kind === "pr" && a.head !== b.head) {
      if (typeof a.head === "string") out.push({ op: "push", target, sha: a.head });
      else odd(target, "head", b.head, a.head);
    }

    const bc = b.comments ?? [], ac = a.comments ?? [];
    const same = (x, y) => x.marker === y.marker && x.text === y.text;
    // A comment that keeps its marker and has new text was edited in place. Any other change to the comments is `unmodelled`.
    const edited = (x, y) => y !== undefined && !same(x, y) && x.marker === y.marker && typeof y.text === "string";
    if (bc.length > ac.length || bc.some((c, i) => !same(c, ac[i]) && !edited(c, ac[i]))) odd(target, "comments", bc, ac);
    else {
      bc.forEach((c, i) => { if (!same(c, ac[i])) out.push({ op: "comment_edit", target, index: i, text: ac[i].text }); });
      for (const c of ac.slice(bc.length)) out.push({ op: "comment", target, ...defined({ marker: c.marker, text: c.text }) });
    }

    if (a.state !== b.state) {
      const open = b.state === "open" || b.state === undefined;
      if (open && a.state === "closed") out.push({ op: "close", target, ...defined({ reason: a.closeReason }) });
      else if (open && kind === "pr" && a.state === "merged") out.push({ op: "merge", target, ...defined({ sha: typeof a.head === "string" ? a.head : undefined }) });
      else odd(target, "state", b.state, a.state);
    }

    if (kind === "pr" && Boolean(a.branchDeleted) !== Boolean(b.branchDeleted)) {
      if (a.branchDeleted) out.push({ op: "delete_branch", target });
      else odd(target, "branchDeleted", b.branchDeleted, a.branchDeleted);
    }

    for (const k of new Set([...Object.keys(b), ...Object.keys(a)])) {
      if (MODELLED[kind].includes(k)) continue;
      if (!isDeepStrictEqual(b[k], a[k])) odd(target, k, b[k], a[k]);
    }
    changed.push(...out);
  };

  for (const [kind, key] of kinds) {
    const was = new Map((before[key] ?? []).map((i) => [i.number, i]));
    const now = new Map((after[key] ?? []).map((i) => [i.number, i]));
    for (const n of [...was.keys()].sort((x, y) => x - y)) if (!now.has(n)) odd(`${kind}#${n}`, "(removed)", was.get(n), undefined);
    for (const n of [...now.keys()].sort((x, y) => x - y)) {
      const a = now.get(n);
      if (was.has(n)) { diffItem(kind, was.get(n), a); continue; }
      // a new item: create it, then diff what is left against what the creation gives
      const data = defined(Object.fromEntries(CREATION_DATA.map((k) => [k, a[k]])));
      const e = kind === "pr"
        ? { op: "create_pr", number: n, labels: [...new Set(a.labels ?? [])], ...defined({ sha: typeof a.head === "string" ? a.head : undefined, base: a.base }), closes: a.closes ?? [] }
        : { op: "create_issue", number: n, labels: [...new Set(a.labels ?? [])] };
      if (Object.keys(data).length > 0) e.data = data;
      created.push(e);
      const stub = applyEffects({ issues: [], prs: [], default_branch: before.default_branch }, [e]);
      diffItem(kind, (kind === "pr" ? stub.prs : stub.issues)[0], a);
    }
  }

  const lb = new Map((before.labels ?? []).map((l) => [l.name, l.description ?? ""]));
  const la = new Map((after.labels ?? []).map((l) => [l.name, l.description ?? ""]));
  for (const [name, d] of la) {
    if (!lb.has(name)) changed.push({ op: "label_create", name, ...(d ? { description: d } : {}) });
    else if (lb.get(name) !== d) changed.push({ op: "label_update", name, description: d });
  }
  for (const name of lb.keys()) if (!la.has(name)) odd("world", "labels", name, "(removed)");
  const fb = before.files ?? {}, fa = after.files ?? {};
  for (const [path, text] of Object.entries(fa)) if (fb[path] !== text) changed.push({ op: "write_file", path, text });
  for (const path of Object.keys(fb)) if (!(path in fa)) odd("world", "files", path, "(removed)");
  const { issues: _i, prs: _p, labels: _l, files: _f, ...restBefore } = before;
  const { issues: _i2, prs: _p2, labels: _l2, files: _f2, ...restAfter } = after;
  for (const k of new Set([...Object.keys(restBefore), ...Object.keys(restAfter)])) {
    if (!isDeepStrictEqual(restBefore[k], restAfter[k])) odd("world", k, restBefore[k], restAfter[k]);
  }
  return [...created, ...changed, ...unmodelled];
}

export function matchesReturn(line, returns) {
  return returns.some((r) => {
    const re = r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/<[^>]*>/g, ".+").replace(/#[NPM]\b/g, "#\\d+");
    return new RegExp(`^${re}$`).test(line);
  });
}

const head = (line) => line.match(/^#\d+\s+([A-Za-z][A-Za-z-]*)/)?.[1] ?? null;

// ---- pure skills: a utility skill returns a document, so a scenario compares it to the contract's shape ----

/** "Verdict: PASS | BLOCK | HOLD" -> { label: "Verdict", alts: ["PASS", "BLOCK", "HOLD"] }, or null when it has no label */
export function parseDocLine(line) {
  const i = line.indexOf(": ");
  if (i < 1) return null;
  return { label: line.slice(0, i), alts: line.slice(i + 2).split(" | ").map((a) => a.trim()).filter(Boolean) };
}

/** The part of a value or alternative that names it: "Unknown — no plan" -> "Unknown" */
export const docHead = (s) => String(s).split(" — ")[0].trim();

/** A value matches an alternative when it starts with the same word, or the alternative is a `<placeholder>` and the value is not empty. A list is a value, and matches only a placeholder. */
export function matchesAlt(value, alt) {
  const v = Array.isArray(value) ? (value.length ? "<list>" : "") : String(value ?? "").trim(); // a list is a value that has items
  if (!v) return false;
  const h = docHead(alt);
  return h.includes("<") ? true : docHead(v) === h;
}

/**
 * What the world already settles about a document, written as code from the skill's `ensures`. Each
 * returns problems, given the PR the skill was asked about, its inputs and the expected document.
 */
export const DOCUMENT_ORACLES = {
  "merge-safety": (world, inputs, doc) => {
    const out = [];
    const n = Number(String(inputs.pr ?? "").match(/\d+/)?.[0]);
    const pr = (world.prs ?? []).find((p) => p.number === n);
    const verdict = docHead(doc.Verdict ?? "");
    const none = docHead(doc["Blockers or next steps"] ?? "") === "None";
    if (verdict === "PASS" && !none) out.push("PASS must have no blockers or next steps");
    if (verdict !== "PASS" && none) out.push(`${verdict} must name at least one next step`);
    if (!pr) return out;
    const must = [];
    if (pr.draft) must.push("the PR is a draft");
    if (inputs.head !== undefined && inputs.head !== pr.head) must.push(`the pinned head ${inputs.head} is not the PR's head ${pr.head}`);
    if (checkState(pr) === "pending") must.push("a check is pending");
    if (must.length && verdict !== "HOLD") out.push(`the verdict must be HOLD, because ${must.join(" and ")}`);
    if (verdict === "PASS") {
      if (checkState(pr) !== "green") out.push(`PASS while the checks are ${checkState(pr)}`);
      if (pr.mergeState === "DIRTY") out.push("PASS while the PR has merge conflicts");
    }
    return out;
  },
  "unattended-triage": (world, inputs, doc) => {
    const out = [];
    const state = docHead(doc["Recommended state"] ?? "");
    const structure = { "ready-for-agent": "Agent Brief", "ready-for-human": "ready-for-human structure", "needs-info": "Triage Notes" }[state];
    if (structure && docHead(doc["Comment structure"] ?? "") !== structure) out.push(`${state} needs the ${structure}, not ${docHead(doc["Comment structure"] ?? "")}`);
    const n = Number(String(inputs.subject ?? "").match(/\d+/)?.[0]);
    const issue = (world.issues ?? []).find((i) => i.number === n);
    if (!issue) return out;
    if ((issue.openQuestions ?? 0) > 0 && state !== "needs-info") out.push(`the issue has ${issue.openQuestions} open question(s), so the state must be needs-info, not ${state}`);
    if (issue.kind === "feature" && issue.useCase === "missing" && state === "ready-for-agent") out.push("a feature with no stated use case is never ready-for-agent");
    if (issue.wontfix && state !== "ready-for-human") out.push(`a wontfix recommendation is ready-for-human, not ${state}`);
    return out;
  },
  // The scenario lists the subject's `decisions` ({id, open, needs, lookup}) and the ids the questions are about in `expect.asks`.
  "grill-via-github-comments": (world, inputs, doc, sc) => {
    const out = [];
    const ds = sc.decisions ?? [];
    const asks = sc.expect?.asks ?? [];
    const qs = Array.isArray(doc.Questions) ? doc.Questions : [];
    const byId = new Map(ds.map((d) => [d.id, d]));
    const settled = (id) => byId.get(id)?.open === false;
    const frontier = ds.filter((d) => d.open && !d.lookup && (d.needs ?? []).every(settled));
    if (qs.length !== asks.length) out.push(`${qs.length} question(s), but \`asks\` names ${asks.length} decision(s)`);
    for (const id of asks) {
      const d = byId.get(id);
      if (!d) { out.push(`asks about ${id}, which is not a decision of the subject`); continue; }
      if (!d.open) out.push(`asks about ${id}, which is already settled`);
      if (d.lookup) out.push(`asks about ${id}, which could be looked up`);
      for (const n of d.needs ?? []) if (!settled(n)) out.push(`asks about ${id} while ${n}, which it depends on, is still open`);
    }
    for (const d of frontier) if (!asks.includes(d.id)) out.push(`${d.id} is on the frontier but is not asked, so the round is not the whole frontier`);
    for (const [i, q] of qs.entries()) if (!/➡️\s*\S/.test(String(q))) out.push(`question ${i + 1} has no recommended answer`);
    const waiting = ds.filter((d) => d.open && !d.lookup && !asks.includes(d.id));
    if (waiting.length && docHead(doc["Waiting on those answers"] ?? "") === "None") out.push(`${waiting.map((d) => d.id).join(", ")} wait for these answers, but \`Waiting on those answers\` is None`);
    if (!waiting.length && docHead(doc["Waiting on those answers"] ?? "") !== "None") out.push("nothing waits, so `Waiting on those answers` must be None");
    const looked = ds.filter((d) => d.lookup);
    if (looked.length && docHead(doc.Findings ?? "") === "None") out.push(`${looked.map((d) => d.id).join(", ")} can be looked up, so the answer must be a finding`);
    if ((docHead(doc.Outcome ?? "") === "asked") !== (qs.length > 0)) out.push("the outcome is `asked` exactly when there are questions");
    return out;
  },
  // The world holds `labels` and `files`. The labels the run changes must be exactly what the setup block of
  // references/labels.md calls for, and the instructions file is edited only inside its `## GitHub workflow` section.
  "setup-github-agent-workflow": (world, inputs, doc, sc) => {
    const out = [];
    const work = sc.expect?.effects ?? [];
    const names = new Set(LABEL_CATALOG.map((c) => c.name));
    const want = syncLabels(world.labels ?? []);
    const got = work.filter((e) => e.op === "label_create" || e.op === "label_update");
    const same = (a, b) => a.op === b.op && a.name === b.name && (a.description ?? "") === (b.description ?? "");
    for (const w of want) if (!got.some((g) => same(g, w))) out.push(`does not ${w.op} \`${w.name}\`, which labels.md calls for`);
    for (const g of got) {
      if (want.some((w) => same(g, w))) continue;
      out.push(names.has(g.name) ? `${g.op} \`${g.name}\` is not what labels.md calls for, given the labels the repository has` : `${g.op} \`${g.name}\`, which labels.md does not declare`);
    }
    const files = world.files ?? {};
    const target = "CLAUDE.md" in files ? "CLAUDE.md" : "AGENTS.md";
    const writes = work.filter((e) => e.op === "write_file");
    for (const w of writes) if (w.path !== target) out.push(`writes ${w.path}, but the agent instructions file is ${target}`);
    if (writes.length > 1) out.push("writes the instructions file more than once");
    const split = (t) => {
      const lines = String(t ?? "").split("\n");
      const i = lines.findIndex((l) => /^## GitHub workflow\s*$/.test(l));
      if (i < 0) return { section: "", rest: lines.join("\n") };
      let j = lines.findIndex((l, k) => k > i && /^## /.test(l));
      if (j < 0) j = lines.length;
      return { section: lines.slice(i, j).join("\n"), rest: [...lines.slice(0, i), ...lines.slice(j)].join("\n") };
    };
    const norm = (t) => t.replace(/\n{2,}/g, "\n").trim();
    const w = writes.find((x) => x.path === target) ?? writes[0];
    if (w && norm(w.text ?? "") === norm(files[target] ?? "")) out.push(`writes ${w.path} unchanged`);
    if (w && norm(split(w.text).rest) !== norm(split(files[w.path]).rest)) out.push(`changes ${w.path} outside its \`## GitHub workflow\` section`);
    const final = split(w ? w.text : files[target]).section;
    const esc = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const k of SETTINGS) {
      if (inputs[k] === undefined) continue;
      if (!new RegExp(`^\\s*(?:[-*]\\s*)?${k}:\\s*${esc(inputs[k])}\\s*$`, "m").test(final)) out.push(`does not record ${k}: ${inputs[k]} in ${target}`);
    }
    if ((docHead(doc.Outcome ?? "") === "set up") !== (work.length > 0)) out.push("the outcome is `set up` exactly when the run changed something");
    if (docHead(doc["Settings file"] ?? "") !== (w?.path ?? "None")) out.push(`\`Settings file\` is ${docHead(doc["Settings file"] ?? "")}, but the run wrote ${w?.path ?? "no file"}`);
    return out;
  },
  // The world holds run-log issues (labelled agent:log) whose `entries` are {run, step, runner, at, outcome, problems}.
  // The scenario says what time it is (`now`) and which entries the report drew on (`expect.used`, by run id).
  retrospective: (world, inputs, doc, sc) => {
    const out = [];
    if (!sc.now || Number.isNaN(Date.parse(sc.now))) return ["the scenario needs a `now` date"];
    const now = Date.parse(sc.now);
    const days = Number(inputs.days ?? 14);
    const max = Number(inputs.max_suggestions ?? 10);
    const entries = (world.issues ?? []).filter((i) => (i.labels ?? []).includes("agent:log")).flatMap((i) => (i.entries ?? []).map((e) => ({ ...e, issue: i.number })));
    const why = (e) => {
      if (Date.parse(e.at) < now - days * 86400000) return `is older than ${days} days`;
      if (Date.parse(e.at) > now) return "is dated after now";
      if (inputs.step && e.step !== inputs.step) return `is a ${e.step} entry, and step=${inputs.step}`;
      if (inputs.only_runner && e.runner !== inputs.only_runner) return `is from ${e.runner}, and only_runner=${inputs.only_runner}`;
      if (e.outcome === "nothing eligible" && (e.problems ?? []).length === 0) return "is idle";
      return null;
    };
    const used = sc.expect?.used ?? [];
    for (const run of used) {
      const e = entries.find((x) => x.run === run);
      if (!e) out.push(`uses ${run}, which is not in the log`);
      else if (why(e)) out.push(`uses ${run}, which ${why(e)}`);
    }
    for (const e of entries) if (!why(e) && !used.includes(e.run)) out.push(`leaves out ${e.run}, which falls inside the scope`);
    const counted = String(doc["Entries considered"] ?? "").match(/^\s*(\d+)/)?.[1];
    if (counted === undefined || Number(counted) !== used.length) out.push(`\`Entries considered\` says ${counted ?? "nothing"}, but the report used ${used.length}`);
    if ((docHead(doc.Outcome ?? "") === "report") !== (used.length > 0)) out.push("the outcome is `report` exactly when there is an entry to consider");
    const suggestions = Array.isArray(doc["Ranked suggestions"]) ? doc["Ranked suggestions"] : [];
    if (suggestions.length > max) out.push(`${suggestions.length} ranked suggestions with max_suggestions=${max}`);
    for (const [i, t] of suggestions.entries()) if (!/Evidence:/.test(String(t))) out.push(`suggestion ${i + 1} has no evidence`);
    if (used.length === 0) for (const k of ["Ranked suggestions", "Recurring problems"]) if (docHead(doc[k] ?? "") !== "None") out.push(`an empty report has no ${k.toLowerCase()}`);
    const scope = String(doc.Scope ?? "");
    if (!scope.includes(String(days))) out.push("the scope does not say how many days it covers");
    for (const k of ["step", "only_runner"]) if (inputs[k] && !scope.includes(inputs[k])) out.push(`the scope does not say ${k}=${inputs[k]}`);
    return out;
  },
};

/** The same checks as checkScenario, for a skill that returns a document. */
export function checkPureScenario(contract, sc) {
  const out = [];
  const bad = (m) => out.push(m);
  const doc = sc.expect?.document;
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) { bad("no expected document"); return out; }
  const lines = (contract.returns ?? []).map((r) => [r, parseDocLine(r)]);
  for (const [r, l] of lines) if (!l) bad(`the contract's returns entry \`${r}\` is not \`Label: ...\``);
  const shape = lines.map(([, l]) => l).filter(Boolean);
  for (const l of shape) {
    if (!(l.label in doc)) bad(`the document has no \`${l.label}\``);
    else if (!l.alts.some((a) => matchesAlt(doc[l.label], a))) bad(`\`${l.label}: ${doc[l.label]}\` is none of: ${l.alts.join(" | ")}`);
  }
  for (const k of Object.keys(doc)) if (!shape.some((l) => l.label === k)) bad(`the document has \`${k}\`, which is not in the contract's returns`);

  const work = sc.expect.effects ?? [];
  const allowed = Object.keys(contract.effects?.writes ?? {});
  if (allowed.length === 0 && work.length) bad("a pure skill must leave no effects");
  for (const e of work.length && allowed.length ? work : []) {
    try {
      const f = forbiddenWrite(contract, e, { world: sc.world ?? { issues: [], prs: [] }, claimed: new Set() });
      if (f) bad(`${e.op} on ${e.target ?? `#${e.number}`} ${f.why}`);
    } catch (err) { bad(err.message); }
  }
  if (work.length) { try { applyEffects(sc.world ?? { issues: [], prs: [] }, work); } catch (err) { bad(err.message); } }
  const oracle = DOCUMENT_ORACLES[sc.skill];
  if (oracle) out.push(...oracle(sc.world ?? { issues: [], prs: [] }, sc.inputs ?? {}, doc, sc));
  return out;
}

// ---- group skills: which items are dispatched, in what order, and with which inputs ---------------------
// A group scenario has `inputs` (the run's), a `world`, and `expect`: `dispatches` ([{target, inputs, result}], in order),
// `results` (what the group returns), `log` ({results}, the one run-log entry) and, for a group that calls another skill
// first, `reconcile` ({inputs, results}). The batch is picked here, from the real item skill's oracle, and what must be
// forwarded is read from the real item skill's contract. Running the dispatched items is not checked: they have their own scenarios.

/** The inputs a dispatch must carry: `write_log=false`, and every input of this run that the callee lists in `params`. */
export function forwardedInputs(callee, runInputs = {}) {
  return { write_log: false, ...Object.fromEntries(Object.entries(runInputs).filter(([k]) => (callee.params ?? []).includes(k))) };
}

/**
 * `explore-github-repo` is a group skill whose candidates are findings, not items of the world: it ranks them
 * (`findings: [{title, score}]`, score = impact x confidence), calls `file-github-issues` once with all of them,
 * best first, and `limit` = its batch, and logs what was filed, commented, dropped and deferred.
 * `expect.dispatches` is that one call: `{inputs, candidates, results}`.
 */
function checkFindingsScenario(contract, sc, callee, calleeName) {
  const out = [];
  const bad = (m) => out.push(m);
  const E = sc.expect ?? {};
  const inputs = sc.inputs ?? {};
  const findings = sc.findings ?? [];
  const ranked = [...findings].sort((a, b) => b.score - a.score).map((f) => f.title);
  const batch = Number(inputs.explore_batch);
  if (!Number.isInteger(batch) || batch < 1) bad("the scenario must set `explore_batch` to a whole number of at least 1");
  const calls = E.dispatches ?? [];
  if (calls.length > 1) bad(`calls ${calleeName} ${calls.length} times, and the contract has it called once`);
  if (findings.length === 0 && calls.length) bad(`calls ${calleeName} with nothing found, so it invents work`);
  if (findings.length && calls.length === 0) bad(`found ${findings.length} candidate(s) and never calls ${calleeName}`);
  let counts = { filed: 0, commented: 0, dropped: 0 }, deferred = [];
  const [call] = calls;
  if (call) {
    if (!isDeepStrictEqual(call.candidates, ranked)) bad(`passes the candidates ${JSON.stringify(call.candidates)}, but best first is ${JSON.stringify(ranked)}`);
    const { run_id, ...given } = call.inputs ?? {};
    if (typeof run_id !== "string" || run_id === "") bad(`the call to ${calleeName} drops \`run_id\``);
    const want = { limit: batch, ...Object.fromEntries(Object.entries(inputs).filter(([k]) => (callee.params ?? []).includes(k))) };
    for (const k of Object.keys(want)) {
      if (!(k in given)) bad(`the call to ${calleeName} drops \`${k}\``);
      else if (!isDeepStrictEqual(given[k], want[k])) bad(`the call to ${calleeName} gives ${k}=${JSON.stringify(given[k])}, not ${JSON.stringify(want[k])}`);
    }
    for (const k of Object.keys(given)) if (!(k in want)) bad(`the call to ${calleeName} gives \`${k}\`, which it does not list or this run did not set`);
    const results = call.results ?? [];
    if (results.length !== ranked.length) bad(`${results.length} result line(s) for ${ranked.length} candidate(s): one each, in input order`);
    let used = 0;
    for (const [i, r] of results.entries()) {
      if (!matchesReturn(r, callee.returns)) { bad(`\`${r}\` is not one of ${calleeName}'s returns`); continue; }
      const title = ranked[i];
      if (/^filed #/.test(r)) { counts.filed++; used++; if (inputs.dry_run === true) bad("files an issue with dry_run=true"); }
      else if (/^would-file:/.test(r)) { used++; if (inputs.dry_run !== true) bad("`would-file` without dry_run=true"); }
      else if (/^duplicate of #\d+ \(commented\)$/.test(r)) counts.commented++;
      else if (/^dropped:/.test(r)) counts.dropped++;
      else if (r === "deferred: over limit") { deferred.push(title); if (used < batch) bad(`defers \`${title}\` before the limit of ${batch} is reached`); }
      if (r !== "deferred: over limit" && deferred.length) bad(`gives \`${r}\` after deferring a candidate: everything after the limit is deferred`);
    }
    if (used > batch) bad(`${used} candidates filed (or would-file) with a limit of ${batch}`);
  }
  const line = `${counts.filed} filed, ${counts.commented} commented, ${counts.dropped} dropped`;
  if (E.result !== line) bad(`returns \`${E.result}\`, but the results count \`${line}\``);
  const logged = E.log?.deferred;
  if (!Array.isArray(logged)) bad("no expected run-log entry (`log: {deferred: [...]}`)");
  else if (!isDeepStrictEqual(logged, deferred.slice(0, 20))) bad(`the log defers ${JSON.stringify(logged)}, but ${JSON.stringify(deferred.slice(0, 20))} were deferred (at most 20)`);
  if ((E.effects ?? []).length) bad("a group skill does no item work, so it has no effects of its own besides its log entry");
  return out;
}

export function checkGroupScenario(contract, sc) {
  const out = [];
  const bad = (m) => out.push(m);
  const E = sc.expect ?? {};
  const world = sc.world ?? { issues: [], prs: [] };
  const inputs = sc.inputs ?? {};
  const itemName = contract.dispatches;
  const item_ = contractOf(itemName);
  if (!item_) { bad(`dispatches ${itemName}, which has no contract`); return out; }
  const compare = (what, given, want, callee) => {
    for (const k of Object.keys(want)) {
      if (!(k in given)) bad(`${what} drops \`${k}\``);
      else if (!isDeepStrictEqual(given[k], want[k])) bad(`${what} gives ${k}=${JSON.stringify(given[k])}, not ${JSON.stringify(want[k])}`);
    }
    for (const k of Object.keys(given)) if (!(k in want)) bad(`${what} gives \`${k}\`, which ${callee} does not list or this run did not set`);
  };

  // selection: the item skill's `requires`, oldest first, the first `batch` that pass
  const kind = (item_.params ?? []).includes("pr") ? "pr" : "issue";
  const batchKey = (contract.params ?? []).find((k) => k.endsWith("_batch"));
  const batch = Number(inputs[batchKey]);
  if (!Number.isInteger(batch) || batch < 1) bad(`the scenario must set \`${batchKey}\` to a whole number of at least 1`);
  const list = (kind === "pr" ? world.prs : world.issues) ?? [];
  const dated = list.every((i) => i.createdAt !== undefined);
  const oldestFirst = [...list].sort((a, b) => (dated ? Date.parse(a.createdAt) - Date.parse(b.createdAt) : a.number - b.number));
  const oracle = ORACLES[itemName];
  if (!oracle) return checkFindingsScenario(contract, sc, item_, itemName); // candidates are findings, not items of the world
  const fwd = forwardedInputs(item_, inputs);
  const eligible = oldestFirst.map((i) => `${kind}#${i.number}`).filter((t) => oracle(world, t, fwd).eligible);
  const want = Number.isInteger(batch) && batch >= 1 ? eligible.slice(0, batch) : [];
  const dispatches = E.dispatches ?? [];
  const got = dispatches.map((d) => d.target);
  for (const t of got) {
    if (!item(world, t)) bad(`dispatches ${t}, which is not in the world`);
    else if (!eligible.includes(t)) bad(`dispatches ${t}, which is not eligible (${oracle(world, t, fwd).reason})`);
    else if (!want.includes(t)) bad(`dispatches ${t}, which is past the batch of ${batch}`);
  }
  for (const t of want) if (!got.includes(t)) bad(`does not dispatch ${t}, which is eligible and within the batch of ${batch}`);
  if (got.length === want.length && got.every((t) => want.includes(t)) && got.some((t, i) => t !== want[i])) bad(`dispatches in the wrong order: oldest first is ${want.join(", ")}`);

  // forwarding and results
  if ("lease_held" in inputs) bad("a group skill holds no lease, so its run cannot be given lease_held");
  for (const d of dispatches) {
    if ("lease_held" in (d.inputs ?? {})) bad(`the dispatch of ${d.target} passes lease_held: a group skill holds no lease and never passes it`);
    compare(`the dispatch of ${d.target}`, d.inputs ?? {}, fwd, itemName);
    const n = String(d.target).match(/#(\d+)$/)?.[1];
    if (typeof d.result !== "string" || !d.result.startsWith(`#${n} `) || !matchesReturn(d.result, item_.returns)) bad(`${d.target}'s result \`${d.result}\` is not one of ${itemName}'s returns`);
  }
  const itemResults = dispatches.map((d) => d.result);
  const expectResults = itemResults.length ? itemResults : ["nothing eligible"];
  if (!isDeepStrictEqual(E.results, expectResults)) bad(`returns ${JSON.stringify(E.results)}, but the dispatched items gave ${JSON.stringify(expectResults)}`);

  // the skill the group calls first
  const called = (contract.calls ?? [])[0];
  let reconciled = [];
  if (called) {
    const callee = contractOf(called);
    const r = E.reconcile;
    if (!r) bad(`must call ${called} first, and the scenario has no \`reconcile\``);
    else {
      compare(`the call to ${called}`, r.inputs ?? {}, forwardedInputs(callee, inputs), called);
      reconciled = r.results ?? [];
      for (const l of reconciled) if (!matchesReturn(l, callee.returns)) bad(`\`${l}\` is not one of ${called}'s returns`);
    }
  } else if (E.reconcile) bad("this group skill calls no other skill, so it has no `reconcile`");

  // the one run-log entry
  const entry = E.log?.results;
  if (!Array.isArray(entry)) bad("no expected run-log entry (`log: {results: [...]}`)");
  else {
    const all = [...reconciled, ...itemResults];
    const wantLog = all.length ? all : ["nothing eligible"];
    if (!isDeepStrictEqual([...entry].sort(), [...wantLog].sort())) bad(`the log entry lists ${JSON.stringify(entry)}, but ${JSON.stringify(wantLog)} happened`);
    else if (!isDeepStrictEqual(entry.filter((l) => itemResults.includes(l)), itemResults)) bad("the log entry lists the dispatched results out of order");
  }
  if ((E.effects ?? []).length) bad("a group skill does no item work, so it has no effects of its own besides its log entry");
  return out;
}

/**
 * The same skill's eligibility oracle, asked about the same item in the world a run leaves behind: could a
 * scheduler pick the item up again? A run that completes released its lease. A run that was `interrupted`
 * died holding it, and the lease has run out by the time the skill is called again, so it is `stale`.
 * A push by the run puts the PR's checks back to pending.
 * @returns {{eligible: boolean, reason?: string} | null} null when the skill has no oracle or the scenario has no item
 */
export function rerunEligibility(sc, after) {
  const oracle = ORACLES[sc.skill];
  if (!oracle || !sc.target) return null;
  const w = structuredClone(after);
  const t = item(w, sc.target);
  // A push restarts CI and GitHub recomputes mergeability, so the PR is not eligible again until they report.
  if (t && (sc.expect?.effects ?? []).some((e) => e.op === "push" && e.target === sc.target)) { t.checks = ["pending"]; t.mergeState = "UNKNOWN"; }
  if (sc.interrupted && t && LEASE_LABELS.some((l) => (t.labels ?? []).includes(l))) t.lease = "stale";
  const { lease_held: _held, ...fresh } = sc.inputs ?? {}; // a rerun is a fresh call: nobody lends it a lease
  return oracle(w, sc.target, fresh);
}

/**
 * @param {object} contract the parsed contract of the skill
 * @param {object} sc       the scenario
 * @returns {string[]} problems, empty when the scenario is consistent with the contract
 */
export function checkScenario(contract, sc) {
  sc = expandScenario(sc);
  if (contract.kind === "group") return checkGroupScenario(contract, sc);
  if (contract.kind === "utility") return checkPureScenario(contract, sc);
  const out = [];
  const bad = (m) => out.push(m);
  const world = sc.world ?? { issues: [], prs: [] };
  const results = sc.expect.results ?? (sc.expect.result ? [sc.expect.result] : []);
  const work = sc.expect.effects ?? [];
  const isItem = contract.kind === "item" && contract.target?.param;
  const claimed = new Set(isItem && sc.target ? [sc.target] : []);
  const leaseHeld = sc.inputs?.lease_held === true;
  // a call is a skill name, or {skill, target, inputs} when the inputs matter (lease_held)
  const calls = (sc.expect.calls ?? []).map((c) => (typeof c === "string" ? { skill: c } : c));

  // 1. results
  const interrupted = sc.interrupted === true; // the pass died partway, so it returned nothing
  if (interrupted && results.length) bad("an interrupted run returned no result, so it has none to expect");
  if (results.length === 0 && !interrupted) bad("no expected result");
  for (const r of results) {
    const line = r.replace(/^would: /, "");
    if (!matchesReturn(r, contract.returns) && !matchesReturn(line, contract.returns)) bad(`result \`${r}\` is not in the contract's returns`);
    if (isItem && !line.startsWith(`#${ref(sc.target).n} `)) bad(`result \`${r}\` is not about ${sc.target}`);
  }
  const outcome = isItem && results[0] ? head(results[0]) : null;

  // effects, with the claim's lease marker made explicit unless the run was skipped or borrowed a lease
  const effects = [...work];
  if (isItem && outcome !== "skipped" && !leaseHeld) effects.unshift({ op: "comment", target: sc.target, marker: "agent:lease" });
  const ctx = { world, claimed };

  // 2. scopes
  for (const e of work) {
    let f;
    try { f = forbiddenWrite(contract, e, ctx); } catch (err) { bad(err.message); continue; }
    if (!f) continue;
    if (e.op === "unmodelled") bad(`the run changed \`${e.field}\` of ${e.target}, which the checker cannot model, and the contract lists no \`unmodelled\` write`);
    else bad(`${e.op} on ${e.target ?? `#${e.number}`} ${f.why}`);
  }
  if (outcome === "skipped" && work.length) bad("skipped must leave no effects");
  if (outcome === "noop" && work.length) bad("noop may leave only the lease comment");

  // 3. the world after
  let after;
  try { after = applyEffects(world, effects); } catch (err) { bad(err.message); return out; }
  for (const i of after.issues) {
    if (i.lease === "live") continue; // another step holds it, and the sweeper must not repair it (labels.md, Repair)
    const n = MUTEX_ISSUE.filter((l) => (i.labels ?? []).includes(l));
    if (n.length > 1) bad(`issue #${i.number} ends with ${n.join(" and ")}`);
  }
  for (const p of after.prs) {
    const n = MUTEX_PR.filter((l) => (p.labels ?? []).includes(l));
    if (n.length > 1) bad(`PR #${p.number} ends with ${n.join(" and ")}`);
  }
  const lanes = after.prs.filter((p) => p.state === "open" && (p.labels ?? []).includes("agent:ready-for-review"));
  if (lanes.length > 1) bad(`${lanes.length} PRs hold the merge lane: ${lanes.map((p) => `#${p.number}`).join(", ")}`);
  if (isItem && !leaseHeld && outcome !== "skipped" && !interrupted) { // a skipped item's lease label, if any, belongs to the run that holds it
    const t = item(after, sc.target);
    for (const l of LEASE_LABELS) if ((t.labels ?? []).includes(l)) bad(`${sc.target} still carries the lease label ${l}`);
  }
  for (const e of work) {
    if (e.op === "close") {
      const t = item(world, e.target);
      if (t?.keepOpen) bad(`closes ${e.target}, which is keep-open`);
      if (t && ref(e.target).kind === "issue" && hasTrustedMarker(t, "agent:split")) { // references/split.md, When the sub-issues close
        const kids = childrenOf(world, t.number);
        if (kids.length === 0) bad(`closes ${e.target}, a split issue whose sub-issues cannot be read`);
        const open = kids.filter((c) => c.state === "open");
        if (open.length) bad(`closes ${e.target}, a split issue, while sub-issue ${open.map((c) => `#${c.number}`).join(", ")} is open`);
        const dropped = kids.filter((c) => c.closeReason === "not planned");
        if (dropped.length) bad(`closes ${e.target}, a split issue, although sub-issue ${dropped.map((c) => `#${c.number}`).join(", ")} was closed as not planned`);
      }
    }
  }

  // splitting an issue that is too large (references/split.md)
  const maxDepth = sc.inputs?.max_depth ?? 1;
  const made = work.filter((e) => e.op === "create_issue");
  const targetN = isItem && sc.target ? ref(sc.target).n : null;
  for (const e of made) {
    if (e.data?.parent === undefined) continue;
    const d = worldDepth(after, e.number);
    if (d === null) bad(`sub-issue #${e.number} has a depth that cannot be read`);
    else if (!canSplit(d - 1, maxDepth)) bad(`sub-issue #${e.number} is ${d} deep, past max_depth=${maxDepth}`);
    if (isItem && e.data.parent !== targetN) bad(`sub-issue #${e.number} is linked to #${e.data.parent}, not to ${sc.target}, the issue this run split`);
  }
  if (sc.skill === "implement-github-issue" && isItem) {
    const depth = worldDepth(world, targetN);
    const may = canSplit(depth, maxDepth);
    if (outcome === "split") {
      const listed = [...results[0].matchAll(/#(\d+)/g)].map((m) => Number(m[1])).slice(1);
      const sorted = (a) => [...a].sort((x, y) => x - y);
      if (listed.length < 2) bad("a split makes two or more sub-issues");
      if (!isDeepStrictEqual(sorted(made.map((e) => e.number)), sorted(listed))) bad(`the result names ${JSON.stringify(listed)}, but the run created ${JSON.stringify(made.map((e) => e.number))}`);
      for (const e of made) {
        if ((e.labels ?? []).length) bad(`sub-issue #${e.number} is filed with labels: ${e.labels.join(", ")}. Triaging picks up an issue with none`);
        if (e.data?.parent !== targetN) bad(`sub-issue #${e.number} is not linked to ${sc.target} (\`data.parent\`)`);
      }
      const mark = work.find((e) => e.op === "comment" && e.target === sc.target && e.marker === "agent:split");
      if (!mark) bad("a split without an `agent:split` comment on the issue");
      else {
        const kids = (mark.text ?? "").match(/children=([0-9,]+)/)?.[1];
        if (kids === undefined || !isDeepStrictEqual(sorted(kids.split(",").map(Number)), sorted(listed))) bad(`the \`agent:split\` comment names ${kids ?? "no children"}, not ${listed.join(",")}`);
      }
      if (work.some((e) => e.op === "label_add" && e.target === sc.target && e.label === "agent:pr-open")) bad("a split issue does not gain agent:pr-open: no PR is open");
      if (work.some((e) => e.op === "label_remove" && e.target === sc.target && e.label === "ready-for-agent")) bad("a split issue keeps ready-for-agent");
      if (work.some((e) => e.op === "create_pr" || e.op === "push")) bad("a split opens no PR and pushes no branch");
      if (!may) bad(`splits ${sc.target}, which is ${depth === null ? "of a depth that cannot be read" : `${depth} deep`} with max_depth=${maxDepth}: only an issue with fewer ancestors than max_depth splits`);
    } else if (made.length) bad(`creates issues but the result is \`${results[0]}\`, not a split`);
  }
  if (sc.skill === "file-github-issues" && sc.inputs?.parent !== undefined) {
    const P = Number(sc.inputs.parent);
    if (results.some((r) => r === `duplicate of #${P} (commented)`)) bad(`reports a slice as a duplicate of #${P}, the parent it is a slice of`);
    for (const e of made) if (!String(e.data?.body ?? "").startsWith(`Part of #${P}.`)) bad(`issue #${e.number} does not start with \`Part of #${P}.\``);
  }

  // merge rules (review-github-pr)
  for (const e of work.filter((x) => x.op === "merge")) {
    const pr = item(world, e.target);
    if (e.sha !== pr.head) bad(`merges ${e.target} at ${e.sha}, but the pinned head is ${pr.head}`);
    if (work.some((x) => x.op === "push" && x.target === e.target)) bad(`merges ${e.target} in the run that pushed to it`);
    if (pr.fork || pr.draft) bad(`merges ${e.target}, which is a ${pr.fork ? "fork" : "draft"}`);
    for (const l of ["agent:stuck", "agent:human-merge"]) if ((pr.labels ?? []).includes(l)) bad(`merges ${e.target}, which carries ${l}`);
    const prot = sc.inputs?.human_merge_paths ?? [];
    const hit = (pr.files ?? []).find((f) => prot.some((p) => f.startsWith(p)));
    if (hit) bad(`merges ${e.target}, which changes the protected path ${hit}`);
  }

  // 4. oracles
  const oracle = ORACLES[sc.skill];
  if (oracle && isItem) {
    // a `noop` is a PR that was eligible when read and not after the claim, so the oracle reads the earlier world
    const o = oracle(sc.eligibility_world ?? world, sc.target, sc.inputs ?? {});
    if (!o.eligible && outcome !== "skipped") bad(`the oracle says ${sc.target} is not eligible (${o.reason}), but the result is \`${results[0]}\``);
    if (o.eligible && outcome === "skipped") bad(`the oracle says ${sc.target} is eligible, but the result is \`${results[0]}\``);
  }
  if (sc.skill === "shepherd-github-pr" && isItem) {
    const added = work.some((e) => e.op === "label_add" && e.label === "agent:ready-for-review");
    const p = item(after, sc.target);
    if (added && !(checkState(p) === "green" && !["DIRTY", "BEHIND", "UNKNOWN"].includes(p.mergeState) && (p.openFindings ?? 0) === 0)) {
      bad("hands off with agent:ready-for-review while the PR is not green, current and free of findings");
    }
    if (added !== (outcome === "ready-for-review")) bad("`ready-for-review` and the label swap must go together");
  }
  // escalation and failure have fixed shapes (references/escalate.md, fail_item in lib.sh)
  if (isItem && outcome === "escalated") {
    if (!work.some((e) => e.op === "comment" && e.target === sc.target && e.marker === "agent:escalate")) bad("escalates without an `agent:escalate` comment on the item");
    if (!work.some((e) => e.op === "label_add" && e.target === sc.target && e.label === "agent:stuck")) bad("escalates without adding agent:stuck");
  }
  if (isItem && outcome === "failed") {
    if (!work.some((e) => e.op === "comment" && e.target === sc.target && e.marker === "agent:failure")) bad("fails without an `agent:failure` comment on the item");
    if (work.some((e) => (e.op === "label_add" || e.op === "label_remove") && e.target === sc.target)) bad("a failed run must leave the item's labels as they were");
  }

  // dry runs write nothing
  const dry = sc.inputs?.dry_run === true || results.some((r) => r.startsWith("would: "));
  if (dry && work.length) bad("a dry run must leave no effects");
  if (sc.inputs?.dry_run === true && sc.skill !== "file-github-issues" && results.some((r) => r !== "nothing to do" && !r.startsWith("would: "))) {
    bad("with dry_run=true every result line starts with `would: `");
  }

  // limit (file-github-issues): at most `limit` filed, and nothing is deferred before the limit is reached
  if (sc.inputs?.limit !== undefined) {
    const filed = results.filter((r) => /^(filed #|would-file: )/.test(r)).length;
    const deferred = results.filter((r) => r.startsWith("deferred: ")).length;
    if (filed > sc.inputs.limit) bad(`files ${filed} candidates with limit=${sc.inputs.limit}`);
    if (deferred && filed < sc.inputs.limit) bad("defers candidates before the limit was reached");
  }

  // skills called must be in the contract's `calls`
  for (const c of calls) if (!(contract.calls ?? []).includes(c.skill)) bad(`calls \`${c.skill}\`, which is not in the contract's calls`);

  // lease_held=true lends the caller's lease to a nested call (**Nested calls** in the protocol). Only a skill that holds
  // the lease on an item may pass it, only for that item, and only to an item skill that lists `lease_held`.
  for (const c of calls) {
    if (String(c.inputs?.lease_held) !== "true") continue;
    const callee = contractOf(c.skill);
    if (!isItem) bad(`passes lease_held=true to ${c.skill}, but this skill holds no lease`);
    else {
      if (outcome === "skipped") bad(`passes lease_held=true to ${c.skill}, but a skipped run claimed nothing, so it holds no lease`);
      if (c.target === undefined) bad(`passes lease_held=true to ${c.skill} without saying which item the call is about`);
      else if (c.target !== sc.target) bad(`passes lease_held=true to ${c.skill} for ${c.target}, but holds the lease on ${sc.target} only`);
      if (!callee || callee.kind !== "item" || !(callee.params ?? []).includes("lease_held")) bad(`passes lease_held=true to ${c.skill}, which is not an item skill that lists \`lease_held\``);
    }
  }

  // triage-github-issue: a prior trusted outcome that stands is reused, so unattended-triage is not called for it
  if (sc.skill === "triage-github-issue" && sc.target) {
    const t = item(world, sc.target);
    const cs = t.comments ?? [];
    const i = cs.findLastIndex((c) => c.marker === "agent:outcome" && c.trusted);
    const stands = i !== -1 && !cs.slice(i + 1).some((c) => c.author === "human");
    if (stands && calls.some((c) => c.skill === "unattended-triage")) bad("calls unattended-triage although a prior trusted outcome still stands");
  }

  // 5. rerun: asked again, the skill must find nothing to redo (`idempotent` in the contract)
  const rerun = sc.expect.rerun;
  if (interrupted && rerun !== "eligible") bad("a pass that stopped partway must be safe to repeat: `rerun: eligible`");
  if (rerun !== undefined) {
    const skip = rerun && typeof rerun === "object" ? rerun.skip : undefined;
    if (skip !== undefined) { if (typeof skip !== "string" || skip.trim() === "") bad("`rerun: {skip: ...}` needs the reason"); }
    else if (rerun !== "eligible" && rerun !== "ineligible") bad("`rerun` is `eligible`, `ineligible` or `{skip: <reason>}`");
    else if (!isItem) bad("`rerun` is about the item a skill works on, and this skill has none");
    else {
      const o = rerunEligibility(sc, after);
      if (!o) bad("`rerun` needs an eligibility oracle, and this skill has none");
      else if ((rerun === "eligible") !== o.eligible) bad(`rerun is \`${rerun}\`, but the oracle says ${sc.target} is ${o.eligible ? "eligible" : `not eligible (${o.reason})`} in the world this run leaves behind`);
    }
  }
  if (sc.expect.rerun_effects !== undefined) {
    const again = sc.expect.rerun_effects;
    const key = (e) => JSON.stringify([e.op, e.target, e.label, e.marker, e.text]);
    const made = new Set(work.map(key));
    for (const e of again) {
      if (e.marker !== "agent:lease" && made.has(key(e))) bad(`the rerun repeats ${e.op} on ${e.target}, which the interrupted run already did`);
      try {
        const f = forbiddenWrite(contract, e, { world: after, claimed });
        if (f) bad(`the rerun's ${e.op} on ${e.target} ${f.why}`);
      } catch (err) { bad(err.message); }
    }
    try { applyEffects(after, again); } catch (err) { bad(`the rerun's effects do not apply: ${err.message}`); }
  }
  return out;
}

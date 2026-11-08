// Checks a scenario against a skill's contract. Pure functions, no GitHub and no model.
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

export const MUTEX_ISSUE = ["needs-info", "ready-for-agent", "ready-for-human", "agent:pr-open"];
export const MUTEX_PR = ["agent:needs-work", "agent:ready-for-review", "agent:human-merge"];
export const LEASE_LABELS = ["agent:triage", "agent:in-progress"];
const REPOSITORY_OPS = ["push", "merge", "delete_branch", "create_pr"];
// `unmodelled` is not something a skill does: diffWorlds reports a change it cannot express with it.
const OPS = ["label_add", "label_remove", "comment", "close", "push", "merge", "delete_branch", "create_pr", "create_issue", "review_request", "unmodelled"];

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

/** How many `requires` entries each oracle mirrors. A test fails when a skill's count differs. */
export const ORACLE_REQUIRES = {
  "triage-github-issue": 3,
  "implement-github-issue": 2,
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
  if (effect.op === "comment") {
    const t = item(ctx.world, effect.target);
    if (t && (t.labels ?? []).includes("agent:log")) return "shared";
  }
  if (ctx.claimed.has(effect.target) && effect.op !== "create_issue") return "claimed";
  return "other";
}

/** The item that a `create_pr` or `create_issue` effect adds to the world `w`. */
export function createdItem(w, e) {
  if (e.op === "create_pr") return { number: e.number, state: "open", labels: e.labels ?? [], draft: false, head: e.sha ?? "new", base: e.base ?? w.default_branch ?? "main", checks: [], openFindings: 0, closes: e.closes ?? [], comments: [] };
  return { number: e.number, state: "open", labels: e.labels ?? [], comments: [] };
}

/** Apply effects to a copy of the world. Throws when an effect is impossible. */
export function applyEffects(world, effects) {
  const w = structuredClone(world);
  w.issues ??= []; w.prs ??= [];
  for (const e of effects) {
    if (!OPS.includes(e.op)) throw new Error(`unknown effect op \`${e.op}\``);
    if (e.op === "create_pr") { w.prs.push(createdItem(w, e)); continue; }
    if (e.op === "create_issue") { w.issues.push(createdItem(w, e)); continue; }
    if (e.op === "unmodelled") continue; // a change the checker cannot express: scope-checked, never applied
    const t = item(w, e.target);
    if (!t) throw new Error(`effect ${e.op} targets ${e.target}, which is not in the world`);
    t.labels ??= []; t.comments ??= [];
    switch (e.op) {
      case "label_add": if (!t.labels.includes(e.label)) t.labels.push(e.label); break;
      case "label_remove":
        if (!t.labels.includes(e.label)) throw new Error(`removes \`${e.label}\` from ${e.target}, which does not carry it`);
        t.labels = t.labels.filter((l) => l !== e.label); break;
      case "comment": t.comments.push({ marker: e.marker, text: e.text }); break;
      case "close": t.state = "closed"; break;
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
  return {
    ...rest,
    issues: issues.map(item("issue")).sort((a, b) => a.number - b.number),
    prs: prs.map(item("pr")).sort((a, b) => a.number - b.number),
  };
}

/** True when two worlds are the same world by `canonicalWorld`. */
export const sameWorld = (a, b) => isDeepStrictEqual(canonicalWorld(a), canonicalWorld(b));

const MODELLED = { issue: ["number", "labels", "comments", "state"], pr: ["number", "labels", "comments", "state", "head", "pushed", "branchDeleted"] };
const defined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/**
 * The net effects that turn `before` into `after`, in the ops `applyEffects` accepts, so that
 * `sameWorld(applyEffects(before, diffWorlds(before, after)), after)` holds whenever the result has no
 * `unmodelled` effect. A label added and removed in one run does not appear. The lease label and the
 * `agent:lease` comment are ordinary effects here: the checker adds a claim's marker to a scenario's
 * effects itself, so a caller that passes a diff to `checkScenario` leaves that comment out of it.
 *
 * Anything that no op can express (a changed title, body, checks or base; an edited or removed comment;
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
    if (bc.length > ac.length || bc.some((c, i) => !same(c, ac[i]))) odd(target, "comments", bc, ac);
    else for (const c of ac.slice(bc.length)) out.push({ op: "comment", target, ...defined({ marker: c.marker, text: c.text }) });

    if (a.state !== b.state) {
      const open = b.state === "open" || b.state === undefined;
      if (open && a.state === "closed") out.push({ op: "close", target });
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
      const e = kind === "pr"
        ? { op: "create_pr", number: n, labels: [...new Set(a.labels ?? [])], ...defined({ sha: typeof a.head === "string" ? a.head : undefined, base: a.base }), closes: a.closes ?? [] }
        : { op: "create_issue", number: n, labels: [...new Set(a.labels ?? [])] };
      created.push(e);
      const stub = applyEffects({ issues: [], prs: [], default_branch: before.default_branch }, [e]);
      diffItem(kind, (kind === "pr" ? stub.prs : stub.issues)[0], a);
    }
  }

  const { issues: _i, prs: _p, ...restBefore } = before;
  const { issues: _i2, prs: _p2, ...restAfter } = after;
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
      const scope = scopeOf(e, { world: sc.world ?? { issues: [], prs: [] }, claimed: new Set() });
      if (!allowed.includes(scope)) bad(`${e.op} on ${e.target ?? `#${e.number}`} is a \`${scope}\` write, which the contract does not allow`);
    } catch (err) { bad(err.message); }
  }
  const oracle = DOCUMENT_ORACLES[sc.skill];
  if (oracle) out.push(...oracle(sc.world ?? { issues: [], prs: [] }, sc.inputs ?? {}, doc, sc));
  return out;
}

/**
 * @param {object} contract the parsed contract of the skill
 * @param {object} sc       the scenario
 * @returns {string[]} problems, empty when the scenario is consistent with the contract
 */
export function checkScenario(contract, sc) {
  if (contract.kind === "utility") return checkPureScenario(contract, sc);
  const out = [];
  const bad = (m) => out.push(m);
  const world = sc.world ?? { issues: [], prs: [] };
  const results = sc.expect.results ?? (sc.expect.result ? [sc.expect.result] : []);
  const work = sc.expect.effects ?? [];
  const isItem = contract.kind === "item" && contract.target?.param;
  const claimed = new Set(isItem && sc.target ? [sc.target] : []);
  const leaseHeld = sc.inputs?.lease_held === true;

  // 1. results
  if (results.length === 0) bad("no expected result");
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
  const allowed = Object.keys(contract.effects?.writes ?? {});
  for (const e of work) {
    let scope;
    try { scope = scopeOf(e, ctx); } catch (err) { bad(err.message); continue; }
    if (allowed.includes(scope)) continue;
    if (e.op === "unmodelled") bad(`the run changed \`${e.field}\` of ${e.target}, which the checker cannot model, and the contract lists no \`unmodelled\` write`);
    else bad(`${e.op} on ${e.target ?? `#${e.number}`} is a \`${scope}\` write, which the contract does not allow`);
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
  if (isItem && !leaseHeld && outcome !== "skipped") { // a skipped item's lease label, if any, belongs to the run that holds it
    const t = item(after, sc.target);
    for (const l of LEASE_LABELS) if ((t.labels ?? []).includes(l)) bad(`${sc.target} still carries the lease label ${l}`);
  }
  for (const e of work) {
    if (e.op === "close") {
      const t = item(world, e.target);
      if (t?.keepOpen) bad(`closes ${e.target}, which is keep-open`);
    }
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
  for (const c of sc.expect.calls ?? []) if (!(contract.calls ?? []).includes(c)) bad(`calls \`${c}\`, which is not in the contract's calls`);

  // triage-github-issue: a prior trusted outcome that stands is reused, so unattended-triage is not called for it
  if (sc.skill === "triage-github-issue" && sc.target) {
    const t = item(world, sc.target);
    const cs = t.comments ?? [];
    const i = cs.findLastIndex((c) => c.marker === "agent:outcome" && c.trusted);
    const stands = i !== -1 && !cs.slice(i + 1).some((c) => c.author === "human");
    if (stands && (sc.expect.calls ?? []).includes("unattended-triage")) bad("calls unattended-triage although a prior trusted outcome still stands");
  }
  return out;
}

// Checks a scenario against a skill's contract. Pure functions, no GitHub and no model.
//
// A scenario says: this skill, these inputs, this world. The expected result is one line, and the
// expected effects are the net changes the run leaves behind. The checker then asks four things:
//   1. Is the result one of the contract's `returns`?
//   2. Is every effect in a scope the contract's `effects.writes` allows?
//   3. Do the invariants hold in the world after the effects (one state label, lease released, ...)?
//   4. Do the executable eligibility oracles agree with the result?
//
// It does not run a skill. A real run is checked the same way: diff the world before and after,
// turn the diff into effects, and pass the result line. See docs/adr/0012-scenarios.md.

export const MUTEX_ISSUE = ["needs-info", "ready-for-agent", "ready-for-human", "agent:pr-open"];
export const MUTEX_PR = ["agent:needs-work", "agent:ready-for-review", "agent:human-merge"];
export const LEASE_LABELS = ["agent:triage", "agent:in-progress"];
const REPOSITORY_OPS = ["push", "merge", "delete_branch", "create_pr"];
const OPS = ["label_add", "label_remove", "comment", "close", "push", "merge", "delete_branch", "create_pr", "create_issue", "review_request"];

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

export const ORACLES = {
  /** Mirrors the `requires` of shepherd-github-pr. Returns { eligible, reason }. */
  "shepherd-github-pr"(world, target) {
    const pr = item(world, target);
    const L = pr.labels ?? [];
    if (pr.state !== "open" || !L.includes("agent:needs-work") || L.includes("agent:stuck") || L.includes("agent:human-merge")) {
      return { eligible: false, reason: "not an open agent:needs-work PR" };
    }
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
  if (REPOSITORY_OPS.includes(effect.op)) return "repository";
  if (effect.op === "comment") {
    const t = item(ctx.world, effect.target);
    if (t && (t.labels ?? []).includes("agent:log")) return "shared";
  }
  if (ctx.claimed.has(effect.target) && effect.op !== "create_issue") return "claimed";
  return "other";
}

/** Apply effects to a copy of the world. Throws when an effect is impossible. */
export function applyEffects(world, effects) {
  const w = structuredClone(world);
  w.issues ??= []; w.prs ??= [];
  for (const e of effects) {
    if (!OPS.includes(e.op)) throw new Error(`unknown effect op \`${e.op}\``);
    if (e.op === "create_pr") { w.prs.push({ number: e.number, state: "open", labels: e.labels ?? [], draft: false, head: e.sha ?? "new", base: e.base ?? w.default_branch ?? "main", checks: [], openFindings: 0, closes: e.closes ?? [], comments: [] }); continue; }
    if (e.op === "create_issue") { w.issues.push({ number: e.number, state: "open", labels: e.labels ?? [], comments: [] }); continue; }
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

export function matchesReturn(line, returns) {
  return returns.some((r) => {
    const re = r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/<[^>]*>/g, ".+").replace(/#[NPM]\b/g, "#\\d+");
    return new RegExp(`^${re}$`).test(line);
  });
}

const head = (line) => line.match(/^#\d+\s+([A-Za-z][A-Za-z-]*)/)?.[1] ?? null;

/**
 * @param {object} contract the parsed contract of the skill
 * @param {object} sc       the scenario
 * @returns {string[]} problems, empty when the scenario is consistent with the contract
 */
export function checkScenario(contract, sc) {
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
    if (!allowed.includes(scope)) bad(`${e.op} on ${e.target ?? `#${e.number}`} is a \`${scope}\` write, which the contract does not allow`);
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
  if (isItem && !leaseHeld) {
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
    const o = oracle(sc.eligibility_world ?? world, sc.target);
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

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { extractContract } from "../scripts/contracts.mjs";
import { coverage, contractOf } from "../scripts/scenario-coverage.mjs";
import { checkScenario, applyEffects, matchesReturn, checkState, ORACLES, ORACLE_REQUIRES } from "../scripts/scenario.mjs";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(PKG, "tests/scenarios");
const scenarios = readdirSync(dir).flatMap((skill) =>
  readdirSync(join(dir, skill)).filter((f) => f.endsWith(".yaml")).map((f) => ({ file: `${skill}/${f}`, sc: parse(readFileSync(join(dir, skill, f), "utf8")) })));

// ---- every golden scenario agrees with its skill's real contract ------------------------------
for (const { file, sc } of scenarios) {
  test(`scenario ${file}: ${sc.name}`, () => {
    assert.equal(file.split("/")[0], sc.skill, "the scenario sits in its skill's directory");
    assert.deepEqual(checkScenario(contractOf(sc.skill), sc), []);
  });
}

// ---- every result a skill can return has a scenario -------------------------------------------
test("every declared result has a scenario", () => {
  const holes = coverage().flatMap((r) => r.missing.map((m) => `${r.name}: ${m}`));
  assert.deepEqual(holes, [], "add a scenario under tests/scenarios/<skill>/ for each");
});

// ---- the checker catches broken scenarios ------------------------------------------------------
const shepherd = contractOf("shepherd-github-pr");
const review = contractOf("review-github-pr");
const reconcile = contractOf("reconcile-github-issues");
const find = (name) => structuredClone(scenarios.find((s) => s.file === name).sc);
const problems = (contract, sc) => checkScenario(contract, sc);

test("a result that is not in returns is rejected", () => {
  const sc = find("shepherd-github-pr/pending-checks-are-skipped.yaml");
  sc.expect.result = "#40 exploded";
  assert.ok(problems(shepherd, sc).some((p) => /not in the contract's returns/.test(p)));
});

test("a skipped run with effects is rejected", () => {
  const sc = find("shepherd-github-pr/pending-checks-are-skipped.yaml");
  sc.expect.effects = [{ op: "comment", target: "pr#40" }];
  assert.ok(problems(shepherd, sc).some((p) => /skipped must leave no effects/.test(p)));
});

test("a noop that changes anything is rejected", () => {
  const sc = find("shepherd-github-pr/lane-taken-after-the-claim.yaml");
  sc.expect.effects = [{ op: "label_add", target: "pr#40", label: "agent:ready-for-review" }];
  assert.ok(problems(shepherd, sc).some((p) => /noop may leave only the lease comment/.test(p)));
});

test("the oracle rejects skipping a conflicted PR that has no checks", () => {
  const sc = find("shepherd-github-pr/conflict-without-checks.yaml");
  sc.expect.result = "#40 skipped: checks no-checks-yet";
  sc.expect.effects = [];
  assert.ok(problems(shepherd, sc).some((p) => /oracle says pr#40 is eligible/.test(p)));
});

test("the oracle rejects working a PR that can only wait on the lane", () => {
  const sc = find("shepherd-github-pr/lane-held-is-skipped-without-a-trace.yaml");
  sc.expect.result = "#40 ready-for-review";
  sc.expect.effects = [
    { op: "label_remove", target: "pr#40", label: "agent:needs-work" },
    { op: "label_add", target: "pr#40", label: "agent:ready-for-review" },
  ];
  const p = problems(shepherd, sc);
  assert.ok(p.some((x) => /not eligible \(merge lane held by #41\)/.test(x)));
  assert.ok(p.some((x) => /2 PRs hold the merge lane/.test(x)));
});

test("a hand-off while checks are not green is rejected", () => {
  const sc = find("shepherd-github-pr/green-and-lane-free-hands-off.yaml");
  sc.world.prs[0].checks = ["fail"];
  assert.ok(problems(shepherd, sc).some((p) => /not green, current and free of findings/.test(p)));
});

test("a PR ending in two PR state labels is rejected", () => {
  const sc = find("shepherd-github-pr/green-and-lane-free-hands-off.yaml");
  sc.expect.effects = sc.expect.effects.filter((e) => e.op !== "label_remove");
  assert.ok(problems(shepherd, sc).some((p) => /ends with agent:needs-work and agent:ready-for-review/.test(p)));
});

test("a lease label left behind is rejected", () => {
  const sc = find("shepherd-github-pr/green-and-lane-free-hands-off.yaml");
  sc.world.prs[0].labels.push("agent:in-progress");
  assert.ok(problems(shepherd, sc).some((p) => /still carries the lease label agent:in-progress/.test(p)));
});

test("closing a keep-open issue is rejected", () => {
  const sc = find("reconcile-github-issues/keep-open-stays-open.yaml");
  sc.expect.effects = [{ op: "label_remove", target: "issue#12", label: "agent:pr-open" }, { op: "close", target: "issue#12" }];
  assert.ok(problems(reconcile, sc).some((p) => /keep-open/.test(p)));
});

test("the sweeper may not claim: its effects are `other`, and a repository write is refused", () => {
  const sc = find("reconcile-github-issues/merged-pr-closes-the-issue.yaml");
  sc.expect.effects.push({ op: "push", target: "pr#40" });
  assert.ok(problems(reconcile, sc).some((p) => /`repository` write/.test(p)));
});

test("a dry run that writes is rejected", () => {
  const sc = find("reconcile-github-issues/dry-run-writes-nothing.yaml");
  sc.expect.effects = [{ op: "close", target: "issue#12" }];
  assert.ok(problems(reconcile, sc).some((p) => /dry run must leave no effects/.test(p)));
});

test("merging a moved head, a pushed PR, a draft or a protected path is rejected", () => {
  const base = () => find("review-github-pr/merge-closes-the-linked-issue.yaml");
  let sc = base(); sc.expect.effects[0].sha = "other";
  assert.ok(problems(review, sc).some((p) => /pinned head is h1/.test(p)));
  sc = base(); sc.expect.effects.push({ op: "push", target: "pr#50" });
  assert.ok(problems(review, sc).some((p) => /run that pushed/.test(p)));
  sc = base(); sc.world.prs[0].draft = true;
  assert.ok(problems(review, sc).some((p) => /draft/.test(p)));
  sc = base(); sc.inputs = { human_merge_paths: ["src/"] };
  assert.ok(problems(review, sc).some((p) => /protected path src\/a.js/.test(p)));
});

test("filing past the limit, or deferring before it, is rejected", () => {
  const file = contractOf("file-github-issues");
  let sc = find("file-github-issues/limit-defers-the-rest.yaml");
  sc.inputs.limit = 1;
  assert.ok(problems(file, sc).some((p) => /files 2 candidates with limit=1/.test(p)));
  sc = find("file-github-issues/limit-defers-the-rest.yaml");
  sc.inputs.limit = 3;
  assert.ok(problems(file, sc).some((p) => /before the limit was reached/.test(p)));
});

test("calling unattended-triage when a trusted outcome stands is rejected", () => {
  const triage = contractOf("triage-github-issue");
  const sc = find("triage-github-issue/a-standing-prior-outcome-is-reused.yaml");
  sc.expect.calls = ["unattended-triage"];
  assert.ok(problems(triage, sc).some((p) => /although a prior trusted outcome still stands/.test(p)));
});

test("a borrowed lease means no lease comment and no release is expected", () => {
  const sc = find("shepherd-github-pr/green-and-lane-free-hands-off.yaml");
  sc.inputs = { lease_held: true };
  sc.world.prs[0].labels.push("agent:in-progress");
  sc.world.prs[0].lease = "live";
  assert.deepEqual(problems(shepherd, sc), []);
});

test("escalating without agent:stuck, or failing while changing labels, is rejected", () => {
  const tri = contractOf("triage-github-issue");
  let sc = find("triage-github-issue/repeated-failures-escalate.yaml");
  sc.expect.effects = sc.expect.effects.filter((e) => e.label !== "agent:stuck");
  assert.ok(problems(tri, sc).some((p) => /without adding agent:stuck/.test(p)));
  sc = find("triage-github-issue/a-failed-pass-leaves-the-state.yaml");
  sc.expect.effects.push({ op: "label_add", target: "issue#12", label: "needs-info" });
  assert.ok(problems(tri, sc).some((p) => /labels as they were/.test(p)));
  sc = find("triage-github-issue/a-failed-pass-leaves-the-state.yaml");
  sc.expect.effects = [];
  assert.ok(problems(tri, sc).some((p) => /without an `agent:failure` comment/.test(p)));
});

test("helpers", () => {
  assert.equal(checkState({ checks: [] }), "no-checks-yet");
  assert.equal(checkState({ checks: ["pass", "pending"] }), "pending");
  assert.equal(checkState({ checks: ["pass", "fail"] }), "failing");
  assert.equal(checkState({ checks: ["pass"] }), "green");
  assert.ok(matchesReturn("#40 noop: merge lane held by #41", ["#N noop: <reason>"]));
  assert.ok(matchesReturn("#50 PR #51 opened", ["#N PR #P opened"]));
  assert.ok(!matchesReturn("#50 merged now", ["#N merged"]));
  assert.throws(() => applyEffects({ issues: [{ number: 1, labels: [] }], prs: [] }, [{ op: "label_remove", target: "issue#1", label: "x" }]), /does not carry it/);
  assert.ok(ORACLES["shepherd-github-pr"]);
});

// ---- eligibility oracles for the item skills ---------------------------------------------------
const issueWorld = (labels, extra = {}) => ({ issues: [{ number: 12, state: "open", labels, ...extra }], prs: [] });
const prWorld = (labels, extra = {}) => ({ issues: [], prs: [{ number: 50, state: "open", labels, draft: false, ...extra }] });
const ok = (skill, world, target, inputs) => ORACLES[skill](world, target, inputs).eligible;

test("triage oracle: open, none of the excluded labels, no live lease held by another run", () => {
  const t = "triage-github-issue";
  assert.equal(ok(t, issueWorld([]), "issue#12"), true);
  assert.equal(ok(t, issueWorld(["needs-triage"]), "issue#12"), true, "needs-triage does not exclude");
  for (const l of ["ready-for-agent", "ready-for-human", "needs-info", "agent:pr-open", "agent:stuck", "agent:log", "agent:difficulty"]) {
    assert.equal(ok(t, issueWorld([l]), "issue#12"), false, l);
  }
  assert.equal(ok(t, issueWorld([], { state: "closed" }), "issue#12"), false);
  assert.equal(ok(t, issueWorld(["agent:triage"], { lease: "live" }), "issue#12"), false);
  assert.equal(ok(t, issueWorld(["agent:in-progress"], { lease: "live" }), "issue#12"), false);
  assert.equal(ok(t, issueWorld(["agent:triage"], { lease: "stale" }), "issue#12"), true, "a stale lease does not count");
});

test("implement oracle: open, ready-for-agent, no agent:stuck, no live lease", () => {
  const t = "implement-github-issue";
  assert.equal(ok(t, issueWorld(["ready-for-agent"]), "issue#12"), true);
  assert.equal(ok(t, issueWorld([]), "issue#12"), false);
  assert.equal(ok(t, issueWorld(["agent:pr-open"]), "issue#12"), false);
  assert.equal(ok(t, issueWorld(["ready-for-agent", "agent:stuck"]), "issue#12"), false);
  assert.equal(ok(t, issueWorld(["ready-for-agent"], { state: "closed" }), "issue#12"), false);
  assert.equal(ok(t, issueWorld(["ready-for-agent", "agent:in-progress"], { lease: "live" }), "issue#12"), false);
  assert.equal(ok(t, issueWorld(["ready-for-agent", "agent:in-progress"], { lease: "stale" }), "issue#12"), true);
  assert.equal(ok(t, issueWorld(["ready-for-agent", "agent:triage"], { lease: "live" }), "issue#12"), true, "agent:triage is not this skill's lease");
});

test("review oracle: open, not a draft, agent:ready-for-review, no stuck or human-merge, no live lease", () => {
  const t = "review-github-pr";
  assert.equal(ok(t, prWorld(["agent:ready-for-review"]), "pr#50"), true);
  assert.equal(ok(t, prWorld(["agent:needs-work"]), "pr#50"), false);
  assert.equal(ok(t, prWorld(["agent:ready-for-review"], { draft: true }), "pr#50"), false);
  assert.equal(ok(t, prWorld(["agent:ready-for-review"], { state: "merged" }), "pr#50"), false);
  assert.equal(ok(t, prWorld(["agent:ready-for-review", "agent:stuck"]), "pr#50"), false);
  assert.equal(ok(t, prWorld(["agent:ready-for-review", "agent:human-merge"]), "pr#50"), false);
  assert.equal(ok(t, prWorld(["agent:ready-for-review", "agent:in-progress"], { lease: "live" }), "pr#50"), false);
  assert.equal(ok(t, prWorld(["agent:ready-for-review", "agent:in-progress"], { lease: "stale" }), "pr#50"), true);
});

test("lease_held=true is honoured: eligible only when the caller's lease is live", () => {
  const held = { lease_held: true };
  const cases = [
    ["triage-github-issue", (lease) => issueWorld(["agent:triage"], { lease }), "issue#12"],
    ["implement-github-issue", (lease) => issueWorld(["ready-for-agent", "agent:in-progress"], { lease }), "issue#12"],
    ["review-github-pr", (lease) => prWorld(["agent:ready-for-review", "agent:in-progress"], { lease }), "pr#50"],
    ["shepherd-github-pr", (lease) => prWorld(["agent:needs-work", "agent:in-progress"], { lease, checks: ["fail"] }), "pr#50"],
  ];
  for (const [skill, world, target] of cases) {
    assert.equal(ok(skill, world("live"), target, held), true, `${skill}: live lease, lease_held`);
    assert.equal(ok(skill, world("stale"), target, held), false, `${skill}: stale lease, lease_held`);
    assert.equal(ok(skill, world(undefined), target, held), false, `${skill}: no lease, lease_held`);
    assert.equal(ok(skill, world("live"), target, {}), false, `${skill}: live lease held by another run`);
  }
});

test("the checker uses the oracle of each item skill, and passes the inputs through", () => {
  const triage = contractOf("triage-github-issue");
  const implement = contractOf("implement-github-issue");
  const reviewC = contractOf("review-github-pr");
  let sc = find("triage-github-issue/already-triaged-is-skipped.yaml");
  sc.world.issues[0].labels = ["needs-triage"];
  assert.ok(problems(triage, sc).some((p) => /oracle says issue#12 is eligible/.test(p)));
  sc = find("implement-github-issue/already-has-a-state-is-skipped.yaml");
  sc.world.issues[0].labels = ["ready-for-agent"];
  assert.ok(problems(implement, sc).some((p) => /oracle says issue#12 is eligible/.test(p)));
  sc = find("review-github-pr/not-ready-for-review-is-skipped.yaml");
  sc.world.prs[0].labels = ["agent:ready-for-review"];
  assert.ok(problems(reviewC, sc).some((p) => /oracle says pr#50 is eligible/.test(p)));
  // a live lease held by another run makes a skip correct, and lease_held=true makes it wrong
  sc = find("implement-github-issue/already-has-a-state-is-skipped.yaml");
  sc.world.issues[0] = { number: 12, state: "open", labels: ["ready-for-agent", "agent:in-progress"], lease: "live" };
  sc.expect.result = "#12 skipped: another run holds it";
  assert.deepEqual(problems(implement, sc), []);
  sc.inputs = { lease_held: true };
  assert.ok(problems(implement, sc).some((p) => /oracle says issue#12 is eligible/.test(p)));
  // a run that works an ineligible item is rejected
  sc = find("implement-github-issue/missing-information-bails-out.yaml");
  sc.world.issues[0].labels.push("agent:stuck");
  assert.ok(problems(implement, sc).some((p) => /oracle says issue#12 is not eligible \(not an open ready-for-agent issue\)/.test(p)));
});

// A prompt to look, not a proof: when a skill gains or loses a `requires` entry, the oracle that
// mirrors it must be revisited, and ORACLE_REQUIRES in scripts/scenario.mjs updated with it.
for (const [skill, n] of Object.entries(ORACLE_REQUIRES)) {
  test(`${skill}: its oracle mirrors ${n} requires entries`, () => {
    assert.ok(ORACLES[skill], "the skill has an oracle");
    assert.equal(contractOf(skill).requires.length, n, `requires of ${skill} changed: update ORACLES[\"${skill}\"] and ORACLE_REQUIRES together`);
  });
}
test("every oracle has a requires count, and every skill that works one target has an oracle", () => {
  assert.deepEqual(Object.keys(ORACLES).sort(), Object.keys(ORACLE_REQUIRES).sort());
  const items = readdirSync(join(PKG, "skills/pipeline")).filter((n) => existsSync(join(PKG, "skills/pipeline", n, "SKILL.md")) && contractOf(n).kind === "item" && contractOf(n).target?.param);
  assert.deepEqual(items.sort(), Object.keys(ORACLES).sort());
});

// ---- the checker for a skill that returns a document (merge-safety) -----------------------------
const safety = contractOf("merge-safety");
const doc = (name, edit) => { const sc = find(`merge-safety/${name}.yaml`); edit(sc); return problems(safety, sc); };

test("a verdict the contract does not allow is rejected", () => {
  const p = doc("a-clean-small-pr-passes", (sc) => { sc.expect.document.Verdict = "MAYBE"; });
  assert.ok(p.some((m) => /none of: PASS \| BLOCK \| HOLD/.test(m)), p.join("\n"));
});

test("a section the contract names, left out of the document, is rejected", () => {
  const p = doc("a-clean-small-pr-passes", (sc) => { delete sc.expect.document.Reversibility; });
  assert.ok(p.some((m) => /no `Reversibility`/.test(m)), p.join("\n"));
});

test("a section the contract does not name is rejected", () => {
  const p = doc("a-clean-small-pr-passes", (sc) => { sc.expect.document.Opinion = "looks fine"; });
  assert.ok(p.some((m) => /`Opinion`, which is not in the contract's returns/.test(m)), p.join("\n"));
});

test("a pure skill that leaves an effect is rejected", () => {
  const p = doc("a-clean-small-pr-passes", (sc) => { sc.expect.effects = [{ op: "label_add", target: "pr#33", label: "agent:ready-for-review" }]; });
  assert.ok(p.some((m) => /pure skill must leave no effects/.test(m)), p.join("\n"));
});

test("a pass that still has next steps is rejected, and so is a block that has none", () => {
  const pass = doc("a-clean-small-pr-passes", (sc) => { sc.expect.document["Blockers or next steps"] = "Fix the typo first."; });
  assert.ok(pass.some((m) => /PASS must have no blockers/.test(m)), pass.join("\n"));
  const block = doc("a-breaking-change-to-a-public-contract-blocks", (sc) => { sc.expect.document["Blockers or next steps"] = "None"; });
  assert.ok(block.some((m) => /BLOCK must name at least one next step/.test(m)), block.join("\n"));
});

test("the world settles the verdict: a moved head, a pending check or a draft must be HOLD", () => {
  const moved = doc("a-head-that-is-not-the-pinned-head-holds", (sc) => { sc.expect.document.Verdict = "PASS"; sc.expect.document["Blockers or next steps"] = "None"; });
  assert.ok(moved.some((m) => /must be HOLD, because the pinned head h4 is not the PR's head h5/.test(m)), moved.join("\n"));
  const pending = doc("a-pending-check-holds", (sc) => { sc.expect.document.Verdict = "BLOCK"; });
  assert.ok(pending.some((m) => /must be HOLD, because a check is pending/.test(m)), pending.join("\n"));
  const draft = doc("a-clean-small-pr-passes", (sc) => { sc.world.prs[0].draft = true; });
  assert.ok(draft.some((m) => /must be HOLD, because the PR is a draft/.test(m)), draft.join("\n"));
});

test("a pass is rejected while checks fail or the PR has conflicts", () => {
  const failing = doc("a-clean-small-pr-passes", (sc) => { sc.world.prs[0].checks = ["pass", "fail"]; });
  assert.ok(failing.some((m) => /PASS while the checks are failing/.test(m)), failing.join("\n"));
  const dirty = doc("a-clean-small-pr-passes", (sc) => { sc.world.prs[0].mergeState = "DIRTY"; });
  assert.ok(dirty.some((m) => /PASS while the PR has merge conflicts/.test(m)), dirty.join("\n"));
});

test("merge-safety has a scenario for each of its three verdicts", () => {
  const row = coverage().find((r) => r.name === "merge-safety");
  assert.equal(row.total, 3);
  assert.deepEqual(row.missing, []);
});

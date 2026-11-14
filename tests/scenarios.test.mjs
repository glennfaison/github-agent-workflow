import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { extractContract, allowsOf } from "../scripts/contracts.mjs";
import { coverage, contractOf, rerunGaps } from "../scripts/scenario-coverage.mjs";
import { checkScenario, allowedBy, globMatches, markerOf, expandScenario, labelCatalog, syncLabels, LABEL_CATALOG, diffWorlds, applyEffects, matchesReturn, checkState, ORACLES, ORACLE_REQUIRES } from "../scripts/scenario.mjs";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(PKG, "tests/scenarios");
const scenarios = readdirSync(dir).flatMap((skill) =>
  readdirSync(join(dir, skill)).filter((f) => f.endsWith(".yaml")).map((f) => ({ file: `${skill}/${f}`, sc: expandScenario(parse(readFileSync(join(dir, skill, f), "utf8"))) })));

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

// ---- unattended-triage: the same checker, a different document -----------------------------------
const triage = contractOf("unattended-triage");
const tri = (name, edit) => { const sc = find(`unattended-triage/${name}.yaml`); edit(sc); return problems(triage, sc); };

test("a state that does not match the comment structure is rejected", () => {
  const p = tri("a-complete-bug-is-ready-for-agent", (sc) => { sc.expect.document["Comment structure"] = "Triage Notes"; });
  assert.ok(p.some((m) => /ready-for-agent needs the Agent Brief, not Triage Notes/.test(m)), p.join("\n"));
});

test("ready-for-agent is rejected for a feature with no use case", () => {
  const p = tri("a-feature-with-no-use-case-needs-info", (sc) => { Object.assign(sc.expect.document, { "Recommended state": "ready-for-agent", "Comment structure": "Agent Brief" }); });
  assert.ok(p.some((m) => /no stated use case is never ready-for-agent/.test(m)), p.join("\n"));
});

test("an open question is never ready-for-agent", () => {
  const p = tri("an-open-question-is-never-ready-for-agent", (sc) => { Object.assign(sc.expect.document, { "Recommended state": "ready-for-agent", "Comment structure": "Agent Brief" }); });
  assert.ok(p.some((m) => /open question\(s\), so the state must be needs-info/.test(m)), p.join("\n"));
});

test("a wontfix recommendation must be ready-for-human", () => {
  const p = tri("a-wontfix-is-ready-for-human-never-a-close", (sc) => { Object.assign(sc.expect.document, { "Recommended state": "needs-info", "Comment structure": "Triage Notes" }); });
  assert.ok(p.some((m) => /wontfix recommendation is ready-for-human, not needs-info/.test(m)), p.join("\n"));
});

test("triage that posts a comment is rejected, because the caller owns every write", () => {
  const p = tri("a-complete-bug-is-ready-for-agent", (sc) => { sc.expect.effects = [{ op: "comment", target: "issue#21", marker: "agent:outcome" }]; });
  assert.ok(p.some((m) => /pure skill must leave no effects/.test(m)), p.join("\n"));
});

// ---- grill-via-github-comments: a round of questions checked against the subject's decision tree --
const grill = contractOf("grill-via-github-comments");
const gr = (name, edit) => { const sc = find(`grill-via-github-comments/${name}.yaml`); edit(sc); return problems(grill, sc); };

test("asking a decision whose prerequisite is still open is rejected", () => {
  const p = gr("two-independent-decisions-are-one-round", (sc) => { sc.decisions[1].needs = ["A"]; });
  assert.ok(p.some((m) => /asks about B while A, which it depends on, is still open/.test(m)), p.join("\n"));
});

test("leaving a frontier decision out of the round is rejected", () => {
  const p = gr("two-independent-decisions-are-one-round", (sc) => { sc.expect.asks = ["A"]; sc.expect.document.Questions.pop(); });
  assert.ok(p.some((m) => /B is on the frontier but is not asked/.test(m)), p.join("\n"));
});

test("a question without a recommended answer is rejected", () => {
  const p = gr("two-independent-decisions-are-one-round", (sc) => { sc.expect.document.Questions[0] = "❓ **Q1** - **Which columns?**: All of them?"; });
  assert.ok(p.some((m) => /question 1 has no recommended answer/.test(m)), p.join("\n"));
});

test("asking something the code answers is rejected, and so is leaving out the finding", () => {
  const asked = gr("two-independent-decisions-are-one-round", (sc) => { sc.decisions[0].lookup = true; });
  assert.ok(asked.some((m) => /asks about A, which could be looked up/.test(m)), asked.join("\n"));
  const silent = gr("a-question-the-code-answers-is-a-finding", (sc) => { sc.expect.document.Findings = "None"; });
  assert.ok(silent.some((m) => /can be looked up, so the answer must be a finding/.test(m)), silent.join("\n"));
});

test("hiding the decisions that wait for a later round is rejected", () => {
  const p = gr("a-dependent-decision-waits-for-a-later-round", (sc) => { sc.expect.document["Waiting on those answers"] = "None"; });
  assert.ok(p.some((m) => /B wait for these answers, but `Waiting on those answers` is None/.test(m)), p.join("\n"));
});

test("an outcome that disagrees with the questions is rejected", () => {
  const p = gr("a-question-the-code-answers-is-a-finding", (sc) => { sc.expect.document.Outcome = "asked"; });
  assert.ok(p.some((m) => /`asked` exactly when there are questions/.test(m)), p.join("\n"));
});

// ---- retrospective: a report checked against the run-log world and the inputs ----------------------
const retro = contractOf("retrospective");
const rt = (name, edit) => { const sc = find(`retrospective/${name}.yaml`); edit(sc); return problems(retro, sc); };

test("using an entry older than days is rejected", () => {
  const p = rt("entries-older-than-days-are-not-used", (sc) => { sc.expect.used = ["r1", "r2"]; sc.expect.document["Entries considered"] = "2 (from issue #90)"; });
  assert.ok(p.some((m) => /uses r2, which is older than 14 days/.test(m)), p.join("\n"));
});

test("leaving out an entry inside the scope is rejected", () => {
  const p = rt("step-filters-the-entries", (sc) => { sc.expect.used = ["r2"]; sc.expect.document["Entries considered"] = "1 (from issue #90)"; });
  assert.ok(p.some((m) => /leaves out r3, which falls inside the scope/.test(m)), p.join("\n"));
});

test("using another step's or another runner's entry is rejected", () => {
  const step = rt("step-filters-the-entries", (sc) => { sc.expect.used.push("r1"); sc.expect.document["Entries considered"] = "3 (from issue #90)"; });
  assert.ok(step.some((m) => /uses r1, which is a Triaging entry, and step=Reviewing/.test(m)), step.join("\n"));
  const runner = rt("only-runner-filters-the-entries", (sc) => { sc.expect.used.push("r2"); sc.expect.document["Entries considered"] = "2 (from issue #90)"; });
  assert.ok(runner.some((m) => /uses r2, which is from ci-bot, and only_runner=nightly/.test(m)), runner.join("\n"));
});

test("more ranked suggestions than max_suggestions is rejected", () => {
  const p = rt("suggestions-never-exceed-max-suggestions", (sc) => { sc.expect.document["Ranked suggestions"].push("**A third** — change `x`. Evidence: r3."); });
  assert.ok(p.some((m) => /3 ranked suggestions with max_suggestions=2/.test(m)), p.join("\n"));
});

test("a suggestion with no evidence, or a count that disagrees with the entries used, is rejected", () => {
  const bare = rt("entries-older-than-days-are-not-used", (sc) => { sc.expect.document["Ranked suggestions"] = ["**Do something** — change `x`."]; });
  assert.ok(bare.some((m) => /suggestion 1 has no evidence/.test(m)), bare.join("\n"));
  const count = rt("entries-older-than-days-are-not-used", (sc) => { sc.expect.document["Entries considered"] = "5 (from issue #90)"; });
  assert.ok(count.some((m) => /`Entries considered` says 5, but the report used 1/.test(m)), count.join("\n"));
});

test("an empty report that still ranks suggestions, or an idle entry that is counted, is rejected", () => {
  const rank = rt("no-entries-is-an-empty-report", (sc) => { sc.expect.document["Ranked suggestions"] = ["**Idle** — change `x`. Evidence: r1."]; });
  assert.ok(rank.some((m) => /an empty report has no ranked suggestions/.test(m)), rank.join("\n"));
  const idle = rt("no-entries-is-an-empty-report", (sc) => { sc.expect.used = ["r1"]; sc.expect.document.Outcome = "report"; sc.expect.document["Entries considered"] = "1 (idle)"; });
  assert.ok(idle.some((m) => /uses r1, which is idle/.test(m)), idle.join("\n"));
});

test("a retrospective that edits a label is rejected, because nothing is written", () => {
  const p = rt("no-entries-is-an-empty-report", (sc) => { sc.expect.effects = [{ op: "label_add", target: "issue#90", label: "agent:stuck" }]; });
  assert.ok(p.some((m) => /pure skill must leave no effects/.test(m)), p.join("\n"));
});

// ---- setup-github-agent-workflow: labels from labels.md, and one section of one file ----------------
const setup = contractOf("setup-github-agent-workflow");
const su = (name, edit) => { const sc = find(`setup-github-agent-workflow/${name}.yaml`); edit(sc); return problems(setup, sc); };

test("the label catalog is read from labels.md: agent labels are forced, triage labels are not", () => {
  assert.ok(LABEL_CATALOG.length > 0);
  for (const c of LABEL_CATALOG) assert.equal(c.force, c.name.startsWith("agent:"), c.name);
  assert.deepEqual(labelCatalog("## Setup\n```bash\ngh label create \"x\" --description \"d\" --force\ngh label create \"y\"\n```"), [{ name: "x", description: "d", force: true }, { name: "y", force: false }]);
});

test("running the setup block against a complete label set leaves nothing to do", () => {
  assert.deepEqual(syncLabels(LABEL_CATALOG.map(({ name, description }) => ({ name, description }))), []);
});

test("a label that labels.md does not declare, or a missing one, is rejected", () => {
  const extra = su("an-empty-repository-gets-every-label", (sc) => { sc.expect.effects.push({ op: "label_create", name: "agent:extra" }); });
  assert.ok(extra.some((m) => /label_create `agent:extra`, which labels.md does not declare/.test(m)), extra.join("\n"));
  const missing = su("an-empty-repository-gets-every-label", (sc) => { sc.expect.effects = sc.expect.effects.filter((e) => e.name !== "agent:log"); });
  assert.ok(missing.some((m) => /does not label_create `agent:log`, which labels.md calls for/.test(m)), missing.join("\n"));
});

test("overwriting a kept triage label, or creating one that exists, is rejected", () => {
  const kept = su("an-agent-label-is-reset-and-a-triage-label-is-kept", (sc) => { sc.expect.effects.push({ op: "label_update", name: "needs-info", description: "mine" }); });
  assert.ok(kept.some((m) => /label_update `needs-info` is not what labels.md calls for/.test(m)), kept.join("\n"));
  const again = su("an-agent-label-is-reset-and-a-triage-label-is-kept", (sc) => { sc.expect.effects.push({ op: "label_create", name: "needs-info" }); });
  assert.ok(again.some((m) => /creates label `needs-info`, which already exists/.test(m)), again.join("\n"));
});

test("an existing agent label that is not reset is rejected", () => {
  const p = su("an-agent-label-is-reset-and-a-triage-label-is-kept", (sc) => { sc.expect.effects = sc.expect.effects.filter((e) => e.name !== "agent:stuck"); });
  assert.ok(p.some((m) => /does not label_update `agent:stuck`/.test(m)), p.join("\n"));
});

test("setup that touches an issue is rejected", () => {
  const p = su("a-second-run-changes-nothing", (sc) => { sc.world.issues = [{ number: 1, state: "open", labels: [] }]; sc.expect.effects = [{ op: "label_add", target: "issue#1", label: "bug" }]; sc.expect.document.Outcome = "set up"; });
  assert.ok(p.some((m) => /is a `other` write, which the contract does not allow/.test(m)), p.join("\n"));
});

test("editing the instructions file outside its section, in the wrong file, or not at all is rejected", () => {
  const outside = su("an-empty-repository-gets-every-label", (sc) => { sc.expect.effects[sc.expect.effects.length - 1].text = sc.expect.effects[sc.expect.effects.length - 1].text.replace("Be kind.", "Be rude."); });
  assert.ok(outside.some((m) => /changes AGENTS.md outside its `## GitHub workflow` section/.test(m)), outside.join("\n"));
  const second = su("claude-md-is-edited-when-it-exists", (sc) => { sc.expect.effects[0].path = "AGENTS.md"; sc.expect.document["Settings file"] = "AGENTS.md"; });
  assert.ok(second.some((m) => /writes AGENTS.md, but the agent instructions file is CLAUDE.md/.test(m)), second.join("\n"));
  const unrecorded = su("an-empty-repository-gets-every-label", (sc) => { sc.expect.effects = sc.expect.effects.filter((e) => e.op !== "write_file"); sc.expect.document["Settings file"] = "None"; });
  assert.ok(unrecorded.some((m) => /does not record pr_base_branch: develop in AGENTS.md/.test(m)), unrecorded.join("\n"));
});

test("a second run that rewrites the file, or reports a change it did not make, is rejected", () => {
  const rewrite = su("a-second-run-changes-nothing", (sc) => { sc.expect.effects = [{ op: "write_file", path: "AGENTS.md", text: sc.world.files["AGENTS.md"] }]; sc.expect.document.Outcome = "set up"; sc.expect.document["Settings file"] = "AGENTS.md"; });
  assert.ok(rewrite.some((m) => /writes AGENTS.md unchanged/.test(m)), rewrite.join("\n"));
  const lie = su("a-second-run-changes-nothing", (sc) => { sc.expect.document.Outcome = "set up"; });
  assert.ok(lie.some((m) => /`set up` exactly when the run changed something/.test(m)), lie.join("\n"));
});

test("a label removed from the world is something no effect can express", () => {
  const before = { issues: [], prs: [], labels: [{ name: "a" }, { name: "b" }] };
  assert.deepEqual(diffWorlds(before, { ...before, labels: [{ name: "a" }] }).map((e) => `${e.op} ${e.field}`), ["unmodelled labels"]);
});

// ---- rerun: a second run must find nothing to redo ---------------------------------------------------
const rr = (path, edit) => { const sc = find(path); edit(sc); return problems(contractOf(sc.skill), sc); };

test("every scenario that completed a run says what a second run finds", () => {
  assert.deepEqual(rerunGaps(), []);
});

test("a terminal outcome that leaves the item eligible fails: a broken oracle, or effects that did not change the state", () => {
  const path = "review-github-pr/merge-closes-the-linked-issue.yaml";
  const real = ORACLES["review-github-pr"];
  ORACLES["review-github-pr"] = () => ({ eligible: true });
  try {
    const p = problems(contractOf("review-github-pr"), find(path));
    assert.ok(p.some((m) => /rerun is `ineligible`, but the oracle says pr#\d+ is eligible/.test(m)), p.join("\n"));
  } finally { ORACLES["review-github-pr"] = real; }
  const left = rr("triage-github-issue/open-questions-mean-needs-info.yaml", (sc) => { sc.expect.effects = sc.expect.effects.filter((e) => e.label !== "needs-info"); });
  assert.ok(left.some((m) => /rerun is `ineligible`, but the oracle says issue#12 is eligible/.test(m)), left.join("\n"));
});

test("a failed run that the scenario calls ineligible, or a pushed fix that it calls eligible, is rejected", () => {
  const failed = rr("shepherd-github-pr/unreadable-failure-is-a-failed-run.yaml", (sc) => { sc.expect.rerun = "ineligible"; });
  assert.ok(failed.some((m) => /rerun is `ineligible`, but the oracle says pr#\d+ is eligible/.test(m)), failed.join("\n"));
  const pushed = rr("shepherd-github-pr/failing-checks-are-fixed-while-the-lane-is-held.yaml", (sc) => { sc.expect.rerun = "eligible"; });
  assert.ok(pushed.some((m) => /rerun is `eligible`, but the oracle says pr#\d+ is not eligible \(checks pending\)/.test(m)), pushed.join("\n"));
});

test("an unknown rerun value, a skip with no reason, or a rerun on a skill with no item is rejected", () => {
  assert.ok(rr("review-github-pr/merge-closes-the-linked-issue.yaml", (sc) => { sc.expect.rerun = "maybe"; }).some((m) => /`rerun` is `eligible`, `ineligible` or `\{skip/.test(m)));
  assert.ok(rr("review-github-pr/merge-closes-the-linked-issue.yaml", (sc) => { sc.expect.rerun = { skip: " " }; }).some((m) => /needs the reason/.test(m)));
  assert.deepEqual(rr("review-github-pr/merge-closes-the-linked-issue.yaml", (sc) => { sc.expect.rerun = { skip: "the merge is its own proof" }; }), []);
});

test("an interrupted pass must be eligible again, return nothing, and not repeat what it made", () => {
  const path = "triage-github-issue/an-interrupted-pass-is-safe-to-repeat.yaml";
  assert.deepEqual(problems(contractOf("triage-github-issue"), find(path)), []);
  assert.ok(rr(path, (sc) => { sc.expect.rerun = "ineligible"; }).some((m) => /must be safe to repeat/.test(m)));
  assert.ok(rr(path, (sc) => { sc.expect.result = "#15 needs-info"; }).some((m) => /returned no result/.test(m)));
  const again = rr(path, (sc) => { sc.expect.rerun_effects.push({ op: "comment", target: "issue#15", marker: "agent:outcome", text: "Agent Brief" }); });
  assert.ok(again.some((m) => /the rerun repeats comment on issue#15/.test(m)), again.join("\n"));
  const wrong = rr(path, (sc) => { sc.expect.rerun_effects.push({ op: "label_add", target: "issue#15", label: "agent:triage" }); });
  assert.ok(wrong.some((m) => /repeats label_add on issue#15/.test(m)), wrong.join("\n"));
});

// ---- group skills: selection, order, forwarding, the log ----------------------------------------------
const gp = (path, edit) => { const sc = find(path); edit(sc); return problems(contractOf(sc.skill), sc); };
const IMPL = "implement-github-issues/the-oldest-eligible-issues-fill-the-batch.yaml";
const TRIAGE = "triage-github-issues/the-oldest-untriaged-issues-fill-the-batch.yaml";

test("a dispatch that drops trusted_authors fails", () => {
  const p = gp(IMPL, (sc) => { delete sc.expect.dispatches[0].inputs.trusted_authors; });
  assert.ok(p.some((m) => /the dispatch of issue#9 drops `trusted_authors`/.test(m)), p.join("\n"));
});

test("a dispatch must carry write_log=false and nothing the item does not list", () => {
  const logged = gp(IMPL, (sc) => { sc.expect.dispatches[0].inputs.write_log = true; });
  assert.ok(logged.some((m) => /gives write_log=true, not false/.test(m)), logged.join("\n"));
  const extra = gp(IMPL, (sc) => { sc.expect.dispatches[0].inputs.implement_batch = 2; });
  assert.ok(extra.some((m) => /gives `implement_batch`, which implement-github-issue does not list/.test(m)), extra.join("\n"));
  const unset = gp("implement-github-issues/only-the-inputs-this-run-set-are-forwarded.yaml", (sc) => { sc.expect.dispatches[0].inputs.unattended = true; });
  assert.ok(unset.some((m) => /gives `unattended`, which .* did not set/.test(m)), unset.join("\n"));
});

test("a stuck, leased or unready issue that is dispatched, or one past the batch, is rejected", () => {
  const stuck = gp(IMPL, (sc) => { sc.expect.dispatches[1] = { ...sc.expect.dispatches[1], target: "issue#14", result: "#14 needs-info" }; sc.expect.results[1] = "#14 needs-info"; sc.expect.log.results[1] = "#14 needs-info"; });
  assert.ok(stuck.some((m) => /dispatches issue#14, which is not eligible/.test(m)), stuck.join("\n"));
  const past = gp(IMPL, (sc) => { sc.expect.dispatches[1] = { ...sc.expect.dispatches[1], target: "issue#5", result: "#5 needs-info" }; sc.expect.results[1] = "#5 needs-info"; sc.expect.log.results[1] = "#5 needs-info"; });
  assert.ok(past.some((m) => /dispatches issue#5, which is past the batch of 2/.test(m)), past.join("\n"));
});

test("leaving out an eligible issue, or dispatching newest first, is rejected", () => {
  const short = gp(IMPL, (sc) => { sc.expect.dispatches.pop(); sc.expect.results.pop(); sc.expect.log.results.pop(); });
  assert.ok(short.some((m) => /does not dispatch issue#12, which is eligible and within the batch of 2/.test(m)), short.join("\n"));
  const wrong = gp(IMPL, (sc) => { sc.expect.dispatches.reverse(); sc.expect.results.reverse(); sc.expect.log.results.reverse(); });
  assert.ok(wrong.some((m) => /wrong order: oldest first is issue#9, issue#12/.test(m)), wrong.join("\n"));
});

test("the batch comes from the run's inputs, and one is required", () => {
  const p = gp(IMPL, (sc) => { delete sc.inputs.implement_batch; });
  assert.ok(p.some((m) => /must set `implement_batch`/.test(m)), p.join("\n"));
});

test("the returned lines and the log entry must match what was dispatched", () => {
  const ret = gp(IMPL, (sc) => { sc.expect.results = ["nothing eligible"]; });
  assert.ok(ret.some((m) => /returns \["nothing eligible"\], but the dispatched items gave/.test(m)), ret.join("\n"));
  const log = gp(IMPL, (sc) => { sc.expect.log.results.pop(); });
  assert.ok(log.some((m) => /the log entry lists/.test(m)), log.join("\n"));
  const bad = gp(IMPL, (sc) => { sc.expect.dispatches[0].result = "#9 merged"; sc.expect.results[0] = "#9 merged"; sc.expect.log.results[0] = "#9 merged"; });
  assert.ok(bad.some((m) => /result `#9 merged` is not one of implement-github-issue's returns/.test(m)), bad.join("\n"));
  const idle = gp("implement-github-issues/nothing-eligible.yaml", (sc) => { sc.expect.log.results = []; });
  assert.ok(idle.some((m) => /the log entry lists \[\], but \["nothing eligible"\] happened/.test(m)), idle.join("\n"));
});

test("a group skill that does item work itself is rejected", () => {
  const p = gp(IMPL, (sc) => { sc.expect.effects = [{ op: "label_add", target: "issue#9", label: "agent:pr-open" }]; });
  assert.ok(p.some((m) => /does no item work/.test(m)), p.join("\n"));
});

test("triage-github-issues reconciles first, with the inputs reconcile lists", () => {
  const none = gp(TRIAGE, (sc) => { delete sc.expect.reconcile; });
  assert.ok(none.some((m) => /must call reconcile-github-issues first/.test(m)), none.join("\n"));
  const drops = gp(TRIAGE, (sc) => { delete sc.expect.reconcile.inputs.runner; });
  assert.ok(drops.some((m) => /the call to reconcile-github-issues drops `runner`/.test(m)), drops.join("\n"));
  const batch = gp(TRIAGE, (sc) => { sc.expect.reconcile.inputs.triage_batch = 2; });
  assert.ok(batch.some((m) => /gives `triage_batch`, which reconcile-github-issues does not list/.test(m)), batch.join("\n"));
  const line = gp(TRIAGE, (sc) => { sc.expect.reconcile.results = ["#30 tidied"]; });
  assert.ok(line.some((m) => /`#30 tidied` is not one of reconcile-github-issues's returns/.test(m)), line.join("\n"));
  const extra = gp(IMPL, (sc) => { sc.expect.reconcile = { inputs: {}, results: [] }; });
  assert.ok(extra.some((m) => /calls no other skill/.test(m)), extra.join("\n"));
});

test("a review round leaves out drafts, and a shepherd round does not wait for checks", () => {
  const draft = gp("review-github-prs/the-oldest-reviewable-prs-fill-the-batch.yaml", (sc) => { sc.expect.dispatches[0] = { ...sc.expect.dispatches[0], target: "pr#42" }; });
  assert.ok(draft.some((m) => /dispatches pr#42, which is not eligible/.test(m)), draft.join("\n"));
  const wait = gp("shepherd-github-prs/the-oldest-shepherdable-prs-fill-the-batch.yaml", (sc) => { sc.expect.dispatches[0] = { ...sc.expect.dispatches[0], target: "pr#42" }; });
  assert.ok(wait.some((m) => /dispatches pr#42, which is not eligible \(checks pending\)/.test(m)), wait.join("\n"));
});

test("a group skill needs three scenarios, one that dispatches and one that does not", () => {
  const row = coverage().find((r) => r.name === "triage-github-issues");
  assert.equal(row.total, 3);
  assert.deepEqual(row.missing, []);
});

// explore-github-repo: findings are ranked, then filed through one call with a limit
const EXPLORE = "explore-github-repo/findings-are-ranked-and-the-cap-counts-only-filed.yaml";

test("explore passes every finding best first, with the limit and the inputs file-github-issues lists", () => {
  const unranked = gp(EXPLORE, (sc) => { sc.expect.dispatches[0].candidates.reverse(); });
  assert.ok(unranked.some((m) => /but best first is/.test(m)), unranked.join("\n"));
  const limit = gp(EXPLORE, (sc) => { sc.expect.dispatches[0].inputs.limit = 3; });
  assert.ok(limit.some((m) => /gives limit=3, not 2/.test(m)), limit.join("\n"));
  const unattended = gp(EXPLORE, (sc) => { delete sc.expect.dispatches[0].inputs.unattended; });
  assert.ok(unattended.some((m) => /drops `unattended`/.test(m)), unattended.join("\n"));
  const runId = gp(EXPLORE, (sc) => { delete sc.expect.dispatches[0].inputs.run_id; });
  assert.ok(runId.some((m) => /drops `run_id`/.test(m)), runId.join("\n"));
  const twice = gp(EXPLORE, (sc) => { sc.expect.dispatches.push(sc.expect.dispatches[0]); });
  assert.ok(twice.some((m) => /2 times, and the contract has it called once/.test(m)), twice.join("\n"));
});

test("explore's cap counts filed issues only, and everything after it is deferred", () => {
  const over = gp(EXPLORE, (sc) => { sc.expect.dispatches[0].results[3] = "filed #103"; sc.expect.result = "3 filed, 1 commented, 0 dropped"; sc.expect.log.deferred = []; });
  assert.ok(over.some((m) => /3 candidates filed \(or would-file\) with a limit of 2/.test(m)), over.join("\n"));
  const early = gp(EXPLORE, (sc) => { sc.expect.dispatches[0].results[1] = "deferred: over limit"; sc.expect.result = "2 filed, 0 commented, 0 dropped"; });
  assert.ok(early.some((m) => /defers `Template picker is slow` before the limit of 2 is reached/.test(m)), early.join("\n"));
  const after = gp(EXPLORE, (sc) => { sc.expect.dispatches[0].results[2] = "deferred: over limit"; sc.expect.dispatches[0].results[3] = "filed #104"; });
  assert.ok(after.some((m) => /after deferring a candidate/.test(m)), after.join("\n"));
});

test("explore's count line, its log, a dry run and an empty round are checked", () => {
  const count = gp(EXPLORE, (sc) => { sc.expect.result = "2 filed, 0 commented, 0 dropped"; });
  assert.ok(count.some((m) => /returns `2 filed, 0 commented, 0 dropped`, but the results count/.test(m)), count.join("\n"));
  const log = gp(EXPLORE, (sc) => { sc.expect.log.deferred = []; });
  assert.ok(log.some((m) => /the log defers \[\]/.test(m)), log.join("\n"));
  const dry = gp("explore-github-repo/a-dry-run-files-nothing.yaml", (sc) => { sc.expect.dispatches[0].results[0] = "filed #101"; });
  assert.ok(dry.some((m) => /files an issue with dry_run=true/.test(m)), dry.join("\n"));
  const wf = gp(EXPLORE, (sc) => { sc.expect.dispatches[0].results[0] = "would-file: Export drops the header row"; });
  assert.ok(wf.some((m) => /`would-file` without dry_run=true/.test(m)), wf.join("\n"));
  const invent = gp("explore-github-repo/nothing-found-calls-nothing.yaml", (sc) => { sc.expect.dispatches = [{ inputs: { limit: 2, unattended: true, run_id: "r" }, candidates: [], results: [] }]; });
  assert.ok(invent.some((m) => /with nothing found, so it invents work/.test(m)), invent.join("\n"));
});

// ---- splitting an issue that is too large (references/split.md, docs/adr/0015) ----------------------

{
  const impl = contractOf("implement-github-issue");
  const split = () => find("implement-github-issue/splits-an-issue-that-is-too-large.yaml");
  const p = (sc) => problems(impl, sc);

  test("a split below the limit is accepted, and max_depth=0 turns it off", () => {
    assert.deepEqual(p(split()), []);
    const sc = split(); sc.inputs = { max_depth: 0 };
    assert.ok(p(sc).some((x) => /only an issue with fewer ancestors than max_depth splits/.test(x)));
  });

  test("a sub-issue at the limit may not split, and neither may an issue whose depth cannot be read", () => {
    const sc = split();
    sc.target = "issue#13"; sc.world.issues = [{ number: 12, state: "open", labels: [], comments: [] }, { number: 13, state: "open", labels: ["ready-for-agent"], parent: 12 }];
    sc.expect.result = "#13 split into #14, #15";
    sc.expect.effects = sc.expect.effects.map((e) => (e.op === "create_issue" ? { ...e, number: e.number + 1, data: { ...e.data, parent: 13 } } : { ...e, target: "issue#13" }));
    sc.expect.effects[2].text = "children=14,15";
    assert.ok(p(sc).some((x) => /1 deep with max_depth=1/.test(x)));
    assert.ok(p(sc).some((x) => /is 2 deep, past max_depth=1/.test(x)), "the recursion must end at the limit");
    sc.world.issues[1].parent = 99; // a link to an issue the world does not hold: unread
    assert.ok(p(sc).some((x) => /depth that cannot be read/.test(x)));
  });

  test("a split needs two or more linked, unlabelled sub-issues, the marker, and no PR", () => {
    let sc = split(); sc.expect.effects = sc.expect.effects.filter((e) => e.number !== 14); sc.expect.result = "#12 split into #13";
    assert.ok(p(sc).some((x) => /two or more sub-issues/.test(x)));
    sc = split(); delete sc.expect.effects[0].data.parent;
    assert.ok(p(sc).some((x) => /not linked to issue#12/.test(x)));
    sc = split(); sc.expect.effects[0].labels = ["ready-for-agent"];
    assert.ok(p(sc).some((x) => /filed with labels/.test(x)));
    sc = split(); sc.expect.effects = sc.expect.effects.filter((e) => e.op !== "comment");
    assert.ok(p(sc).some((x) => /without an `agent:split` comment/.test(x)));
    sc = split(); sc.expect.effects[2].text = "children=13";
    assert.ok(p(sc).some((x) => /names 13, not 13,14/.test(x)));
    sc = split(); sc.expect.effects.push({ op: "label_remove", target: "issue#12", label: "ready-for-agent" }, { op: "label_add", target: "issue#12", label: "agent:pr-open" });
    assert.ok(p(sc).some((x) => /does not gain agent:pr-open/.test(x)));
    assert.ok(p(sc).some((x) => /keeps ready-for-agent/.test(x)));
    sc = split(); sc.expect.effects.push({ op: "create_pr", number: 40, labels: ["agent:needs-work"], closes: [12] });
    assert.ok(p(sc).some((x) => /opens no PR/.test(x)));
  });

  test("issues are created only by a split, and only under the issue being split", () => {
    const sc = find("implement-github-issue/missing-information-bails-out.yaml");
    sc.expect.effects.push({ op: "create_issue", number: 13, labels: [] });
    assert.ok(p(sc).some((x) => /creates issues but the result is/.test(x)));
    const other = split(); other.expect.effects[0].data.parent = 7;
    assert.ok(p(other).some((x) => /not to issue#12, the issue this run split/.test(x)));
  });

  test("an issue with a trusted split marker is not eligible, and one with a stranger's marker is", () => {
    const sc = find("implement-github-issue/an-already-split-issue-is-skipped.yaml");
    sc.expect.result = "#12 PR #40 opened";
    sc.expect.effects = [{ op: "create_pr", number: 40, labels: ["agent:needs-work"], closes: [12] }];
    assert.ok(p(sc).some((x) => /not eligible \(already split\)/.test(x)));
    sc.world.issues[0].comments[0].trusted = false;
    assert.ok(!p(sc).some((x) => /already split/.test(x)));
  });

  test("a split parent is closed only when every sub-issue is closed as completed", () => {
    const rec = (n) => find(`reconcile-github-issues/${n}`);
    const open = rec("split-parent-with-an-open-sub-issue-is-left-alone.yaml");
    open.expect.results = ["#12 closed: all sub-issues closed"]; open.expect.effects = [{ op: "close", target: "issue#12" }];
    assert.ok(problems(reconcile, open).some((x) => /while sub-issue #14 is open/.test(x)));
    const dropped = rec("split-parent-with-a-rejected-sub-issue-goes-to-a-person.yaml");
    dropped.expect.results = ["#12 closed: all sub-issues closed"]; dropped.expect.effects = [{ op: "close", target: "issue#12" }];
    assert.ok(problems(reconcile, dropped).some((x) => /closed as not planned/.test(x)));
    const unread = rec("split-parent-closes-when-all-sub-issues-close.yaml");
    unread.world.issues = unread.world.issues.filter((i) => i.number === 12);
    assert.ok(problems(reconcile, unread).some((x) => /sub-issues cannot be read/.test(x)));
  });

  test("file-github-issues with a parent never calls the parent a duplicate, and says it is a part of it", () => {
    const file = contractOf("file-github-issues");
    const sc = { name: "x", skill: "file-github-issues", inputs: { parent: 12 }, world: { issues: [{ number: 12, state: "open", labels: [] }], prs: [] },
      expect: { results: ["duplicate of #12 (commented)"], effects: [{ op: "comment", target: "issue#12" }] } };
    assert.ok(problems(file, sc).some((x) => /duplicate of #12, the parent/.test(x)));
    const made = { name: "x", skill: "file-github-issues", inputs: { parent: 12 }, world: { issues: [{ number: 12, state: "open", labels: [] }], prs: [] },
      expect: { results: ["filed #13"], effects: [{ op: "create_issue", number: 13, labels: [], data: { title: "t", body: "Add it." } }] } };
    assert.ok(problems(file, made).some((x) => /does not start with `Part of #12.`/.test(x)));
    made.expect.effects[0].data.body = "Part of #12.\n\nAdd it.";
    assert.deepEqual(problems(file, made).filter((x) => /Part of/.test(x)), []);
  });

  // lease_held=true: only the holder of the lease, for its own item, to an item skill that lists lease_held
  const nested = (call, over = {}) => {
    const sc = find("implement-github-issue/missing-information-bails-out.yaml");
    sc.expect.calls = [call];
    Object.assign(sc, over);
    return problems(contractOf("implement-github-issue"), sc);
  };
  const lend = { skill: "tdd", target: "issue#12", inputs: { lease_held: true } };

  test("lease_held=true is rejected unless the caller holds the lease on that item and the callee takes it", () => {
    // tdd is not in this package's item skills, so it cannot take a lease; the other checks need a callee that can
    assert.ok(nested(lend).some((x) => /not an item skill that lists `lease_held`/.test(x)));
    assert.ok(nested({ ...lend, target: "issue#13" }).some((x) => /for issue#13, but holds the lease on issue#12 only/.test(x)));
    assert.ok(nested({ skill: "tdd", inputs: { lease_held: true } }).some((x) => /without saying which item/.test(x)));
    assert.ok(nested({ skill: "tdd", inputs: { lease_held: "true" } }).some((x) => /without saying which item/.test(x)), "text counts too");
    assert.deepEqual(nested({ skill: "tdd", target: "issue#12", inputs: { lease_held: false } }), []);
    assert.deepEqual(nested({ skill: "tdd" }), []);
  });

  test("a skipped run holds no lease to lend, and a skill with no item holds none either", () => {
    const sc = find("implement-github-issue/live-lease-held-by-another-run-is-skipped.yaml");
    sc.expect.calls = [lend];
    assert.ok(problems(contractOf("implement-github-issue"), sc).some((x) => /a skipped run claimed nothing/.test(x)));
    const rec = find("reconcile-github-issues/stale-lease-is-cleared.yaml");
    rec.expect.calls = [{ skill: "triage-github-issue", target: "issue#1", inputs: { lease_held: true } }];
    assert.ok(problems(reconcile, rec).some((x) => /this skill holds no lease/.test(x)));
  });

  test("a group skill never passes lease_held", () => {
    const grp = contractOf("implement-github-issues");
    const sc = find("implement-github-issues/the-oldest-eligible-issues-fill-the-batch.yaml");
    sc.expect.dispatches[0].inputs.lease_held = true;
    assert.ok(problems(grp, sc).some((x) => /passes lease_held: a group skill holds no lease/.test(x)));
    const run = find("implement-github-issues/the-oldest-eligible-issues-fill-the-batch.yaml");
    run.inputs.lease_held = true;
    assert.ok(problems(grp, run).some((x) => /cannot be given lease_held/.test(x)));
  });

  test("a group forwards max_depth to the item, and only when the run set it", () => {
    const grp = contractOf("implement-github-issues");
    const sc = find("implement-github-issues/the-oldest-eligible-issues-fill-the-batch.yaml");
    sc.inputs.max_depth = 2;
    assert.ok(problems(grp, sc).some((x) => /drops `max_depth`/.test(x)));
    for (const d of sc.expect.dispatches) d.inputs.max_depth = 2;
    assert.deepEqual(problems(grp, sc), []);
  });
}

// ---- structured `allow` entries: the scope is not enough (shepherd-github-pr is the worked example) ----------------------
const handoff = () => find("shepherd-github-pr/green-and-lane-free-hands-off.yaml");
const notAllowed = /is a `\w+` write, but it is not one the contract's `allow` entries permit/;

test("the golden hand-off passes the allow-list, so the contract matches what the scenarios do", () => {
  assert.deepEqual(problems(shepherd, handoff()), []);
});

test("a label the contract does not list is refused, though the skill may write its own PR", () => {
  const sc = handoff();
  sc.expect.effects.push({ op: "label_add", target: "pr#40", label: "wontfix" });
  const found = problems(shepherd, sc).filter((p) => notAllowed.test(p));
  assert.equal(found.length, 1);
  assert.match(found[0], /label_add on pr#40/);
  assert.match(found[0], /label_add `wontfix`/);
  assert.match(found[0], /It allows:.*label_add `agent:ready-for-review`/);
});

test("removing a label the contract does not list is refused", () => {
  const sc = handoff();
  sc.world.prs[0].labels.push("agent:human-merge");
  sc.expect.effects.push({ op: "label_remove", target: "pr#40", label: "agent:human-merge" });
  assert.ok(problems(shepherd, sc).some((p) => notAllowed.test(p)));
});

test("a comment with a marker the contract does not list is refused, and so is one with no marker", () => {
  for (const extra of [{ op: "comment", target: "pr#40", marker: "agent:merged" }, { op: "comment", target: "pr#40" }]) {
    const sc = handoff();
    sc.expect.effects.push(extra);
    assert.ok(problems(shepherd, sc).some((p) => notAllowed.test(p)), JSON.stringify(extra));
  }
});

test("a write to another item is judged by the `other` entries: an unmarked comment is allowed, a label is not", () => {
  const sc = find("shepherd-github-pr/escalates-at-the-attempt-limit.yaml");
  assert.deepEqual(problems(shepherd, sc), [], "the golden scenario comments on the linked issue");
  const marked = structuredClone(sc);
  marked.expect.effects.push({ op: "comment", target: "issue#12", marker: "agent:handoff" });
  assert.ok(problems(shepherd, marked).some((p) => /comment on issue#12.*\bother\b.*not one the contract's `allow`/.test(p)));
  const labelled = structuredClone(sc);
  labelled.expect.effects.push({ op: "label_add", target: "issue#12", label: "ready-for-human" });
  assert.ok(problems(shepherd, labelled).some((p) => /label_add on issue#12.*\bother\b/.test(p)));
});

test("a scope that lists only sentences is still checked by its scope alone", () => {
  const prose = structuredClone(shepherd);
  prose.effects.writes.claimed = ["Some labels and comments."];
  const sc = handoff();
  sc.expect.effects.push({ op: "label_add", target: "pr#40", label: "wontfix" });
  assert.deepEqual(problems(prose, sc).filter((p) => notAllowed.test(p)), []);
});

test("the rerun's effects go through the allow-list too", () => {
  const sc = find("shepherd-github-pr/green-and-lane-free-hands-off.yaml");
  sc.expect.rerun_effects = [{ op: "label_add", target: "pr#40", label: "wontfix" }];
  assert.ok(problems(shepherd, sc).some((p) => /^the rerun's label_add on pr#40 /.test(p) && notAllowed.test(p)));
});

test("globMatches: `*` is the only wildcard, and a dot is a dot", () => {
  assert.ok(globMatches("agent:*", "agent:stuck"));
  assert.ok(globMatches("*", "anything at all"));
  assert.ok(globMatches("ready-for-agent", "ready-for-agent"));
  assert.ok(!globMatches("agent:*", "xagent:stuck"));
  assert.ok(!globMatches("ready-for-agent", "ready-for-agent-2"));
  assert.ok(!globMatches("a.b", "axb"));
  assert.ok(!globMatches("a+", "aa"));
});

test("allowedBy: op, label and marker must all match", () => {
  const ctx = { world: { prs: [{ number: 7, comments: [{ marker: "agent:lease", text: "a" }, { text: "plain" }] }], issues: [] }, claimed: new Set() };
  const label = (l, op = "label_add") => ({ op, target: "pr#7", label: l });
  assert.ok(allowedBy(label("agent:stuck"), [{ op: "label_add", label: "agent:*" }], ctx));
  assert.equal(allowedBy(label("agent:stuck", "label_remove"), [{ op: "label_add", label: "agent:*" }], ctx), null, "the op differs");
  assert.equal(allowedBy(label("wontfix"), [{ op: "label_add", label: "agent:*" }], ctx), null, "the label differs");
  const comment = (marker) => ({ op: "comment", target: "pr#7", ...(marker ? { marker } : {}) });
  assert.ok(allowedBy(comment("agent:handoff"), [{ op: "comment", marker: "agent:*" }], ctx));
  assert.ok(allowedBy(comment(), [{ op: "comment", marker: null }], ctx), "null allows a comment with no marker");
  assert.equal(allowedBy(comment(), [{ op: "comment", marker: "agent:*" }], ctx), null, "a glob does not match no marker");
  assert.equal(allowedBy(comment("agent:handoff"), [{ op: "comment", marker: null }], ctx), null, "null does not allow a marker");
  assert.ok(allowedBy({ op: "push", target: "pr#7" }, [{ op: "push" }], ctx));
  assert.equal(allowedBy({ op: "merge", target: "pr#7" }, [{ op: "push" }], ctx), null);
});

test("a comment edited in place has the marker of the comment it edits", () => {
  const ctx = { world: { prs: [{ number: 7, comments: [{ marker: "agent:lease", text: "a" }, { text: "plain" }] }], issues: [] }, claimed: new Set() };
  const edit = (index) => ({ op: "comment_edit", target: "pr#7", index, text: "b" });
  assert.equal(markerOf(edit(0), ctx), "agent:lease");
  assert.equal(markerOf(edit(1), ctx), null);
  assert.equal(markerOf(edit(5), ctx), undefined);
  assert.ok(allowedBy(edit(0), [{ op: "comment_edit", marker: "agent:lease" }], ctx));
  assert.equal(allowedBy(edit(1), [{ op: "comment_edit", marker: "agent:lease" }], ctx), null, "the plain comment is not the lease");
  assert.equal(allowedBy(edit(5), [{ op: "comment_edit", marker: null }], ctx), null, "a comment that is not there matches nothing, not even `null`");
});

// ---- the item skills are migrated to `allow`: what each skill's text forbids is now caught ---------------------------------
// Each row is a golden scenario plus one effect the skill's own text forbids. A scope-only check accepted every one.
const FORBIDDEN = [
  ["triage-github-issue/open-questions-mean-needs-info.yaml", { op: "label_add", target: "issue#12", label: "wontfix" }, "triage never applies wontfix"],
  ["triage-github-issue/open-questions-mean-needs-info.yaml", { op: "label_add", target: "issue#12", label: "agent:pr-open" }, "triage does not open a PR state"],
  ["triage-github-issue/open-questions-mean-needs-info.yaml", { op: "comment", target: "issue#12", marker: "agent:handoff" }, "a PR handoff marker on an issue"],
  ["triage-github-issue/duplicate-is-closed.yaml", { op: "close", target: "issue#7" }, "only the claimed issue is ever closed"],
  ["triage-github-issue/duplicate-is-closed.yaml", { op: "label_add", target: "issue#7", label: "ready-for-agent" }, "no state label on another issue"],
  ["implement-github-issue/existing-open-pr-is-not-duplicated.yaml", { op: "label_add", target: "pr#40", label: "agent:ready-for-review" }, "only agent:needs-work goes on an existing PR"],
  ["implement-github-issue/existing-open-pr-is-not-duplicated.yaml", { op: "merge", target: "pr#40" }, "implementing never merges"],
  ["implement-github-issue/existing-open-pr-is-not-duplicated.yaml", { op: "label_add", target: "issue#12", label: "wontfix" }, "a label the skill never sets"],
  ["review-github-pr/findings-are-sent-back.yaml", { op: "label_add", target: "pr#50", label: "agent:ready-for-review" }, "a sent-back PR does not return to the lane"],
  ["review-github-pr/findings-are-sent-back.yaml", { op: "comment", target: "pr#50" }, "an unmarked comment on the claimed PR"],
  ["review-github-pr/merge-closes-the-linked-issue.yaml", { op: "label_add", target: "issue#12", label: "ready-for-agent" }, "a linked issue is not sent back to the agents"],
  ["review-github-pr/merge-closes-the-linked-issue.yaml", { op: "comment", target: "issue#12", marker: "agent:handoff" }, "a marker on a linked issue"],
];
for (const [file, extra, why] of FORBIDDEN) {
  test(`${file.split("/")[0]}: ${why}`, () => {
    const sc = find(file);
    assert.deepEqual(problems(contractOf(sc.skill), sc), [], "the golden scenario is clean first");
    sc.expect.effects.push(extra);
    assert.ok(problems(contractOf(sc.skill), sc).some((p) => notAllowed.test(p)), JSON.stringify(extra));
  });
}

// ---- `labels` on a create, and the group, sweep and file skills ---------------------------------------------------------
test("allowedBy: a created item may carry only the labels the entry lists", () => {
  const ctx = { world: { issues: [], prs: [] }, claimed: new Set() };
  const made = (labels) => ({ op: "create_issue", number: 9, ...(labels ? { labels } : {}) });
  assert.ok(allowedBy(made(), [{ op: "create_issue", labels: [] }], ctx), "no labels at all");
  assert.ok(allowedBy(made([]), [{ op: "create_issue", labels: [] }], ctx));
  assert.equal(allowedBy(made(["bug"]), [{ op: "create_issue", labels: [] }], ctx), null, "`[]` allows none");
  assert.ok(allowedBy(made(["bug"]), [{ op: "create_issue", labels: ["bug", "enhancement"] }], ctx));
  assert.equal(allowedBy(made(["bug", "wontfix"]), [{ op: "create_issue", labels: ["bug"] }], ctx), null, "every label must be listed");
  assert.ok(allowedBy(made(["agent:stuck"]), [{ op: "create_issue", labels: ["agent:*"] }], ctx));
  assert.ok(allowedBy({ op: "create_pr", number: 3, labels: ["agent:needs-work"] }, [{ op: "create_pr", labels: ["agent:needs-work"] }], ctx));
  assert.equal(allowedBy({ op: "create_pr", number: 3, labels: ["agent:needs-work", "x"] }, [{ op: "create_pr", labels: ["agent:needs-work"] }], ctx), null);
});

test("an issue filed with a label, or a PR opened with the wrong one, is refused", () => {
  const filed = find("file-github-issues/limit-defers-the-rest.yaml");
  filed.expect.effects[0].labels = ["ready-for-agent"];
  const found = problems(contractOf("file-github-issues"), filed).filter((p) => notAllowed.test(p));
  assert.equal(found.length, 1);
  assert.match(found[0], /create_issue with only `ready-for-agent`/);
  assert.match(found[0], /It allows:.*create_issue with no labels/);
  const pr = find("implement-github-issue/an-interrupted-pass-does-not-open-a-second-pr.yaml");
  const made = pr.expect.effects.find((e) => e.op === "create_pr");
  if (made) { made.labels = ["agent:ready-for-review"]; assert.ok(problems(contractOf("implement-github-issue"), pr).some((p) => notAllowed.test(p))); }
});

const FORBIDDEN_3 = [
  ["file-github-issues/a-duplicate-gets-a-comment.yaml", { op: "label_add", target: "issue#7", label: "wontfix" }, "filing never labels an existing issue"],
  ["file-github-issues/a-duplicate-gets-a-comment.yaml", { op: "comment", target: "issue#7", marker: "agent:handoff" }, "evidence comments carry no marker"],
  ["file-github-issues/a-duplicate-gets-a-comment.yaml", { op: "close", target: "issue#7" }, "filing closes nothing"],
  ["reconcile-github-issues/merged-pr-closes-the-issue.yaml", { op: "label_add", target: "issue#12", label: "wontfix" }, "reconcile never applies wontfix"],
  ["reconcile-github-issues/merged-pr-closes-the-issue.yaml", { op: "label_remove", target: "issue#12", label: "needs-triage" }, "reconcile leaves needs-triage to triage"],
  ["reconcile-github-issues/stale-lease-is-cleared.yaml", { op: "comment", target: "issue#13", marker: "agent:lease" }, "reconcile writes no lease"],
  ["reconcile-github-issues/stale-lease-is-cleared.yaml", { op: "label_add", target: "issue#13", label: "agent:triage" }, "reconcile never claims an issue"],
];
for (const [file, extra, why] of FORBIDDEN_3) {
  test(`${file.split("/")[0]}: ${why}`, () => {
    const sc = find(file);
    assert.deepEqual(problems(contractOf(sc.skill), sc), [], "the golden scenario is clean first");
    sc.expect.effects.push(extra);
    assert.ok(problems(contractOf(sc.skill), sc).some((p) => notAllowed.test(p)), JSON.stringify(extra));
  });
}

test("setup-github-agent-workflow: it writes labels and one file, and pushes nothing", () => {
  const sc = find("setup-github-agent-workflow/an-empty-repository-gets-every-label.yaml");
  assert.deepEqual(problems(contractOf(sc.skill), sc), [], "the golden scenario is clean first");
  sc.expect.effects.push({ op: "push", target: "pr#1" });
  assert.ok(problems(contractOf(sc.skill), sc).some((p) => notAllowed.test(p)));
});

test("a group skill's one write is an unmarked run-log comment, and nothing else", () => {
  const ctx = { world: { issues: [{ number: 40, state: "open", labels: ["agent:log"], comments: [] }], prs: [] }, claimed: new Set() };
  for (const skill of ["triage-github-issues", "implement-github-issues", "review-github-prs", "shepherd-github-prs"]) {
    const writes = contractOf(skill).effects.writes;
    assert.deepEqual(Object.keys(writes), ["shared"], skill);
    const allows = allowsOf(writes.shared);
    assert.ok(allowedBy({ op: "comment", target: "issue#40" }, allows, ctx), `${skill}: the log entry`);
    assert.equal(allowedBy({ op: "comment", target: "issue#40", marker: "agent:handoff" }, allows, ctx), null, `${skill}: a marker`);
    assert.equal(allowedBy({ op: "label_add", target: "issue#40", label: "agent:log" }, allows, ctx), null, `${skill}: a label`);
    assert.equal(allowedBy({ op: "close", target: "issue#40" }, allows, ctx), null, `${skill}: a close`);
  }
});

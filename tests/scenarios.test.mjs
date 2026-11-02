import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { extractContract } from "../scripts/contracts.mjs";
import { coverage } from "../scripts/scenario-coverage.mjs";
import { checkScenario, applyEffects, matchesReturn, checkState, ORACLES } from "../scripts/scenario.mjs";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");
const contractOf = (skill) => {
  const body = readFileSync(join(PKG, "skills/pipeline", skill, "SKILL.md"), "utf8");
  return parse(extractContract(body).yaml);
};
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

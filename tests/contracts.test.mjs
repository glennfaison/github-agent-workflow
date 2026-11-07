import { test } from "node:test";
import assert from "node:assert/strict";
import { checkContracts, extractContract, resultHead, headings, purity } from "../scripts/contracts.mjs";

const ITEM = `kind: item
step: Triaging
target: { param: issue, type: issue }
params: [issue, runner]
requires: ["The issue is open."]
returns: ["#N done", "#N escalated: <reason>", "#N skipped: <reason>", "#N failed: <reason>"]
ensures: ["The lease is released."]
effects:
  reads: [the issue]
  writes:
    claimed: ["A label."]
never: ["Touch code."]
calls: []
idempotent: "A labelled issue is ineligible."
terminates: "One pass."`;

const GROUP = `kind: group
step: Triaging
params: [runner]
dispatches: do-it
requires: ["None."]
returns: ["nothing eligible"]
ensures: ["One log entry."]
effects:
  reads: [open issues]
  writes:
    shared: ["One run-log entry."]
never: ["Claim an issue."]
calls: []
idempotent: "Yes."
terminates: "One pass."`;

const INPUTS = "## Inputs\n\n| Input | Default | What |\n|---|---|---|\n| `issue` | *(required)* | x |\n| `runner` | `unknown` | y |\n";
const skill = (name, yaml, rest = "", inputKeys = ["issue", "runner"]) => ({
  name, rel: `skills/pipeline/${name}`, bucket: "pipeline", userInvoked: false, inputKeys,
  body: `# ${name}\n\n## Contract\n\n\`\`\`yaml\n${yaml}\n\`\`\`\n\n${INPUTS}\n${rest}`,
});
const run = (skills, extra = [], pending = new Set()) => {
  const all = [...skills, ...extra];
  return checkContracts(skills, new Map(all.map((s) => [s.name, s])), new Set(["tdd"]), { pending }).errors;
};
const item = (yaml = ITEM, rest = "", keys) => skill("do-it", yaml, rest, keys);

test("a well-formed item contract has no problems", () => {
  assert.deepEqual(run([item()]), []);
});

test("a group dispatching an item of the same step is fine", () => {
  assert.deepEqual(run([skill("do-them", GROUP, "", ["runner"]), item()]), []);
});

test("a dispatched item that writes the run log must accept write_log", () => {
  const logging = ITEM.replace('claimed: ["A label."]', 'claimed: ["A label."]\n    shared: ["One run-log entry."]');
  const errs = run([skill("do-them", GROUP, "", ["runner"]), item(logging)]);
  assert.ok(errs.some((e) => /no `write_log` param/.test(e)));
  const ok = logging.replace("[issue, runner]", "[issue, runner, write_log]");
  assert.deepEqual(run([skill("do-them", GROUP, "", ["runner"]), item(ok, "", ["issue", "runner", "write_log"])]), []);
});

test("a precondition may not call a helper that writes", () => {
  const bad = ITEM.replace('["The issue is open."]', '["After `clear_stale_lease N issue`, it is not leased."]');
  assert.ok(run([item(bad)]).some((e) => /mentions `clear_stale_lease`, which writes/.test(e)));
});

test("extractContract finds the yaml block and ignores later fences", () => {
  const found = extractContract(item().body);
  assert.match(found.yaml, /^kind: item/);
  assert.equal(extractContract("# x\n\n## Inputs\n"), null);
});

test("a missing contract is reported", () => {
  const s = { ...item(), body: "# x\n\n## Inputs\n" };
  assert.match(run([s])[0], /no `## Contract`/);
});

test("invalid YAML is reported, not thrown", () => {
  assert.match(run([item("kind: [item")])[0], /invalid YAML/);
});

test("params must equal the Inputs table", () => {
  const errs = run([item(ITEM.replace("[issue, runner]", "[issue, bogus]"))]);
  assert.ok(errs.some((e) => /missing `runner`/.test(e)));
  assert.ok(errs.some((e) => /has `bogus`/.test(e)));
});

test("an unknown key is reported", () => {
  assert.ok(run([item(ITEM + "\nmagic: 1")]).some((e) => /unknown key `magic`/.test(e)));
});

test("a required key is reported when missing", () => {
  assert.ok(run([item(ITEM.replace(/^never:.*$/m, ""))]).some((e) => /missing `never`/.test(e)));
});

test("an item result must be a `#N` line and include skipped and failed", () => {
  const errs = run([item(ITEM.replace(', "#N skipped: <reason>"', ""))]);
  assert.ok(errs.some((e) => /no `#N skipped/.test(e)));
  assert.ok(run([item(ITEM.replace('"#N done"', '"done"'))]).some((e) => /must look like/.test(e)));
});

test("a skill that cites escalate.md must be able to return escalated", () => {
  const noEscalated = ITEM.replace('"#N escalated: <reason>", ', "");
  const errs = run([item(noEscalated, "Follow `references/escalate.md`.\n")]);
  assert.ok(errs.some((e) => /can escalate/.test(e)));
});

test("a result the text returns must be in returns", () => {
  const errs = run([item(ITEM, "Return `#N exploded: oops`.\n")]);
  assert.ok(errs.some((e) => /`#N exploded: oops`, which is not in `returns`/.test(e)));
  assert.deepEqual(run([item(ITEM, "Return `#N done`, or `#N <outcome>`.\n")]), []);
});

test("a prose section the contract replaces is reported", () => {
  for (const h of ["Eligibility", "Outputs", "Result", "Never", "Context read", "Success criteria"]) {
    assert.ok(run([item(ITEM, `## ${h}\n\ntext\n`)]).some((e) => e.includes(`\`## ${h}\``)), h);
  }
});

test("a group skill cannot claim, and an item skill with a target must", () => {
  const claiming = GROUP.replace("    shared:", "    claimed: [\"x\"]\n    shared:");
  assert.ok(run([skill("do-them", claiming, "", ["runner"]), item()]).some((e) => /only an item skill claims/.test(e)));
  const noClaim = ITEM.replace(/    claimed: \["A label."\]/, "    shared: [\"A log.\"]");
  assert.ok(run([item(noClaim)]).some((e) => /needs `effects.writes.claimed`/.test(e)));
});

test("a sweep skill needs no target or dispatch, but cannot claim", () => {
  const SWEEP = GROUP.replace("kind: group", "kind: sweep").replace("dispatches: do-it\n", "");
  assert.deepEqual(run([skill("tidy", SWEEP, "", ["runner"])]), []);
  assert.ok(run([skill("tidy", SWEEP + "\ndispatches: do-it", "", ["runner"])]).some((e) => /only a group skill dispatches/.test(e)));
  const claiming = SWEEP.replace("    shared:", "    claimed: [\"x\"]\n    shared:");
  assert.ok(run([skill("tidy", claiming, "", ["runner"])]).some((e) => /only an item skill claims/.test(e)));
});

test("an unknown write scope is reported", () => {
  assert.ok(run([item(ITEM.replace("claimed:", "everywhere:"))]).some((e) => /scope `everywhere`/.test(e)));
});

test("calls: an unknown or user-invoked skill is reported, and a skill the text calls must be listed", () => {
  assert.ok(run([item(ITEM.replace("calls: []", "calls: [ghost]"))]).some((e) => /calls `ghost`/.test(e)));
  const setup = { name: "setup", rel: "skills/meta/setup", userInvoked: true, body: "" };
  assert.ok(run([item(ITEM.replace("calls: []", "calls: [setup]"))], [setup]).some((e) => /user-invoked/.test(e)));
  assert.deepEqual(run([item(ITEM.replace("calls: []", "calls: [tdd]"), "Call the Skill tool with `tdd`.\n")]), []);
  assert.ok(run([item(ITEM, "Call the Skill tool with `tdd`.\n")]).some((e) => /does not list it/.test(e)));
  assert.deepEqual(run([item(ITEM, "Call the Skill tool with `agent-workflow-protocol`.\n")]), []);
});

test("a group must dispatch an item skill of its own step", () => {
  const other = skill("do-it", ITEM.replace("step: Triaging", "step: Reviewing"));
  assert.ok(run([skill("do-them", GROUP, "", ["runner"]), other]).some((e) => /belongs to Reviewing/.test(e)));
  assert.ok(run([skill("do-them", GROUP.replace("do-it", "nope"), "", ["runner"])]).some((e) => /not a skill in this package/.test(e)));
});

test("resultHead and headings", () => {
  assert.equal(resultHead("#N PR #P opened"), "PR");
  assert.equal(resultHead("#N skipped: <reason>"), "skipped");
  assert.equal(resultHead("filed #N"), null);
  assert.deepEqual(headings("## A\n### b\n## `C`\n"), ["A", "C"]);
});

// ---- utility and reference skills (ADR 0013) -----------------------------------------------------

const UTIL = `kind: utility
params: [pr]
used_by: [do-it]
requires: ["The PR exists."]
returns: ["A verdict: PASS, CAUTION or BLOCK.", "Sections: Compatibility, Reversibility, Verdict."]
ensures: ["Nothing was written."]
effects:
  reads: [the PR diff]
  writes: {}
never: ["Merge the PR."]
calls: []
idempotent: "It only reads."
terminates: "One pass."`;
const CALLER = ITEM.replace("calls: []", "calls: [check-it]");
const util = (yaml = UTIL, keys = ["pr"], extra = {}) => ({ ...skill("check-it", yaml, "", keys), ...extra });
const REFERENCE = "kind: reference";
const ref = (yaml = REFERENCE) => skill("the-guide", yaml, "", []);

test("a well-formed utility skill, called by an item skill that lists it, has no problems", () => {
  assert.deepEqual(run([item(CALLER), util()]), []);
});

test("a utility skill needs no step, but a step it has must be one of the five", () => {
  assert.deepEqual(run([item(CALLER), util(UTIL + "\nstep: Reviewing")]), []);
  assert.ok(run([item(CALLER), util(UTIL + "\nstep: Nowhere")]).some((e) => /step must be one of/.test(e)));
  assert.ok(run([item(ITEM.replace("step: Triaging\n", ""))]).some((e) => /missing `step`/.test(e)), "an item skill still needs a step");
});

test("a utility skill must have every other key of an item skill, and used_by", () => {
  for (const k of ["params", "requires", "returns", "ensures", "effects", "never", "calls", "idempotent", "terminates", "used_by"]) {
    const without = UTIL.split("\n").filter((l) => !l.startsWith(`${k}:`)).join("\n");
    const errs = run([item(CALLER), util(k === "effects" ? without.replace(/^  .*$/gm, "") : without)]);
    assert.ok(errs.some((e) => e.includes(`missing \`${k}\``)), k);
  }
});

test("only a utility skill has used_by", () => {
  assert.ok(run([item(ITEM + "\nused_by: [x]")]).some((e) => /only a utility skill has `used_by`/.test(e)));
});

test("a utility skill returns a document, not `#N` lines", () => {
  const errs = run([item(CALLER), util(UTIL.replace('"A verdict: PASS, CAUTION or BLOCK."', '"#N done"'))]);
  assert.ok(errs.some((e) => /is an item result/.test(e)));
});

test("a utility skill takes a pr or an issue without having to claim it", () => {
  const withTarget = UTIL + "\ntarget: { param: pr, type: pull request }";
  assert.deepEqual(run([item(CALLER), util(withTarget)]), []);
  const claiming = UTIL.replace("writes: {}", 'writes:\n    claimed: ["A label."]');
  assert.ok(run([item(CALLER), util(claiming)]).some((e) => /only an item skill claims/.test(e)));
});

test("a utility skill that writes nothing is pure, and `effects.writes` may be empty", () => {
  assert.deepEqual(run([item(CALLER), util()]), []);
  assert.ok(run([item(CALLER), util(UTIL.replace("writes: {}", "writes: []"))]).some((e) => /`effects.writes` must be a mapping/.test(e)));
});

test("purity: pure, claimed, writes elsewhere, and reference", () => {
  assert.equal(purity({ kind: "utility", effects: { writes: {} } }), "pure");
  assert.equal(purity({ kind: "item", effects: { writes: { claimed: ["x"] } } }), "claimed");
  assert.equal(purity({ kind: "item", effects: { writes: { claimed: ["x"], shared: ["y"] } } }), "writes elsewhere");
  for (const scope of ["repository", "other", "shared"]) assert.equal(purity({ kind: "sweep", effects: { writes: { [scope]: ["x"] } } }), "writes elsewhere", scope);
  assert.equal(purity({ kind: "reference" }), "reference");
  assert.equal(purity({ kind: "item" }), null);
  assert.equal(purity(undefined), null);
});

test("purity reads the contracts that checkContracts returns", () => {
  const { contracts } = checkContracts([item(CALLER), util()], new Map([["do-it", item(CALLER)], ["check-it", util()]]), new Set());
  assert.equal(purity(contracts.get("check-it")), "pure");
  assert.equal(purity(contracts.get("do-it")), "claimed");
});

test("a reference skill says `kind: reference` and nothing else", () => {
  assert.deepEqual(run([ref()]), []);
  const errs = run([ref(REFERENCE + "\nreturns: [\"x\"]\neffects: { reads: [x], writes: {} }")]);
  assert.ok(errs.some((e) => /only `kind`, not `returns`/.test(e)));
  assert.ok(errs.some((e) => /only `kind`, not `effects`/.test(e)));
});

test("a reference skill needs no params, results or scenarios, whatever its Inputs table lists", () => {
  assert.deepEqual(run([skill("the-guide", REFERENCE, "## Process\n\nRead it.\n", ["issue", "runner"])]), []);
});

test("a reference skill may carry the prose sections a contract replaces", () => {
  assert.deepEqual(run([skill("the-guide", REFERENCE, "## Result\n\ntext\n", [])]), []);
});

test("a skill without a contract is reported, unless it is pending", () => {
  const bare = { name: "bare", rel: "skills/utility/bare", bucket: "utility", userInvoked: false, inputKeys: [], body: "# bare\n" };
  assert.ok(run([bare]).some((e) => /no `## Contract`/.test(e)));
  assert.deepEqual(run([bare], [], new Set(["bare"])), []);
});

test("a pending skill that has a contract must leave the pending list", () => {
  assert.ok(run([item(CALLER), util()], [], new Set(["check-it"])).some((e) => /must leave the pending list/.test(e)));
});

test("a skill that calls a skill without a contract is reported, unless it is pending", () => {
  const bare = { name: "check-it", rel: "skills/utility/check-it", bucket: "utility", userInvoked: false, inputKeys: [], body: "# check-it\n" };
  assert.ok(run([item(CALLER), bare]).some((e) => /calls `check-it`, which has no `## Contract`/.test(e)));
  assert.deepEqual(run([item(CALLER)], [bare], new Set(["check-it"])), []);
});

test("calling a skill from elsewhere needs no contract here", () => {
  assert.deepEqual(run([item(ITEM.replace("calls: []", "calls: [tdd]"), "Call the Skill tool with `tdd`.\n")]), []);
});

test("a utility skill's used_by must list the skills that call it", () => {
  const errs = run([item(CALLER), util(UTIL.replace("used_by: [do-it]", "used_by: [other]"))], [{ name: "other", rel: "skills/pipeline/other", userInvoked: false, body: "" }]);
  assert.ok(errs.some((e) => /calls `check-it`, but its `used_by` does not list `do-it`/.test(e)));
});

test("everything in used_by must exist, have a contract and call the skill", () => {
  const unknown = run([item(CALLER), util(UTIL.replace("[do-it]", "[do-it, ghost]"))]);
  assert.ok(unknown.some((e) => /used_by `ghost`, which is not a skill in this package/.test(e)));
  const silent = run([item(), util()]);
  assert.ok(silent.some((e) => /used_by `do-it`, but `do-it` does not list `check-it` in `calls`/.test(e)));
  const bare = { name: "bare", rel: "skills/utility/bare", bucket: "utility", userInvoked: false, inputKeys: [], body: "# bare\n" };
  assert.ok(run([item(CALLER), util(UTIL.replace("[do-it]", "[do-it, bare]"))], [bare]).some((e) => /used_by `bare`, which has no `## Contract`/.test(e)));
  assert.deepEqual(run([item(CALLER), util(UTIL.replace("[do-it]", "[do-it, bare]"))], [bare], new Set(["bare"])), []);
  const guide = ref();
  assert.ok(run([item(CALLER), util(UTIL.replace("[do-it]", "[do-it, the-guide]")), guide]).some((e) => /used_by `the-guide`, which is reference material/.test(e)));
});

test("a utility skill that no one calls says so, unless a person runs it", () => {
  assert.ok(run([item(), util(UTIL.replace("[do-it]", "[]"))]).some((e) => /`used_by` is empty/.test(e)));
  const byHand = util(UTIL.replace("[do-it]", "[]"), ["pr"], { userInvoked: true });
  assert.deepEqual(run([byHand]), []);
  const wrong = util(UTIL, ["pr"], { userInvoked: true });
  assert.ok(run([item(CALLER), wrong]).some((e) => /user-invoked, so no skill can call it/.test(e)));
});

test("a utility skill that calls another utility skill closes the loop too", () => {
  const outer = util(UTIL.replace("calls: []", "calls: [inner]"));
  const inner = { ...skill("inner", UTIL.replace("[do-it]", "[check-it]"), "", ["pr"]) };
  assert.deepEqual(run([item(CALLER), outer, inner]), []);
  const unlisted = { ...skill("inner", UTIL.replace("[do-it]", "[do-it]"), "", ["pr"]) };
  assert.ok(run([item(CALLER), outer, unlisted]).some((e) => /calls `inner`, but its `used_by` does not list `check-it`/.test(e)));
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { checkContracts, extractContract, resultHead, headings } from "../scripts/contracts.mjs";

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
const run = (skills, extra = []) => {
  const all = [...skills, ...extra];
  return checkContracts(skills, new Map(all.map((s) => [s.name, s])), new Set(["tdd"])).errors;
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

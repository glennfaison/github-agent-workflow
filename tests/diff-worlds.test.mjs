import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { WRITE_SCOPES } from "../scripts/contracts.mjs";
import { contractOf } from "../scripts/scenario-coverage.mjs";
import { applyEffects, canonicalWorld, checkScenario, diffWorlds, sameWorld } from "../scripts/scenario.mjs";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");
const round = (before, after) => applyEffects(before, diffWorlds(before, after));
const W = () => ({
  default_branch: "main",
  issues: [{ number: 1, state: "open", labels: ["ready-for-agent"], comments: [{ marker: "agent:lease", text: "x", author: "bot" }] }, { number: 2, state: "open", labels: [], comments: [] }],
  prs: [{ number: 10, state: "open", labels: ["agent:needs-work"], draft: false, head: "h1", base: "main", checks: ["pass"], openFindings: 0, closes: [1], comments: [] }],
});
const edit = (fn) => { const w = W(); fn(w); return w; };

// ---- one test per op --------------------------------------------------------------------------------

test("two equal worlds have no effects", () => {
  assert.deepEqual(diffWorlds(W(), W()), []);
});

test("label_add and label_remove", () => {
  const after = edit((w) => { w.issues[0].labels = ["agent:pr-open"]; });
  assert.deepEqual(diffWorlds(W(), after), [
    { op: "label_remove", target: "issue#1", label: "ready-for-agent" },
    { op: "label_add", target: "issue#1", label: "agent:pr-open" },
  ]);
});

test("labels are a set: order does not matter, and a label added then removed is not an effect", () => {
  const before = edit((w) => { w.issues[0].labels = ["a", "b"]; });
  const after = edit((w) => { w.issues[0].labels = ["b", "a"]; });
  assert.deepEqual(diffWorlds(before, after), []);
  const net = applyEffects(W(), [{ op: "label_add", target: "issue#2", label: "x" }, { op: "label_remove", target: "issue#2", label: "x" }]);
  assert.deepEqual(diffWorlds(W(), net), []);
});

test("comment, with its marker and text", () => {
  const after = edit((w) => { w.prs[0].comments.push({ marker: "agent:handoff", text: "done", author: "bot", trusted: true }); });
  assert.deepEqual(diffWorlds(W(), after), [{ op: "comment", target: "pr#10", marker: "agent:handoff", text: "done" }]);
  const bare = edit((w) => { w.prs[0].comments.push({ marker: "agent:x" }); });
  assert.deepEqual(diffWorlds(W(), bare), [{ op: "comment", target: "pr#10", marker: "agent:x" }]);
});

test("a lease label and the agent:lease marker are ordinary effects", () => {
  const after = edit((w) => { w.issues[1].labels.push("agent:triage"); w.issues[1].comments.push({ marker: "agent:lease", text: "lease" }); });
  assert.deepEqual(diffWorlds(W(), after), [
    { op: "label_add", target: "issue#2", label: "agent:triage" },
    { op: "comment", target: "issue#2", marker: "agent:lease", text: "lease" },
  ]);
});

test("close, for an issue and a PR", () => {
  assert.deepEqual(diffWorlds(W(), edit((w) => { w.issues[0].state = "closed"; })), [{ op: "close", target: "issue#1" }]);
  assert.deepEqual(diffWorlds(W(), edit((w) => { w.prs[0].state = "closed"; })), [{ op: "close", target: "pr#10" }]);
});

test("merge is pinned to the head, and a push before it is a push", () => {
  assert.deepEqual(diffWorlds(W(), edit((w) => { w.prs[0].state = "merged"; })), [{ op: "merge", target: "pr#10", sha: "h1" }]);
  const both = edit((w) => { w.prs[0].state = "merged"; w.prs[0].head = "h2"; });
  assert.deepEqual(diffWorlds(W(), both), [{ op: "push", target: "pr#10", sha: "h2" }, { op: "merge", target: "pr#10", sha: "h2" }]);
});

test("push, and delete_branch", () => {
  assert.deepEqual(diffWorlds(W(), edit((w) => { w.prs[0].head = "h2"; })), [{ op: "push", target: "pr#10", sha: "h2" }]);
  assert.deepEqual(diffWorlds(W(), edit((w) => { w.prs[0].branchDeleted = true; })), [{ op: "delete_branch", target: "pr#10" }]);
  assert.deepEqual(diffWorlds(W(), edit((w) => { w.prs[0].branchDeleted = false; })), []);
});

test("create_issue, with its labels, comments and state", () => {
  const after = edit((w) => { w.issues.push({ number: 3, state: "closed", labels: ["bug"], comments: [{ marker: "m", text: "t" }] }); });
  assert.deepEqual(diffWorlds(W(), after), [
    { op: "create_issue", number: 3, labels: ["bug"] },
    { op: "comment", target: "issue#3", marker: "m", text: "t" },
    { op: "close", target: "issue#3" },
  ]);
});

test("create_pr, with its labels, head, base and closes", () => {
  const pr = { number: 11, state: "open", labels: ["agent:needs-work"], draft: false, head: "n1", base: "develop", checks: [], openFindings: 0, closes: [2], comments: [] };
  assert.deepEqual(diffWorlds(W(), edit((w) => { w.prs.push(pr); })), [
    { op: "create_pr", number: 11, labels: ["agent:needs-work"], sha: "n1", base: "develop", closes: [2] },
  ]);
});

test("review_request leaves no trace in a world, so a diff has none", () => {
  assert.deepEqual(diffWorlds(W(), applyEffects(W(), [{ op: "review_request", target: "pr#10" }])), []);
});

// ---- unmodelled -------------------------------------------------------------------------------------

const unmodelled = (before, after) => diffWorlds(before, after).filter((e) => e.op === "unmodelled").map((e) => `${e.target} ${e.field}`);

test("a change no op can express is reported as unmodelled, with both values", () => {
  assert.deepEqual(diffWorlds(W(), edit((w) => { w.issues[0].title = "new"; })), [
    { op: "unmodelled", target: "issue#1", field: "title", before: undefined, after: "new" },
  ]);
});

test("unmodelled: fields, comments, state, branches, removals, new items and the world itself", () => {
  assert.deepEqual(unmodelled(W(), edit((w) => { w.prs[0].checks = ["fail"]; })), ["pr#10 checks"]);
  assert.deepEqual(unmodelled(W(), edit((w) => { w.prs[0].draft = true; })), ["pr#10 draft"]);
  assert.deepEqual(unmodelled(W(), edit((w) => { w.prs[0].base = "develop"; })), ["pr#10 base"]);
  assert.deepEqual(unmodelled(W(), edit((w) => { w.issues[0].comments[0].text = "edited"; })), ["issue#1 comments"]);
  assert.deepEqual(unmodelled(W(), edit((w) => { w.issues[0].comments = []; })), ["issue#1 comments"]);
  assert.deepEqual(unmodelled(edit((w) => { w.issues[0].state = "closed"; }), W()), ["issue#1 state"]);
  assert.deepEqual(unmodelled(W(), edit((w) => { w.issues[0].state = "merged"; })), ["issue#1 state"]);
  assert.deepEqual(unmodelled(edit((w) => { w.prs[0].state = "merged"; }), edit((w) => { w.prs[0].state = "closed"; })), ["pr#10 state"]);
  assert.deepEqual(unmodelled(edit((w) => { w.prs[0].branchDeleted = true; }), W()), ["pr#10 branchDeleted"]);
  assert.deepEqual(unmodelled(W(), edit((w) => { w.issues.pop(); })), ["issue#2 (removed)"]);
  assert.deepEqual(unmodelled(W(), edit((w) => { w.default_branch = "develop"; })), ["world default_branch"]);
  assert.deepEqual(unmodelled(W(), edit((w) => { w.prs[0].head = undefined; })), ["pr#10 head"]);
  const draft = edit((w) => { w.prs.push({ number: 11, state: "open", labels: [], draft: true, head: "n", base: "main", checks: [], openFindings: 0, closes: [], comments: [] }); });
  assert.deepEqual(unmodelled(W(), draft), ["pr#11 draft"]);
});

test("who wrote a comment is not an effect, and neither is the run's own `pushed` flag", () => {
  assert.deepEqual(diffWorlds(W(), edit((w) => { w.issues[0].comments[0].author = "human"; w.issues[0].comments[0].trusted = true; })), []);
  assert.deepEqual(diffWorlds(W(), edit((w) => { w.prs[0].pushed = true; })), []);
});

test("checkScenario rejects an unmodelled effect unless the contract lists the scope", () => {
  const contract = { kind: "item", target: { param: "issue" }, returns: ["#N done", "#N skipped: <reason>"], effects: { writes: { claimed: ["x"] } }, calls: [] };
  const sc = { skill: "x", target: "issue#1", world: W(), expect: { result: "#1 done", effects: [{ op: "unmodelled", target: "issue#1", field: "title", before: "a", after: "b" }] } };
  assert.ok(checkScenario(contract, sc).some((m) => /changed `title` of issue#1, which the checker cannot model/.test(m)));
  const allowed = { ...contract, effects: { writes: { claimed: ["x"], unmodelled: ["Rewrites the title."] } } };
  assert.deepEqual(checkScenario(allowed, sc), []);
  assert.ok(WRITE_SCOPES.includes("unmodelled"));
});

// ---- the round trip: every golden scenario ----------------------------------------------------------

const dir = join(PKG, "tests/scenarios");
const goldens = readdirSync(dir).flatMap((skill) =>
  readdirSync(join(dir, skill)).filter((f) => f.endsWith(".yaml")).map((f) => ({ file: `${skill}/${f}`, sc: parse(readFileSync(join(dir, skill, f), "utf8")) })));

test("there are golden scenarios to round-trip", () => assert.ok(goldens.length > 30));

for (const { file, sc } of goldens) {
  test(`round trip: ${file}`, () => {
    const before = sc.world ?? { issues: [], prs: [] };
    const after = applyEffects(before, sc.expect.effects ?? []);
    const diff = diffWorlds(before, after);
    assert.deepEqual(diff.filter((e) => e.op === "unmodelled"), []);
    assert.ok(sameWorld(applyEffects(before, diff), after), "applyEffects(before, diff) is not after");
    // the diff of a run says what the golden says: the checker finds the same (no) problems in it
    const again = { ...sc, expect: { ...sc.expect, effects: diff } };
    assert.deepEqual(checkScenario(contractOf(sc.skill), again), checkScenario(contractOf(sc.skill), sc));
  });
}

// ---- the round trip: generated worlds -----------------------------------------------------------------

function rng(seed) { // mulberry32: small, seeded, and the same on every machine
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = (r, xs) => xs[Math.floor(r() * xs.length)];
const LABELS = ["needs-info", "ready-for-agent", "ready-for-human", "agent:pr-open", "agent:needs-work", "agent:ready-for-review", "agent:triage", "bug"];
const MARKERS = ["agent:lease", "agent:handoff", "agent:outcome", undefined];

function randomWorld(r) {
  const labels = () => LABELS.filter(() => r() < 0.25);
  const comments = () => Array.from({ length: Math.floor(r() * 3) }, (_, i) => ({ marker: pick(r, MARKERS), text: `t${i}${Math.floor(r() * 9)}`, author: pick(r, ["bot", "human"]) }));
  const w = { default_branch: "main", issues: [], prs: [] };
  for (let n = 1; n <= 1 + Math.floor(r() * 4); n++) w.issues.push({ number: n, state: pick(r, ["open", "open", "closed"]), labels: labels(), comments: comments(), keepOpen: r() < 0.2 });
  for (let n = 1; n <= 1 + Math.floor(r() * 4); n++) w.prs.push({ number: n, state: pick(r, ["open", "open", "closed", "merged"]), labels: labels(), draft: r() < 0.2, head: `h${n}`, base: "main", checks: pick(r, [[], ["pass"], ["fail"]]), openFindings: Math.floor(r() * 3), closes: r() < 0.5 ? [1] : [], comments: comments(), mergeState: pick(r, ["CLEAN", "DIRTY", "BEHIND"]) });
  return w;
}

/** One random effect that is possible in `w`, or null. Run-changing ops only touch open items. */
function randomEffect(r, w) {
  const items = [...w.issues.map((i) => ["issue", i]), ...w.prs.map((p) => ["pr", p])];
  const [kind, it] = pick(r, items);
  const target = `${kind}#${it.number}`;
  const open = it.state === "open";
  const next = (xs) => 1 + Math.max(0, ...xs.map((x) => x.number));
  switch (Math.floor(r() * 9)) {
    case 0: return { op: "label_add", target, label: pick(r, LABELS) };
    case 1: return it.labels?.length ? { op: "label_remove", target, label: pick(r, it.labels) } : null;
    case 2: return { op: "comment", target, marker: pick(r, MARKERS), text: `c${Math.floor(r() * 99)}` };
    case 3: return open ? { op: "close", target } : null;
    case 4: return open && kind === "pr" ? { op: "push", target, sha: `p${Math.floor(r() * 99)}` } : null;
    case 5: return open && kind === "pr" ? { op: "merge", target, sha: it.head } : null;
    case 6: return kind === "pr" ? { op: "delete_branch", target } : null;
    case 7: return { op: "create_issue", number: next(w.issues), labels: LABELS.filter(() => r() < 0.2) };
    default: return { op: "create_pr", number: next(w.prs), labels: LABELS.filter(() => r() < 0.2), sha: `n${Math.floor(r() * 99)}`, closes: r() < 0.5 ? [1] : [] };
  }
}

test("round trip on 300 generated worlds: effects, then diff, give the same world back", () => {
  const r = rng(20260507);
  for (let i = 0; i < 300; i++) {
    const before = randomWorld(r);
    let after = before;
    const effects = [];
    for (let k = Math.floor(r() * 7); k > 0; k--) {
      const e = randomEffect(r, after);
      if (!e) continue;
      after = applyEffects(after, [e]);
      effects.push(e);
    }
    const diff = diffWorlds(before, after);
    const why = `world ${i}: ${JSON.stringify(effects)}`;
    assert.deepEqual(diff.filter((e) => e.op === "unmodelled"), [], why);
    assert.ok(sameWorld(applyEffects(before, diff), after), why);
    assert.equal(sameWorld(before, after), diff.length === 0, why);
  }
});

function mutate(r, w) {
  const out = structuredClone(w);
  const items = [...out.issues.map((i) => ["issue", i]), ...out.prs.map((p) => ["pr", p])];
  const [kind, it] = pick(r, items);
  switch (Math.floor(r() * 12)) {
    case 0: it.labels = [...(it.labels ?? []), pick(r, LABELS)]; break;
    case 1: it.labels = (it.labels ?? []).slice(1); break;
    case 2: it.comments = [...(it.comments ?? []), { marker: pick(r, MARKERS), text: "new" }]; break;
    case 3: if (it.comments?.length) it.comments[0].text = "edited"; break;
    case 4: it.comments = (it.comments ?? []).slice(1); break;
    case 5: it.state = pick(r, ["open", "closed", "merged"]); break;
    case 6: if (kind === "pr") it.head = `m${Math.floor(r() * 99)}`; break;
    case 7: if (kind === "pr") it.draft = !it.draft; break;
    case 8: it.title = "retitled"; break;
    case 9: (kind === "pr" ? out.prs : out.issues).splice(Math.floor(r() * 2), 1); break;
    case 10: out[kind === "pr" ? "prs" : "issues"].push({ number: 50 + Math.floor(r() * 9), state: pick(r, ["open", "closed"]), labels: [pick(r, LABELS)], comments: [] }); break;
    default: out.default_branch = "develop";
  }
  return out;
}

test("on 300 generated pairs, nothing is silently dropped: a diff without `unmodelled` round-trips, and any difference shows", () => {
  const r = rng(59);
  let modelled = 0, flagged = 0;
  for (let i = 0; i < 300; i++) {
    const before = randomWorld(r);
    let after = before;
    for (let k = 1 + Math.floor(r() * 3); k > 0; k--) after = mutate(r, after);
    const diff = diffWorlds(before, after);
    const why = `pair ${i}: ${JSON.stringify(diff)}`;
    if (diff.some((e) => e.op === "unmodelled")) { flagged++; continue; }
    modelled++;
    assert.ok(sameWorld(applyEffects(before, diff), after), why);
    assert.equal(sameWorld(before, after), diff.length === 0, why);
  }
  assert.ok(modelled > 20 && flagged > 20, `the generator should exercise both paths (${modelled} modelled, ${flagged} flagged)`);
});

test("canonicalWorld ignores order, undefined values and comment authors", () => {
  const a = { issues: [{ number: 2, labels: ["b", "a"] }, { number: 1, comments: [{ marker: "m", text: "t", author: "x" }] }], prs: [] };
  const b = { issues: [{ number: 1, labels: [], comments: [{ marker: "m", text: "t" }], gone: undefined }, { number: 2, labels: ["a", "b"], comments: [] }], prs: [] };
  assert.deepEqual(canonicalWorld(a), canonicalWorld(b));
});

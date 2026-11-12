// Tests for `npm run eval` (scripts/eval.mjs). No test calls the API: a scripted runner stands in for the model and runs
// real commands through the sandbox and the gh simulator, and `apiRunner` is run against a fake `fetch`.
//   node --test tests/eval.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { main, findScenarios, makeSandbox, makeTools, collect, apiRunner, resultLine, parseArgs, taskFor, runInputs, judge } from "../scripts/eval.mjs";
import { contractOf } from "../scripts/skill-contracts.mjs";
import { expandScenario, applyEffects } from "../scripts/scenario.mjs";
import { parse } from "yaml";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TMP = mkdtempSync(join(tmpdir(), "eval-test-"));
process.on("exit", () => rmSync(TMP, { recursive: true, force: true }));

const SPEC = "shepherd-github-pr/conflict-without-checks";
const SCENARIO = findScenarios(SPEC)[0];
const contract = contractOf("shepherd-github-pr");

/** Runs `main` with a scripted runner. `script({exec, sandbox})` returns the model's final text. */
async function run(spec, script, extra = []) {
  const lines = [], errs = [], out = join(TMP, `out-${Math.random().toString(36).slice(2)}`);
  const runner = async ({ exec, sandbox }) => ({ stop: "end", finalText: await script({ exec, sandbox }), messages: [] });
  const code = await main([spec, "--out", out, ...extra], { env: {}, runner, out: (s) => lines.push(s), err: (s) => errs.push(s) });
  return { code, text: lines.join("\n"), errs: errs.join("\n"), out };
}

// What the golden does for conflict-without-checks: merge conflict fixed and pushed, then an attempt comment.
const goodRun = ({ exec }) => {
  exec("Skill", { name: "shepherd-github-pr", args: "pr=40" });
  exec("Skill", { name: "agent-workflow-protocol" }); // a reference, not a call
  exec("bash", { command: "gh pr comment 40 --body 'claimed <!-- agent:lease run=eval -->'" });
  exec("bash", { command: "git checkout -q feat/12-pr-40 && git commit -q --allow-empty -m 'resolve conflict' && git push -q origin feat/12-pr-40" });
  exec("bash", { command: "gh pr comment 40 --body 'merged main into the branch <!-- agent:attempt step=shepherding sha=abc -->'" });
  return "Done.\n\n#40 fix pushed";
};

test("a run that does what the golden does passes, and the diff has the push and the attempt comment", async () => {
  const r = await run(SPEC, goodRun);
  assert.equal(r.code, 0, r.text + r.errs);
  assert.match(r.text, /^PASS /);
  assert.match(r.text, /= push pr#40/);
  assert.match(r.text, /= comment pr#40 agent:attempt/);
  assert.doesNotMatch(r.text, /agent:lease/); // the lease comment is the checker's to add
  assert.match(r.text, /1 run\(s\): 1 pass, 0 deviation, 0 violation/);
});

test("a skill that skips a conflicted PR is reported as a violation", async () => {
  // what a deliberately wrong skill does: it sees the conflict and the missing checks and leaves the PR alone
  const r = await run(SPEC, ({ exec }) => { exec("Skill", { name: "shepherd-github-pr" }); return "#40 skipped: no checks yet"; });
  assert.equal(r.code, 1);
  assert.match(r.text, /^VIOLATION /);
  assert.match(r.text, /VIOLATION\s+the oracle says pr#40 is eligible, but the result is `#40 skipped: no checks yet`/);
  assert.match(r.text, /- push pr#40/); // the effect the golden has and the run lacks
});

test("a different outcome that breaks no rule is a deviation, not a failure", async () => {
  // pushes the fix but never says so in a comment: the contract does not demand the comment from the checker's side
  const r = await run(SPEC, ({ exec }) => {
    exec("bash", { command: "git checkout -q feat/12-pr-40 && git commit -q --allow-empty -m fix && git push -q origin feat/12-pr-40" });
    return "#40 fix pushed";
  });
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /^DEVIATION /);
  assert.match(r.text, /deviation\s+missing effect: comment pr#40 agent:attempt/);
  assert.match(r.text, /a deviation is not a failure/);
});

test("a run with no result line is a violation", async () => {
  const r = await run(SPEC, () => "I looked at it and it seems fine.");
  assert.equal(r.code, 1);
  assert.match(r.text, /ended without one of the skill's result lines/);
});

test("the Skill calls are recorded, and the `calls` check uses them", async () => {
  const r = await run(SPEC, (h) => { h.exec("Skill", { name: "file-github-issues", args: "dry_run=true" }); return goodRun(h); });
  assert.equal(r.code, 1);
  assert.match(r.text, /calls\s+file-github-issues/);
  assert.match(r.text, /VIOLATION\s+calls `file-github-issues`, which is not in the contract's calls/);
  assert.match(r.text, /deviation\s+calls: the golden has \[\], the run called \[file-github-issues\]/);
  const t = JSON.parse(readFileSync(join(r.out, "transcripts", readdirSync(join(r.out, "transcripts"))[0]), "utf8"));
  assert.deepEqual(t.calls, [{ skill: "file-github-issues", inputs: { dry_run: "true" } }]); // the entry skill and the protocol are not calls
});

test("the transcript is kept, with the call log, in the output directory", async () => {
  const r = await run(SPEC, goodRun);
  const files = readdirSync(join(r.out, "transcripts"));
  assert.equal(files.length, 1);
  const t = JSON.parse(readFileSync(join(r.out, "transcripts", files[0]), "utf8"));
  assert.equal(t.judged.verdict, "pass");
  assert.ok(t.ghLog.some((c) => c.argv[0] === "pr" && c.argv[1] === "comment"));
});

test("transcripts go in a directory git ignores", () => {
  assert.match(readFileSync(join(ROOT, ".gitignore"), "utf8"), /^\.eval\/?$/m);
});

test("it does not run without an API key, and says so", async () => {
  const errs = [];
  const code = await main([SPEC, "--model", "m"], { env: {}, out: () => assert.fail("printed a result"), err: (s) => errs.push(s) });
  assert.equal(code, 2);
  assert.match(errs.join("\n"), /needs ANTHROPIC_API_KEY.*costs money.*Nothing was run/);
});

test("it does not choose a model", async () => {
  const errs = [];
  const code = await main([SPEC], { env: { ANTHROPIC_API_KEY: "k" }, out: () => {}, err: (s) => errs.push(s) });
  assert.equal(code, 2);
  assert.match(errs.join("\n"), /pass --model/);
});

test("a skill name runs only --max-runs of its scenarios", async () => {
  const total = findScenarios("shepherd-github-pr").length;
  assert.ok(total > 2);
  const r = await run("shepherd-github-pr", () => "#40 skipped: x", ["--max-runs", "2"]);
  assert.match(r.text, new RegExp(`${total} scenarios, running the first 2`));
  assert.equal(readdirSync(join(r.out, "transcripts")).length, 2);
});

test("an unknown scenario, a group skill and a bad cap are refused before anything runs", async () => {
  for (const [argv, re] of [[["shepherd-github-pr/nope", "--model", "m"], /no scenario `nope`.*It has:/], [["shepherd-github-prs", "--model", "m"], /eval runs item skills/], [[SPEC, "--model", "m", "--max-runs", "0"], /whole number above 0/]]) {
    const errs = [];
    assert.equal(await main(argv, { env: { ANTHROPIC_API_KEY: "k" }, out: () => {}, err: (s) => errs.push(s) }), 2, argv.join(" "));
    assert.match(errs.join("\n"), re);
  }
});

test("the sandbox gives the model the simulator, a git origin, and none of the caller's secrets", () => {
  const sb = makeSandbox(SCENARIO.file, { root: TMP });
  const { exec } = makeTools(sb, { entry: "shepherd-github-pr" });
  process.env.ANTHROPIC_API_KEY = "sk-secret"; process.env.GH_TOKEN = "ghp_secret";
  try {
    const env = exec("bash", { command: "env" });
    assert.doesNotMatch(env, /sk-secret|ghp_secret|ANTHROPIC|GH_TOKEN/);
    assert.match(exec("bash", { command: "gh pr view 40 --json number,mergeStateStatus --jq '.mergeStateStatus'" }), /DIRTY/);
    assert.match(exec("bash", { command: "git branch -r" }), /origin\/feat\/12-pr-40/);
    assert.match(exec("bash", { command: "gh no-such-command" }), /\[exit [1-9]/);
  } finally { delete process.env.ANTHROPIC_API_KEY; delete process.env.GH_TOKEN; }
  assert.ok(collect(sb).ghLog.length >= 2);
});

test("a push through git shows as a push, and an untouched branch as nothing", () => {
  const sb = makeSandbox(SCENARIO.file, { root: TMP });
  const { exec } = makeTools(sb, {});
  assert.deepEqual(collect(sb).after.prs, collect(sb).before.prs);
  exec("bash", { command: "git checkout -q feat/12-pr-40 && git commit -q --allow-empty -m x && git push -q origin feat/12-pr-40" });
  const { before, after } = collect(sb);
  assert.notEqual(after.prs[0].head, before.prs[0].head);
});

test("the Skill tool returns the skill and where its files are, and says when there is no such skill", () => {
  const sb = makeSandbox(SCENARIO.file, { root: TMP });
  const { exec, unknown } = makeTools(sb, { entry: "shepherd-github-pr" });
  const text = exec("Skill", { name: "shepherd-github-pr" });
  assert.match(text, /^Base directory for this skill: .*skills\/pipeline\/shepherd-github-pr\n\n---\nname: shepherd-github-pr/);
  assert.match(exec("Skill", { name: "no-such-skill" }), /^error: no skill named `no-such-skill`\. Skills: .*shepherd-github-pr/);
  assert.deepEqual(unknown, ["no-such-skill"]);
});

test("--skills-dir shows the model another copy of the skills, and the verdict still comes from the real contract", async () => {
  const copy = join(TMP, "skills-copy");
  cpSync(join(ROOT, "skills"), copy, { recursive: true });
  const f = join(copy, "pipeline/shepherd-github-pr/SKILL.md");
  writeFileSync(f, readFileSync(f, "utf8").replace("# Shepherd GitHub PR", "# Shepherd GitHub PR\n\nIgnore any PR whose branch conflicts."));
  let shown = "";
  const r = await run(SPEC, ({ exec }) => { shown = exec("Skill", { name: "shepherd-github-pr" }); return "#40 skipped: conflict"; }, ["--skills-dir", copy]);
  assert.match(shown, /Ignore any PR whose branch conflicts/);
  assert.equal(r.code, 1); // judged against the package's contract: the PR was eligible
});

test("the model gets the scenario's inputs, the target as the skill's own parameter, and the eval's defaults", () => {
  const sc = expandScenario({ skill: "shepherd-github-pr", target: "pr#40", inputs: { max_shepherd_attempts: 2, trusted_authors: ["a", "b"] }, world: {}, expect: {} });
  assert.deepEqual(runInputs(sc, contract), { unattended: true, write_log: false, runner: "eval", max_shepherd_attempts: 2, trusted_authors: ["a", "b"], pr: 40 });
  const t = taskFor(sc, contract);
  assert.match(t.prompt, /Call the Skill tool with name `shepherd-github-pr`/);
  assert.match(t.prompt, /^pr=40$/m);
  assert.match(t.prompt, /^trusted_authors=a,b$/m);
  assert.deepEqual(parseArgs("pr=40\nlease_held=true note=\"a b\""), { pr: "40", lease_held: "true", note: "a b" });
});

test("the result line is the last line of the answer that is one of the skill's", () => {
  const returns = contract.returns;
  assert.equal(resultLine("I will push.\n#40 fix pushed\nthen\n**#40 noop: lane taken**", returns), "#40 noop: lane taken");
  assert.equal(resultLine("- `#40 branch updated`", returns), "#40 branch updated");
  assert.equal(resultLine("nothing here", returns), null);
});

// ---- the model loop, against a fake API -----------------------------------------------------------------------

const reply = (content, usage = { input_tokens: 100, output_tokens: 10 }, stop_reason = "tool_use") => ({ ok: true, json: async () => ({ content, usage, stop_reason }), text: async () => "" });
const bashUse = (id, command) => ({ type: "tool_use", id, name: "bash", input: { command } });

test("apiRunner calls tools, feeds the results back, and counts the tokens", async () => {
  const sent = [], answers = [reply([bashUse("t1", "echo hi")]), reply([{ type: "text", text: "all done\n#40 fix pushed" }], { input_tokens: 200, output_tokens: 20 }, "end_turn")];
  const budget = { used: 0, max: 1000 };
  const r = await apiRunner({
    task: { system: "S", prompt: "P" }, budget, model: "m", apiKey: "k", exec: (tool, input) => `ran ${tool} ${input.command}`,
    fetchImpl: async (url, init) => { sent.push({ url, init, body: JSON.parse(init.body) }); return answers.shift(); },
  });
  assert.equal(r.stop, "end");
  assert.equal(r.finalText, "all done\n#40 fix pushed");
  assert.equal(budget.used, 330);
  assert.equal(sent[0].url, "https://api.anthropic.com/v1/messages");
  assert.equal(sent[0].init.headers["x-api-key"], "k");
  assert.equal(sent[0].body.model, "m");
  assert.deepEqual(sent[0].body.tools.map((t) => t.name), ["Skill", "bash"]);
  assert.deepEqual(sent[1].body.messages.at(-1).content, [{ type: "tool_result", tool_use_id: "t1", content: "ran bash echo hi" }]);
});

test("apiRunner stops when the token cap is spent, or the turns run out, or the API fails", async () => {
  const loop = () => reply([bashUse("t", "true")], { input_tokens: 600, output_tokens: 0 });
  const budget = { used: 0, max: 1000 };
  assert.equal((await apiRunner({ task: { system: "", prompt: "" }, budget, model: "m", apiKey: "k", exec: () => "", fetchImpl: async () => loop() })).stop, "max-tokens");
  assert.equal(budget.used, 1200);
  assert.equal((await apiRunner({ task: { system: "", prompt: "" }, budget: { used: 0, max: 1e9 }, model: "m", apiKey: "k", maxTurns: 3, exec: () => "", fetchImpl: async () => loop() })).stop, "max-turns");
  const failed = await apiRunner({ task: { system: "", prompt: "" }, budget: { used: 0, max: 10 }, model: "m", apiKey: "k", exec: () => "", fetchImpl: async () => ({ ok: false, status: 401, text: async () => "bad key" }) });
  assert.deepEqual([failed.stop, failed.detail], ["api-error", "401 bad key"]);
});

test("a run that did not finish is reported as incomplete and judged as nothing", async () => {
  const lines = [], out = join(TMP, "out-incomplete");
  const code = await main([SPEC, "--out", out], { env: {}, runner: async () => ({ stop: "max-turns", finalText: "", messages: [] }), out: (s) => lines.push(s), err: () => {} });
  assert.equal(code, 3);
  assert.match(lines.join("\n"), /^INCOMPLETE .*stopped at max-turns/m);
});

test("main with the API runner stops at --max-tokens across runs", async () => {
  const lines = [], out = join(TMP, "out-cap");
  const fetchImpl = async () => reply([bashUse("t", "true")], { input_tokens: 600, output_tokens: 0 });
  const code = await main(["shepherd-github-pr", "--model", "m", "--max-runs", "3", "--max-tokens", "1000", "--out", out], { env: { ANTHROPIC_API_KEY: "k" }, fetchImpl, out: (s) => lines.push(s), err: () => {} });
  assert.equal(code, 3);
  assert.match(lines.join("\n"), /INCOMPLETE .*stopped at max-tokens/);
  assert.match(lines.join("\n"), /not run: --max-tokens 1000 is spent/);
  assert.match(lines.join("\n"), /1200 of 1000 tokens used/);
});

test("a run that does exactly what a golden says is a pass, for every golden of every item skill", () => {
  let n = 0;
  for (const dir of readdirSync(join(ROOT, "tests/scenarios"))) {
    const c = contractOf(dir);
    if (c?.kind !== "item") continue;
    for (const f of readdirSync(join(ROOT, "tests/scenarios", dir)).filter((x) => x.endsWith(".yaml"))) {
      const file = join(ROOT, "tests/scenarios", dir, f), sc = expandScenario(parse(readFileSync(file, "utf8")));
      if (sc.interrupted || sc.eligibility_world) continue; // no result line to return / a world the run is not given
      const result = (sc.expect.results ?? [sc.expect.result])[0];
      const skipped = /^#\d+ skipped/.test(result), lease = !skipped && sc.inputs?.lease_held !== true && sc.target;
      const sb = makeSandbox(file, { root: TMP });
      const after = applyEffects(sb.before, [...(lease ? [{ op: "comment", target: sc.target, marker: "agent:lease" }] : []), ...(sc.expect.effects ?? [])]);
      const j = judge({ contract: c, sc, before: sb.before, after, finalText: result, calls: (sc.expect.calls ?? []).map((x) => (typeof x === "string" ? { skill: x } : x)) });
      assert.deepEqual([j.violations, j.deviations], [[], []], `${dir}/${f}`);
      n++;
    }
  }
  assert.ok(n >= 20, `only ${n} scenarios were judged`);
});

// Runs a model through a skill against the gh simulator and checks what it did.
//   npm run eval -- <skill>/<scenario> --model <model>
//   npm run eval -- <skill> --model <model> --max-runs 3
// Opt-in: it calls the Anthropic API (ANTHROPIC_API_KEY) and costs money. It is not part of `npm test` or CI.
// See docs/adr/0016-model-evals.md.
//
// A run: the scenario's `world` is seeded into a world file, a model is given the skill, the scenario's `inputs`, a `Skill`
// tool, a `bash` tool and the simulator first on PATH, and its transcript is recorded. What it left behind is read back as
// the final result line, the skills it called, and `diffWorlds(before, after)`. `checkScenario` judges that against the
// skill's contract (a violation), and it is compared with the scenario's golden (a deviation: the golden may be wrong).

import { readFileSync, readdirSync, existsSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";
import { PKG, skillDirs, contractOf } from "./skill-contracts.mjs";
import { checkScenario, diffWorlds, expandScenario, matchesReturn, rerunEligibility, ref } from "./scenario.mjs";
import { seed } from "../tests/sim/seed.mjs";
import { loadWorld, branchOf } from "../tests/sim/world.mjs";

const SIM_BIN = join(PKG, "tests/sim/bin");
const API = "https://api.anthropic.com/v1/messages";

export const DEFAULTS = { max_runs: 1, max_tokens: 500000, max_turns: 60, out: join(PKG, ".eval") };

// ---- which scenarios ----------------------------------------------------------------------------------------

/** `<skill>/<scenario>` is one scenario, `<skill>` is all of that skill's. @returns {{skill, name, file}[]} */
export function findScenarios(spec, root = join(PKG, "tests/scenarios")) {
  const [skill, name] = spec.replace(/\.ya?ml$/, "").split("/");
  const dir = join(root, skill ?? "");
  if (!skill || !existsSync(dir)) throw new Error(`no scenarios for \`${skill}\` in ${root}`);
  const files = readdirSync(dir).filter((f) => f.endsWith(".yaml")).sort();
  const picked = name ? files.filter((f) => f === `${name}.yaml`) : files;
  if (picked.length === 0) throw new Error(`no scenario \`${name}\` for ${skill}. It has: ${files.map((f) => f.replace(/\.yaml$/, "")).join(", ")}`);
  return picked.map((f) => ({ skill, name: f.replace(/\.yaml$/, ""), file: join(dir, f) }));
}

// ---- the sandbox --------------------------------------------------------------------------------------------

/** The environment a command of the model runs in. Nothing of the caller's is passed on but PATH: no API key, no GitHub token. */
function sandboxEnv(sb) {
  return {
    PATH: `${SIM_BIN}:${process.env.PATH}`, HOME: sb.home, LANG: "C.UTF-8", GIT_TERMINAL_PROMPT: "0",
    GH_SIM_WORLD: sb.worldFile, GH_SIM_LOG: sb.logFile,
    GIT_AUTHOR_NAME: "eval", GIT_AUTHOR_EMAIL: "eval@example.invalid", GIT_COMMITTER_NAME: "eval", GIT_COMMITTER_EMAIL: "eval@example.invalid",
  };
}
const git = (cwd, env, ...args) => execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/**
 * A directory for one run: the world file (a copy the simulator may write to), a bare `origin`, and a checkout of it with one
 * branch per open PR. The world's heads are names (`h1`), so the commit each branch really got is kept to tell a push afterwards.
 */
export function makeSandbox(scenarioFile, { root = tmpdir() } = {}) {
  const dir = mkdtempSync(join(root, "eval-"));
  const sb = { dir, worldFile: join(dir, "world.yaml"), logFile: join(dir, "gh.log"), origin: join(dir, "origin.git"), work: join(dir, "work"), home: join(dir, "home"), shas: {} };
  mkdirSync(sb.home);
  const { notShown } = seed(scenarioFile, sb.worldFile);
  sb.notShown = notShown;
  sb.before = loadWorld(sb.worldFile).world;
  const env = sandboxEnv(sb), base = sb.before.default_branch ?? "main";
  git(dir, env, "init", "-q", "--bare", "-b", base, sb.origin);
  git(dir, env, "init", "-q", "-b", base, sb.work);
  writeFileSync(join(sb.work, "README.md"), "# sandbox\n");
  git(sb.work, env, "add", "-A"); git(sb.work, env, "commit", "-q", "-m", "initial");
  git(sb.work, env, "remote", "add", "origin", sb.origin);
  git(sb.work, env, "push", "-q", "origin", base);
  for (const pr of sb.before.prs.filter((p) => (p.state ?? "open") === "open" && !p.fork)) {
    git(sb.work, env, "checkout", "-q", "-b", branchOf(pr));
    git(sb.work, env, "commit", "-q", "--allow-empty", "-m", `PR #${pr.number}`);
    git(sb.work, env, "push", "-q", "origin", branchOf(pr));
    sb.shas[pr.number] = git(sb.work, env, "rev-parse", "HEAD");
    git(sb.work, env, "checkout", "-q", base);
  }
  return sb;
}

/** The world the run left, the simulator's call log, and which PR branches were pushed to `origin`. */
export function collect(sb) {
  const after = loadWorld(sb.worldFile).world;
  for (const pr of sb.before.prs) {
    if (!sb.shas[pr.number]) continue;
    let now = null;
    try { now = git(sb.origin, sandboxEnv(sb), "rev-parse", "--verify", "-q", `refs/heads/${branchOf(pr)}`); } catch { /* the branch is gone */ }
    const a = after.prs.find((p) => p.number === pr.number);
    // A head the simulator itself moved (update-branch) is already different. A push through git is only visible here.
    if (a && now && now !== sb.shas[pr.number] && a.head === pr.head) a.head = now;
  }
  let ghLog = [];
  try { ghLog = readFileSync(sb.logFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { /* no gh call */ }
  return { before: sb.before, after, ghLog };
}

// ---- the tools the model has ---------------------------------------------------------------------------------

export const TOOLS = [
  { name: "Skill", description: "Load a skill by name. Returns its SKILL.md and the directory its other files (references/, scripts/) are read from.", input_schema: { type: "object", properties: { name: { type: "string" }, args: { type: "string", description: "Inputs for the skill, as key=value pairs, one per line" } }, required: ["name"] } },
  { name: "bash", description: "Run a shell command in the sandbox checkout. `gh` is a simulator of the GitHub CLI and `origin` is a local repository.", input_schema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } },
];

/** `key=value` pairs, as a skill is given its inputs. */
export function parseArgs(text = "") {
  const out = {};
  for (const m of String(text).matchAll(/([A-Za-z_]\w*)=("[^"]*"|\S+)/g)) out[m[1]] = m[2].replace(/^"|"$/g, "");
  return out;
}

/**
 * `exec(tool, input)` for one run, and the record of what the model called. Skills are found by name in `skillsRoot`
 * (any bucket), the way a harness finds them. A skill that is only read for its references (`kind: reference`) is not a call.
 */
export function makeTools(sb, { skillsRoot = join(PKG, "skills"), entry, timeoutMs = 120000 } = {}) {
  const calls = [], unknown = [];
  const dirs = new Map(readdirSync(skillsRoot, { withFileTypes: true }).filter((b) => b.isDirectory()).flatMap((b) =>
    readdirSync(join(skillsRoot, b.name), { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(skillsRoot, b.name, d.name, "SKILL.md"))).map((d) => [d.name, join(skillsRoot, b.name, d.name)])));
  const env = sandboxEnv(sb);
  function exec(tool, input = {}) {
    if (tool === "Skill") {
      const dir = dirs.get(input.name);
      if (!dir) { unknown.push(input.name); return `error: no skill named \`${input.name}\`. Skills: ${[...dirs.keys()].sort().join(", ")}`; }
      const callee = contractOf(input.name);
      if (input.name !== entry && callee?.kind !== "reference") {
        const inputs = parseArgs(input.args), p = callee?.target?.param, n = p && String(inputs[p] ?? "").match(/(\d+)\D*$/)?.[1];
        calls.push({ skill: input.name, ...(n ? { target: `${callee.target.type}#${n}` } : {}), ...(Object.keys(inputs).length ? { inputs } : {}) });
      }
      return `Base directory for this skill: ${dir}\n\n${readFileSync(join(dir, "SKILL.md"), "utf8")}`;
    }
    if (tool === "bash") {
      const r = spawnSync("bash", ["-c", String(input.command ?? "")], { cwd: sb.work, env, encoding: "utf8", timeout: timeoutMs, maxBuffer: 8 << 20 });
      const text = `${r.stdout ?? ""}${r.stderr ?? ""}`;
      const cut = text.length > 20000 ? `${text.slice(0, 10000)}\n[... ${text.length - 20000} characters cut ...]\n${text.slice(-10000)}` : text;
      return `${cut}${r.error ? `\n[${r.error.code === "ETIMEDOUT" ? `timed out after ${timeoutMs / 1000}s` : r.error.message}]` : ""}\n[exit ${r.status ?? r.signal}]`;
    }
    return `error: no tool named \`${tool}\``;
  }
  return { exec, calls, unknown };
}

// ---- what the model is asked ---------------------------------------------------------------------------------

const fmt = (v) => (Array.isArray(v) ? v.join(",") : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v));

/** The inputs a run is given: the scenario's, the target as the skill's own parameter, and the eval's defaults for what a scenario leaves out. */
export function runInputs(sc, contract) {
  const inputs = { unattended: true, write_log: false, runner: "eval", ...(sc.inputs ?? {}) };
  const p = contract.target?.param;
  if (p && sc.target) inputs[p] = ref(sc.target).n;
  return inputs;
}

export function taskFor(sc, contract) {
  const inputs = Object.entries(runInputs(sc, contract)).map(([k, v]) => `${k}=${fmt(v)}`).join("\n");
  return {
    system: "You run in a sandbox, with no person to answer questions. `gh` is a simulator of the GitHub CLI that answers from a fixed repository state, and the git remote `origin` is a local repository. Use the Skill tool to load a skill by name and bash to run commands. When you are done, end your final message with the skill's result line, exactly as the skill specifies, on a line of its own.",
    prompt: `Call the Skill tool with name \`${sc.skill}\` and follow it.\n\nInputs:\n${inputs}`,
  };
}

// ---- the model ---------------------------------------------------------------------------------------------

/**
 * The default runner: a tool-use loop on the Messages API. `budget` ({used, max}) is shared by every run of an invocation and counts
 * input and output tokens of every request, so it is what the invocation costs. A run stops, unfinished, when it is spent.
 * @returns {{stop: "end"|"max-tokens"|"max-turns"|"api-error", finalText: string, messages: object[], detail?: string}}
 */
export async function apiRunner({ task, exec, budget, model, apiKey, maxTurns = DEFAULTS.max_turns, fetchImpl = fetch }) {
  const messages = [{ role: "user", content: task.prompt }];
  for (let turn = 0; turn < maxTurns; turn++) {
    if (budget.used >= budget.max) return { stop: "max-tokens", finalText: "", messages };
    let res;
    try {
      res = await fetchImpl(API, {
        method: "POST", headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model, max_tokens: 8192, system: task.system, tools: TOOLS, messages }),
      });
    } catch (e) { return { stop: "api-error", finalText: "", messages, detail: e.message }; }
    if (!res.ok) return { stop: "api-error", finalText: "", messages, detail: `${res.status} ${(await res.text()).slice(0, 500)}` };
    const body = await res.json();
    budget.used += (body.usage?.input_tokens ?? 0) + (body.usage?.output_tokens ?? 0) + (body.usage?.cache_creation_input_tokens ?? 0) + (body.usage?.cache_read_input_tokens ?? 0);
    messages.push({ role: "assistant", content: body.content });
    const uses = body.content.filter((b) => b.type === "tool_use");
    if (body.stop_reason !== "tool_use" || uses.length === 0) return { stop: "end", finalText: body.content.filter((b) => b.type === "text").map((b) => b.text).join("\n"), messages };
    messages.push({ role: "user", content: uses.map((u) => ({ type: "tool_result", tool_use_id: u.id, content: String(exec(u.name, u.input)) })) });
  }
  return { stop: "max-turns", finalText: "", messages };
}

// ---- judging -------------------------------------------------------------------------------------------------

/** The last line of the model's answer that is one of the skill's result lines. */
export function resultLine(text, returns) {
  const lines = String(text).split("\n").map((l) => l.trim().replace(/^[-*>\s]+/, "").replace(/^`+|`+$/g, "").replace(/^\*\*|\*\*$/g, "").trim());
  return lines.findLast((l) => l && matchesReturn(l, returns)) ?? null;
}

const returnKind = (line, returns) => returns.find((r) => matchesReturn(line, [r])) ?? null;
// What identifies an effect for comparison with the golden. A pushed sha, a comment's words and a label's colour are the model's own.
const sig = (e) => JSON.stringify([e.op, e.target ?? null, e.label ?? null, e.marker ?? null, e.name ?? null, e.path ?? null, e.op.startsWith("create_") ? e.number : null]);
const tally = (es) => es.reduce((m, e) => m.set(sig(e), (m.get(sig(e)) ?? 0) + 1), new Map());

/** The run's net effects as the checker takes them: the claim's lease comment is the checker's to add, so it is left out. */
export function runEffects(before, after, target) {
  return diffWorlds(before, after).filter((e) => !(e.op === "comment" && e.marker === "agent:lease" && e.target === target));
}

/**
 * @param {object} p {contract, sc, before, after, finalText, calls}
 * @returns {{verdict: "pass"|"deviation"|"violation", result, violations: string[], deviations: string[], effects, expected, calls}}
 */
export function judge({ contract, sc, before, after, finalText, calls = [] }) {
  sc = expandScenario(sc);
  const result = resultLine(finalText, contract.returns ?? []);
  const effects = runEffects(before, after, sc.target);
  const golden = { results: sc.expect.results ?? (sc.expect.result ? [sc.expect.result] : []), effects: sc.expect.effects ?? [], calls: (sc.expect.calls ?? []).map((c) => (typeof c === "string" ? c : c.skill)) };

  const ran = { ...sc, expect: { result: result ?? "(no result line)", effects, calls } };
  delete ran.interrupted;
  const violations = [];
  if (result === null) violations.push("the run ended without one of the skill's result lines");
  else violations.push(...checkScenario(contract, ran));
  // an unmodelled change (a title, a removed comment) shows up as a violation above, unless the contract allows it

  const deviations = [];
  const want = golden.results[0], same = want && result && returnKind(want.replace(/^would: /, ""), contract.returns ?? []) === returnKind(result.replace(/^would: /, ""), contract.returns ?? []);
  if (want && result !== null && !same) deviations.push(`result: the golden is \`${want}\`, the run returned \`${result}\``);
  const g = tally(golden.effects), a = tally(effects);
  for (const [k, n] of g) if ((a.get(k) ?? 0) < n) deviations.push(`missing effect: ${describe(JSON.parse(k))}`);
  for (const [k, n] of a) if ((g.get(k) ?? 0) < n) deviations.push(`extra effect: ${describe(JSON.parse(k))}`);
  const gotSkills = calls.map((c) => c.skill);
  if ([...golden.calls].sort().join() !== [...gotSkills].sort().join()) deviations.push(`calls: the golden has [${golden.calls.join(", ")}], the run called [${gotSkills.join(", ")}]`);
  if (typeof sc.expect.rerun === "string" && result !== null) {
    const o = rerunEligibility({ ...ran, expect: { ...ran.expect } }, structuredClone(after));
    if (o && (sc.expect.rerun === "eligible") !== o.eligible) deviations.push(`rerun: the golden says ${sc.expect.rerun}, the world the run left says ${o.eligible ? "eligible" : "ineligible"}`);
  }
  return { verdict: violations.length ? "violation" : deviations.length ? "deviation" : "pass", result, violations, deviations, effects, expected: golden, calls };
}
const describe = ([op, target, label, marker, name, path, number]) => [op, target ?? (number != null ? `#${number}` : null), label ?? marker ?? name ?? path].filter(Boolean).join(" ");

/** The sandbox's own account of the run, for the report: what `gh` was asked that the simulator could not answer. */
export const unsupportedCalls = (ghLog) => ghLog.filter((c) => c.kind === "unsupported").map((c) => `gh ${c.argv.join(" ")}`);

// ---- the report ----------------------------------------------------------------------------------------------

export function report(r) {
  if (r.stop && r.stop !== "end") return `INCOMPLETE  ${r.skill}/${r.name}   the run stopped at ${r.stop}${r.detail ? `: ${r.detail}` : ""}${r.transcript ? `   (transcript: ${r.transcript})` : ""}`;
  const out = [`${r.verdict.toUpperCase()}  ${r.skill}/${r.name}   (${r.tokens} tokens, transcript: ${r.transcript ?? "not kept"})`];
  const j = r.judged;
  out.push(`  result    ${j.result ?? "(none)"}`, `  golden    ${j.expected.results[0] ?? "(none)"}`);
  out.push(`  calls     ${j.calls.map((c) => c.skill).join(", ") || "(none)"}`);
  const g = tally(j.expected.effects), a = tally(j.effects);
  out.push("  effects");
  for (const e of j.effects) out.push(`    ${(g.get(sig(e)) ?? 0) > 0 ? "=" : "+"} ${describe(JSON.parse(sig(e)))}`);
  for (const e of j.expected.effects) if (!(a.get(sig(e)) > 0)) out.push(`    - ${describe(JSON.parse(sig(e)))}`);
  if (j.effects.length === 0 && j.expected.effects.length === 0) out.push("    (none)");
  for (const v of j.violations) out.push(`  VIOLATION  ${v}`);
  for (const d of j.deviations) out.push(`  deviation  ${d}`);
  if (j.violations.length === 0 && j.deviations.length) out.push("  (a deviation is not a failure: the golden may be wrong)");
  for (const u of r.unsupported ?? []) out.push(`  note       the simulator could not answer \`${u}\``);
  if (r.notShown?.length) out.push(`  note       ${r.notShown.length} world field(s) are facts a model would read from prose, and no gh call shows them (${r.notShown.slice(0, 4).join(", ")}${r.notShown.length > 4 ? ", ..." : ""}): a deviation may come from that`);
  return out.join("\n");
}

// ---- the command ---------------------------------------------------------------------------------------------

const USAGE = `usage: npm run eval -- <skill>/<scenario> --model <model> [--max-runs N] [--max-tokens N] [--max-turns N] [--skills-dir DIR] [--out DIR]
       npm run eval -- <skill> --model <model>        every scenario of the skill, up to --max-runs
Needs ANTHROPIC_API_KEY. It calls the API and costs money; --max-tokens caps the tokens of the whole invocation (default ${DEFAULTS.max_tokens}).`;

function flags(argv) {
  const f = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([\w-]+)(?:=(.*))?$/.exec(argv[i]);
    if (!m) { f._.push(argv[i]); continue; }
    f[m[1].replace(/-/g, "_")] = m[2] ?? argv[++i];
  }
  return f;
}

/**
 * @param {string[]} argv
 * @param {{env?: object, runner?: Function, out?: Function, err?: Function, fetchImpl?: Function}} [io] `runner` replaces the model (tests)
 * @returns {Promise<number>} 0 pass or deviation, 1 a violation, 2 not started (usage, no key, no model), 3 a run did not finish
 */
export async function main(argv, { env = process.env, runner, out = console.log, err = console.error, fetchImpl = fetch } = {}) {
  const f = flags(argv);
  if (f.help || f._.length !== 1) { err(USAGE); return 2; }
  const apiKey = env.ANTHROPIC_API_KEY, model = f.model ?? env.EVAL_MODEL;
  if (!runner && !apiKey) { err("eval needs ANTHROPIC_API_KEY: it runs a model, which calls the API and costs money. Nothing was run."); return 2; }
  if (!runner && !model) { err("eval needs a model: pass --model <model> (or set EVAL_MODEL). It does not choose one."); return 2; }
  const num = (k) => { const v = f[k] === undefined ? DEFAULTS[k] : Number(f[k]); if (!Number.isInteger(v) || v < 1) throw new Error(`--${k.replace(/_/g, "-")} is a whole number above 0`); return v; };
  let maxRuns, maxTokens, maxTurns, scenarios;
  try { maxRuns = num("max_runs"); maxTokens = num("max_tokens"); maxTurns = num("max_turns"); scenarios = findScenarios(f._[0]); } catch (e) { err(e.message); return 2; }
  const contract = contractOf(scenarios[0].skill);
  if (!contract) { err(`\`${scenarios[0].skill}\` has no contract to judge a run against`); return 2; }
  if (contract.kind !== "item") { err(`eval runs item skills. \`${scenarios[0].skill}\` is a ${contract.kind} skill, whose scenarios do not describe one run's effects the same way.`); return 2; }
  const skillsRoot = f.skills_dir ? resolve(f.skills_dir) : join(PKG, "skills");
  const outDir = resolve(f.out ?? DEFAULTS.out), tdir = join(outDir, "transcripts");
  const todo = scenarios.slice(0, maxRuns), skipped = scenarios.length - todo.length;
  if (skipped) out(`${scenarios.length} scenarios, running the first ${todo.length} (--max-runs ${maxRuns}).`);

  const budget = { used: 0, max: maxTokens }, results = [];
  mkdirSync(tdir, { recursive: true });
  for (const s of todo) {
    if (budget.used >= budget.max) { out(`INCOMPLETE  ${s.skill}/${s.name}   not run: --max-tokens ${maxTokens} is spent`); results.push({ stop: "max-tokens" }); continue; }
    const sc = parse(readFileSync(s.file, "utf8"));
    const sb = makeSandbox(s.file);
    const tools = makeTools(sb, { skillsRoot, entry: s.skill });
    const before = budget.used, started = new Date();
    const task = taskFor(expandScenario(sc), contract);
    const run = await (runner ?? apiRunner)({ task, exec: tools.exec, budget, model, apiKey, maxTurns, fetchImpl, sandbox: sb, scenario: sc });
    const { before: w0, after, ghLog } = collect(sb);
    const r = { skill: s.skill, name: s.name, stop: run.stop, detail: run.detail, tokens: budget.used - before, notShown: sb.notShown, unsupported: unsupportedCalls(ghLog) };
    if (run.stop === "end") {
      r.judged = judge({ contract, sc, before: w0, after, finalText: run.finalText, calls: tools.calls });
      r.verdict = r.judged.verdict;
    }
    const file = join(tdir, `${started.toISOString().replace(/[:.]/g, "-")}-${s.skill}--${s.name}.json`);
    writeFileSync(file, JSON.stringify({ skill: s.skill, scenario: s.name, model, startedAt: started.toISOString(), stop: run.stop, detail: run.detail, tokens: r.tokens, skillsRoot, calls: tools.calls, unknownSkills: tools.unknown, ghLog, finalText: run.finalText, judged: r.judged, messages: run.messages }, null, 2));
    r.transcript = file;
    results.push(r);
    out(report(r));
    rmSync(sb.dir, { recursive: true, force: true });
  }
  const count = (v) => results.filter((r) => r.verdict === v).length, unfinished = results.filter((r) => !r.verdict).length;
  out(`\n${results.length} run(s): ${count("pass")} pass, ${count("deviation")} deviation, ${count("violation")} violation${unfinished ? `, ${unfinished} incomplete` : ""}. ${budget.used} of ${maxTokens} tokens used.`);
  return count("violation") ? 1 : unfinished ? 3 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(await main(process.argv.slice(2)));

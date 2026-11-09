// The `gh` simulator: answers `gh` calls from a world file instead of GitHub. See docs/adr/0014-gh-simulator.md.
//
//   GH_SIM_WORLD  the world file (required): a bare world or a scenario file, in the scenarios' format
//   GH_SIM_LOG    a file every call is appended to, one JSON object per line (optional)
//   GH_SIM_NOW    an ISO time to use as "now" (optional; a test sets it)
//
// A command, flag or --json field the simulator does not cover exits 1 with `unsupported: <what>`.

import { appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { SURFACE } from "./surface.mjs";
import { SimError, unsupported, loadWorld, contextOf, view, commentsOf, checksOf, runId, branchOf, createdAt, GH_FIELDS, MODELLED } from "./world.mjs";

// ---- arguments ---------------------------------------------------------------------------------------------

const JSON_FLAGS = { "--json": { takes: true }, "--jq": { short: "-q", takes: true } };
const REPO_FLAG = { "--repo": { short: "-R", takes: true } };

/** Reads `argv` against the flags a command supports. Any other flag is `unsupported`. */
function parseArgs(command, argv, flags) {
  const byShort = new Map(Object.entries(flags).filter(([, f]) => f.short).map(([name, f]) => [f.short, name]));
  const out = { flags: {}, pos: [] };
  for (let i = 0; i < argv.length; i++) {
    let tok = argv[i], inline;
    if (tok.startsWith("--") && tok.includes("=")) [tok, inline] = [tok.slice(0, tok.indexOf("=")), tok.slice(tok.indexOf("=") + 1)];
    const name = tok.startsWith("--") ? tok : byShort.get(tok);
    if (tok.startsWith("-") && tok !== "-" && !name) throw unsupported(`${command} ${tok}`);
    if (!name) { out.pos.push(tok); continue; }
    const spec = flags[name];
    if (!spec) throw unsupported(`${command} ${tok}`);
    const key = name.slice(2);
    if (!spec.takes) { out.flags[key] = true; continue; }
    const value = inline ?? argv[++i];
    if (value === undefined) throw new SimError(`flag needs an argument: ${name}`);
    if (spec.multi) (out.flags[key] ??= []).push(...value.split(","));
    else out.flags[key] = value;
  }
  return out;
}

const numberArg = (command, a) => {
  if (a.pos.length !== 1) throw unsupported(`${command} without exactly one number`);
  const m = /^#?(\d+)$/.exec(a.pos[0]);
  if (!m) throw unsupported(`${command} ${a.pos[0]} (only a number is supported)`);
  return Number(m[1]);
};

function checkRepo(ctx, a) {
  const r = a.flags.repo;
  if (r !== undefined && r.replace(/^.*github\.com\//, "") !== ctx.nameWithOwner) throw new SimError(`GraphQL: Could not resolve to a Repository with the name '${r}'. (repository)`);
}

// ---- output ------------------------------------------------------------------------------------------------

/** What `gh --jq` prints for one result: a string as it is, null as nothing, a whole number without a point. */
function jqText(v) {
  if (typeof v === "string") return v;
  if (v === null) return "";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

function printJson(value, a) {
  if (a.flags.jq !== undefined) {
    const r = spawnSync("jq", ["-c", a.flags.jq], { input: JSON.stringify(value), encoding: "utf8" });
    if (r.error) throw new SimError("the gh simulator needs jq on PATH for --jq", { code: 2 });
    if (r.status !== 0) throw new SimError(r.stderr.trim() || "jq failed");
    return r.stdout.split("\n").filter(Boolean).map((l) => jqText(JSON.parse(l))).join("\n") + (r.stdout.trim() ? "\n" : "");
  }
  return JSON.stringify(value) + "\n";
}

/** Checks the --json fields against `gh`'s own list, then against what the world can show. */
function fieldsOf(command, a, kind) {
  if (a.flags.jq !== undefined && a.flags.json === undefined) throw new SimError("cannot use `--jq` without specifying `--json`");
  if (a.flags.json === undefined) return null;
  const fields = a.flags.json.split(",").filter(Boolean);
  if (fields.length === 0) throw new SimError(`Specify one or more comma-separated fields for \`--json\`:\n  ${[...GH_FIELDS[kind]].sort().join("\n  ")}`);
  for (const f of fields) {
    if (!GH_FIELDS[kind].includes(f)) throw new SimError(`Unknown JSON field: "${f}"\nAvailable fields:\n  ${[...GH_FIELDS[kind]].sort().join("\n  ")}`);
    const modelled = kind === "check" || kind === "label" || kind === "repo" ? true : MODELLED[kind].includes(f);
    if (!modelled) throw unsupported(`${command} --json ${f}`);
  }
  return fields;
}
const pick = (obj, fields) => Object.fromEntries(fields.map((f) => [f, obj[f]]));

// ---- issues and PRs ----------------------------------------------------------------------------------------

const newestFirst = (ctx, kind) => (x, y) => createdAt(y).localeCompare(createdAt(x)) || y.number - x.number;

/** `--search`: every word must be in the title or the body. `closed:>=DATE` keeps what closed on or after DATE. */
function matchesSearch(ctx, kind, it, search) {
  const text = `${it.title ?? ""}\n${it.body ?? ""}`.toLowerCase();
  for (const term of search.match(/"[^"]*"|\S+/g) ?? []) {
    const q = /^closed:>=(\d{4}-\d{2}-\d{2})$/.exec(term);
    if (q) { if (it.state !== "closed" || (it.closedAt && it.closedAt.slice(0, 10) < q[1])) return false; continue; }
    if (/^[a-z-]+:/.test(term)) throw unsupported(`--search qualifier ${term}`);
    if (!text.includes(term.replace(/^"|"$/g, "").toLowerCase())) return false;
  }
  return true;
}

function listItems(ctx, kind, a, command) {
  const states = kind === "issue" ? ["open", "closed", "all"] : ["open", "closed", "merged", "all"];
  const state = a.flags.state ?? "open";
  if (!states.includes(state)) throw new SimError(`invalid argument "${state}" for "-s, --state" flag: valid values are {${states.join("|")}}`);
  const limit = a.flags.limit === undefined ? 30 : Number(a.flags.limit);
  if (!Number.isInteger(limit) || limit < 1) throw new SimError(`invalid limit: ${a.flags.limit}`);
  const labels = a.flags.label ?? [];
  const pool = kind === "issue" ? ctx.world.issues : ctx.world.prs;
  return pool
    .filter((it) => state === "all" || (it.state ?? "open") === state)
    .filter((it) => labels.every((l) => (it.labels ?? []).includes(l)))
    .filter((it) => a.flags.search === undefined || matchesSearch(ctx, kind, it, a.flags.search))
    .sort(newestFirst(ctx, kind)).slice(0, limit);
}

const stateWord = (kind, it) => (kind === "pr" && it.draft && (it.state ?? "open") === "open" ? "DRAFT" : { open: "OPEN", closed: "CLOSED", merged: "MERGED" }[it.state ?? "open"]);

function list(kind) {
  const command = `${kind} list`;
  const flags = { ...JSON_FLAGS, ...REPO_FLAG, "--label": { short: "-l", takes: true, multi: true }, "--state": { short: "-s", takes: true }, "--limit": { short: "-L", takes: true }, "--search": { short: "-S", takes: true } };
  return { flags, run(ctx, a) {
    checkRepo(ctx, a);
    const fields = fieldsOf(command, a, kind);
    const items = listItems(ctx, kind, a, command);
    if (fields) return printJson(items.map((it) => pick(view(ctx, kind, it), fields)), a);
    return items.map((it) => (kind === "issue"
      ? [it.number, stateWord(kind, it), it.title ?? `Issue ${it.number}`, (it.labels ?? []).join(", "), createdAt(it)]
      : [it.number, it.title ?? `Pull request ${it.number}`, branchOf(it), stateWord(kind, it), createdAt(it)]).join("\t") + "\n").join("");
  } };
}

function rawComments(ctx, kind, it) {
  return commentsOf(ctx, kind, it).map((c) => `author:\t${c.login}\nassociation:\t${c.association.toLowerCase()}\nedited:\tfalse\nstatus:\tnone\n--\n${c.body}\n--\n`).join("");
}

function viewOne(kind) {
  const command = `${kind} view`;
  const flags = { ...JSON_FLAGS, ...REPO_FLAG, "--comments": { short: "-c" } };
  return { flags, run(ctx, a) {
    checkRepo(ctx, a);
    const n = numberArg(command, a);
    const it = (kind === "issue" ? ctx.world.issues : ctx.world.prs).find((x) => x.number === n);
    if (!it) throw new SimError(`GraphQL: Could not resolve to ${kind === "issue" ? "an Issue" : "a PullRequest"} with the number of ${n}. (repository.${kind === "issue" ? "issue" : "pullRequest"})`);
    const fields = fieldsOf(command, a, kind);
    if (fields) return printJson(pick(view(ctx, kind, it), fields), a);
    const v = view(ctx, kind, it);
    const labels = (it.labels ?? []).join(", ");
    const head = kind === "issue"
      ? `title:\t${v.title}\nstate:\t${v.state}\nauthor:\t${v.author.login}\nlabels:\t${labels}\ncomments:\t${v.comments.length}\nassignees:\t\nprojects:\t\nmilestone:\t\nnumber:\t${n}\n--\n${v.body}\n`
      : `title:\t${v.title}\nstate:\t${stateWord("pr", it)}\nauthor:\t${v.author.login}\nlabels:\t${labels}\nassignees:\t\nreviewers:\t\nprojects:\t\nmilestone:\t\nnumber:\t${n}\nurl:\t${v.url}\nadditions:\t0\ndeletions:\t0\nauto-merge:\tdisabled\n--\n${v.body}\n`;
    return head + (a.flags.comments ? rawComments(ctx, kind, it) : "");
  } };
}

// ---- checks, labels, repo, auth, runs -----------------------------------------------------------------------

const checks = { flags: { ...JSON_FLAGS, ...REPO_FLAG }, run(ctx, a) {
  checkRepo(ctx, a);
  const n = numberArg("pr checks", a);
  const pr = ctx.world.prs.find((x) => x.number === n);
  if (!pr) throw new SimError(`GraphQL: Could not resolve to a PullRequest with the number of ${n}. (repository.pullRequest)`);
  const all = checksOf(ctx, pr);
  // `gh` reports a PR with no checks as an error, with or without --json.
  if (all.length === 0) throw new SimError(`no checks reported on the '${branchOf(pr)}' branch`);
  const fields = fieldsOf("pr checks", a, "check");
  // With --json `gh` writes the checks and exits 0. Without it, a failing check exits 1 and a pending one 8.
  if (fields) return printJson(all.map((c) => pick(c, fields)), a);
  const text = all.map((c) => `${c.name}\t${c.bucket}\t${c.bucket === "pending" ? "0" : "1s"}\t${c.link}\t\n`).join("");
  const code = all.some((c) => c.bucket === "fail" || c.bucket === "cancel") ? 1 : all.some((c) => c.bucket === "pending") ? 8 : 0;
  return { text, code };
} };

const labelList = { flags: { ...JSON_FLAGS, ...REPO_FLAG, "--limit": { short: "-L", takes: true } }, run(ctx, a) {
  checkRepo(ctx, a);
  const limit = a.flags.limit === undefined ? 30 : Number(a.flags.limit);
  if (!Number.isInteger(limit) || limit < 1) throw new SimError(`invalid limit: ${a.flags.limit}`);
  const rows = [...(ctx.world.labels ?? [])].sort((x, y) => x.name.localeCompare(y.name)).slice(0, limit)
    .map((l) => ({ id: `LA_${l.name}`, name: l.name, description: l.description ?? "", color: l.color ?? "ededed", isDefault: false, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", url: `https://github.com/${ctx.nameWithOwner}/labels/${encodeURIComponent(l.name)}` }));
  const fields = fieldsOf("label list", a, "label");
  if (fields) return printJson(rows.map((r) => pick(r, fields)), a);
  return rows.map((r) => `${r.name}\t${r.description}\t#${r.color}\n`).join("");
} };

const repoView = { flags: JSON_FLAGS, run(ctx, a) {
  if (a.pos.length > 0) throw unsupported("repo view <repository>");
  const row = { name: ctx.name, nameWithOwner: ctx.nameWithOwner, owner: { id: `U_${ctx.owner}`, login: ctx.owner }, url: `https://github.com/${ctx.nameWithOwner}`, id: "R_sim", description: "", isPrivate: false, defaultBranchRef: { name: ctx.defaultBranch } };
  const fields = fieldsOf("repo view", a, "repo");
  if (fields) {
    for (const f of fields) if (!(f in row)) throw unsupported(`repo view --json ${f}`);
    return printJson(pick(row, fields), a);
  }
  return `name:\t${ctx.nameWithOwner}\ndescription:\t\n--\n`;
} };

const authStatus = { flags: {}, run(ctx) {
  return `github.com\n  ✓ Logged in to github.com account ${ctx.user} (GH_SIM_WORLD)\n  - Active account: true\n  - Git operations protocol: https\n  - Token: sim_************************************\n`;
} };

const runView = { flags: { ...REPO_FLAG, "--log-failed": {}, "--log": {} }, run(ctx, a) {
  checkRepo(ctx, a);
  const id = numberArg("run view", a);
  if (!a.flags["log-failed"] && !a.flags.log) throw unsupported("run view without --log or --log-failed");
  const hit = ctx.world.prs.flatMap((pr) => checksOf(ctx, pr).map((c, i) => ({ pr, c, i }))).find(({ pr, i }) => runId(pr, i) === id);
  if (!hit) throw new SimError(`HTTP 404: Not Found (https://api.github.com/repos/${ctx.nameWithOwner}/actions/runs/${id}?exclude_pull_requests=true)`);
  if (a.flags["log-failed"] && hit.c.bucket !== "fail") throw new SimError("log not found");
  // The world holds only the outcome of a check, so the log is a fixed line that says which check failed.
  return `${hit.c.name}\tRun\t${hit.c.startedAt} Error: simulated ${hit.c.bucket === "fail" ? "failure" : "run"} of ${hit.c.name} on pr#${hit.pr.number}\n`;
} };

// ---- dispatch ----------------------------------------------------------------------------------------------

export const HANDLERS = {
  "issue list": list("issue"), "issue view": viewOne("issue"),
  "pr list": list("pr"), "pr view": viewOne("pr"), "pr checks": checks,
  "label list": labelList, "repo view": repoView, "auth status": authStatus, "run view": runView,
};

/** Runs one call. Returns { stdout, code, kind }. Never throws. */
export function run(argv, env = process.env) {
  const words = [];
  for (const w of argv) { if (w.startsWith("-") || words.length === 2) break; words.push(w); }
  const command = words.slice(0, 2).join(" ");
  try {
    if (!env.GH_SIM_WORLD) throw new SimError("GH_SIM_WORLD is not set: the gh simulator needs a world file", { code: 2 });
    const handler = HANDLERS[command];
    if (!handler) throw unsupported(SURFACE[words[0]] === "out-of-scope" ? `${words[0]} (out of scope)` : command || argv.join(" "));
    const { world } = loadWorld(env.GH_SIM_WORLD);
    const ctx = contextOf(world, env);
    const a = parseArgs(command, argv.slice(words.length), handler.flags);
    const result = handler.run(ctx, a);
    return typeof result === "string" ? { stdout: result, code: 0, kind: "ok" } : { stdout: result.text, code: result.code, kind: "ok" };
  } catch (e) {
    if (!(e instanceof SimError)) throw e;
    return { stdout: "", stderr: e.message + "\n", code: e.code, kind: e.kind };
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("gh-sim.mjs")) {
  const argv = process.argv.slice(2);
  const r = run(argv);
  if (process.env.GH_SIM_LOG) {
    const ts = new Date(process.env.GH_SIM_NOW ? Date.parse(process.env.GH_SIM_NOW) : Date.now()).toISOString();
    appendFileSync(process.env.GH_SIM_LOG, JSON.stringify({ ts, argv, exit: r.code, kind: r.kind }) + "\n");
  }
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  process.exitCode = r.code;
}

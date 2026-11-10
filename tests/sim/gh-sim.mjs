// The `gh` simulator: answers `gh` calls from a world file instead of GitHub. See docs/adr/0014-gh-simulator.md.
//
//   GH_SIM_WORLD  the world file (required): a bare world or a scenario file, in the scenarios' format
//   GH_SIM_LOG    a file every call is appended to, one JSON object per line (optional)
//   GH_SIM_NOW    an ISO time to use as "now" (optional; a test sets it)
//
// A command, flag or --json field the simulator does not cover exits 1 with `unsupported: <what>`.

import { appendFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { SURFACE } from "./surface.mjs";
import { applyEffects } from "../../scripts/scenario.mjs";
import { SimError, unsupported, loadWorld, saveWorld, contextOf, view, commentsOf, checksOf, runId, branchOf, createdAt, iso, GH_FIELDS, MODELLED } from "./world.mjs";

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
    if (r.error?.code === "ENOENT") throw new SimError("the gh simulator needs jq on PATH for --jq", { code: 2 });
    // A jq that rejects its expression exits before it reads its input, which spawnSync can report as EPIPE. The exit status is what counts.
    if (r.status !== 0) throw new SimError(r.stderr?.trim() || "jq failed");
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

// ---- writes --------------------------------------------------------------------------------------------------
//
// A write changes the world through `applyEffects`, the function the checker uses, so what a run leaves behind
// is what `diffWorlds` reads back. A call is checked before it changes anything: one that fails leaves the world
// as it was, and `run` saves the world only when a handler returns.

const WRITE = { write: true };
const itemsOf = (w, kind) => (kind === "issue" ? w.issues : w.prs);
const findItem = (w, kind, n) => itemsOf(w, kind).find((x) => x.number === n);
const nameOf = (kind) => (kind === "issue" ? "an Issue" : "a PullRequest");
const urlOf = (ctx, kind, n) => `https://github.com/${ctx.nameWithOwner}/${kind === "pr" ? "pull" : "issues"}/${n}`;
const titleOf = (kind, it) => it.title ?? (kind === "issue" ? `Issue ${it.number}` : `Pull request ${it.number}`);

function target(ctx, kind, a, command) {
  checkRepo(ctx, a);
  const n = numberArg(command, a);
  const it = findItem(ctx.world, kind, n);
  if (!it) throw new SimError(`GraphQL: Could not resolve to ${nameOf(kind)} with the number of ${n}. (repository.${kind === "issue" ? "issue" : "pullRequest"})`);
  return it;
}

/** `--body` or `--body-file` (a path, or `-` for stdin). undefined when neither is given. */
function bodyArg(a) {
  if (a.flags.body !== undefined && a.flags["body-file"] !== undefined) throw new SimError("specify only one of `--body` or `--body-file`");
  if (a.flags.body !== undefined) return a.flags.body;
  const f = a.flags["body-file"];
  if (f === undefined) return undefined;
  try { return readFileSync(f === "-" ? 0 : f, "utf8"); } catch (e) { throw new SimError(`open ${f}: ${e.code === "ENOENT" ? "no such file or directory" : e.message}`); }
}

/** The repository's labels are a catalog when the world has one. A label outside it cannot be put on an item. */
function needLabels(ctx, names) {
  if (!Array.isArray(ctx.world.labels)) return;
  for (const l of names) if (!ctx.labels.has(l)) throw new SimError(`'${l}' not found`);
}

/** Posts a comment as the agent. A `<!-- agent:... -->` marker in the body is the comment's marker. Returns its URL. */
function postComment(ctx, kind, n, body) {
  const marker = /<!-- (agent:[A-Za-z0-9_-]+)/.exec(body)?.[1];
  ctx.world = applyEffects(ctx.world, [{ op: "comment", target: `${kind}#${n}`, ...(marker ? { marker } : {}), text: body }]);
  const it = findItem(ctx.world, kind, n);
  Object.assign(it.comments.at(-1), { author: "agent", createdAt: iso(ctx.now) });
  return commentsOf(ctx, kind, it).at(-1).url;
}

const nextNumber = (w) => Math.max(0, ...w.issues.map((i) => i.number), ...w.prs.map((p) => p.number)) + 1;

const editFlags = (kind) => ({
  ...REPO_FLAG, "--add-label": { takes: true, multi: true }, "--remove-label": { takes: true, multi: true },
  "--body": { short: "-b", takes: true }, "--body-file": { short: "-F", takes: true }, "--title": { short: "-t", takes: true },
  ...(kind === "pr" ? { "--add-reviewer": { takes: true, multi: true } } : {}),
});

function edit(kind) {
  const command = `${kind} edit`;
  return { ...WRITE, flags: editFlags(kind), run(ctx, a) {
    const it = target(ctx, kind, a, command);
    const add = a.flags["add-label"] ?? [], rm = a.flags["remove-label"] ?? [], reviewers = a.flags["add-reviewer"] ?? [];
    const body = bodyArg(a), title = a.flags.title;
    if (!add.length && !rm.length && !reviewers.length && body === undefined && title === undefined) throw new SimError("field to edit flag required when not running interactively");
    needLabels(ctx, [...add, ...rm]);
    const t = `${kind}#${it.number}`, has = (l) => (it.labels ?? []).includes(l);
    // `gh` removes a label an item does not carry without complaint, and adds one it already has the same way.
    const effects = [
      ...rm.filter(has).map((label) => ({ op: "label_remove", target: t, label })),
      ...add.filter((l) => !has(l) || rm.includes(l)).map((label) => ({ op: "label_add", target: t, label })),
      ...reviewers.map((reviewer) => ({ op: "review_request", target: t, reviewer })),
    ];
    ctx.world = applyEffects(ctx.world, effects);
    const now = findItem(ctx.world, kind, it.number);
    if (body !== undefined) now.body = body;
    if (title !== undefined) now.title = title;
    return `${urlOf(ctx, kind, it.number)}\n`;
  } };
}

function comment(kind) {
  const command = `${kind} comment`;
  return { ...WRITE, flags: { ...REPO_FLAG, "--body": { short: "-b", takes: true }, "--body-file": { short: "-F", takes: true } }, run(ctx, a) {
    const it = target(ctx, kind, a, command);
    const body = bodyArg(a);
    if (body === undefined) throw new SimError("flag `--body` or `--body-file` required when not running interactively");
    if (body.trim() === "") throw new SimError("aborting due to empty body");
    return `${postComment(ctx, kind, it.number, body)}\n`;
  } };
}

const issueClose = { ...WRITE, flags: { ...REPO_FLAG, "--comment": { short: "-c", takes: true }, "--reason": { short: "-r", takes: true } }, run(ctx, a) {
  const it = target(ctx, "issue", a, "issue close");
  const reason = a.flags.reason;
  if (reason !== undefined && !["completed", "not planned"].includes(reason)) throw new SimError(`invalid argument "${reason}" for "-r, --reason" flag: valid values are {completed|not planned}`);
  if (it.state === "closed") return { text: "", err: `! Issue ${ctx.nameWithOwner}#${it.number} (${titleOf("issue", it)}) is already closed\n`, code: 0 };
  if (a.flags.comment !== undefined) postComment(ctx, "issue", it.number, a.flags.comment);
  ctx.world = applyEffects(ctx.world, [{ op: "close", target: `issue#${it.number}`, ...(reason ? { reason } : {}) }]);
  return { text: "", err: `✓ Closed issue ${ctx.nameWithOwner}#${it.number} (${titleOf("issue", it)})\n`, code: 0 };
} };

const issueReopen = { ...WRITE, flags: { ...REPO_FLAG, "--comment": { short: "-c", takes: true } }, run(ctx, a) {
  const it = target(ctx, "issue", a, "issue reopen");
  if ((it.state ?? "open") === "open") return { text: "", err: `! Issue ${ctx.nameWithOwner}#${it.number} (${titleOf("issue", it)}) is already open\n`, code: 0 };
  if (a.flags.comment !== undefined) postComment(ctx, "issue", it.number, a.flags.comment);
  // No effect op reopens an item, so `diffWorlds` reports this as `unmodelled`, which a contract has to allow.
  const now = findItem(ctx.world, "issue", it.number);
  now.state = "open"; delete now.closeReason;
  return { text: "", err: `✓ Reopened issue ${ctx.nameWithOwner}#${it.number} (${titleOf("issue", it)})\n`, code: 0 };
} };

const createFlags = (kind) => ({
  ...REPO_FLAG, "--title": { short: "-t", takes: true }, "--body": { short: "-b", takes: true }, "--body-file": { short: "-F", takes: true },
  "--label": { short: "-l", takes: true, multi: true },
  ...(kind === "pr" ? { "--base": { short: "-B", takes: true }, "--head": { short: "-H", takes: true }, "--draft": { short: "-d" } } : {}),
});

function createCommon(ctx, kind, a) {
  checkRepo(ctx, a);
  if (a.pos.length) throw unsupported(`${kind} create ${a.pos[0]}`);
  const body = bodyArg(a), title = a.flags.title, labels = a.flags.label ?? [];
  if (title === undefined || body === undefined) throw new SimError(`must provide \`--title\` and \`--body\`${kind === "pr" ? " (or `--fill` or `--fill-first` or `--fill-verbose`)" : ""} when not running interactively`);
  if (title.trim() === "") throw new SimError("title can't be blank");
  needLabels(ctx, labels);
  return { body, title, labels: [...new Set(labels)] };
}

const issueCreate = { ...WRITE, flags: createFlags("issue"), run(ctx, a) {
  const { body, title, labels } = createCommon(ctx, "issue", a);
  const number = nextNumber(ctx.world);
  ctx.world = applyEffects(ctx.world, [{ op: "create_issue", number, labels, data: { title, body, createdAt: iso(ctx.now), author: ctx.user } }]);
  return `${urlOf(ctx, "issue", number)}\n`;
} };

/** The current branch and its commit, as `gh pr create` finds them when it is not told. */
function git(args) {
  const r = spawnSync("git", args, { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : "";
}

const prCreate = { ...WRITE, flags: createFlags("pr"), run(ctx, a) {
  const { body, title, labels } = createCommon(ctx, "pr", a);
  const base = a.flags.base ?? ctx.defaultBranch;
  const head = a.flags.head ?? git(["branch", "--show-current"]);
  if (!head) throw new SimError("could not determine current branch: not on a branch, and no --head given");
  if (head === base) throw new SimError(`head branch "${head}" is the same as base branch "${base}", cannot create a pull request`);
  const dup = ctx.world.prs.find((p) => (p.state ?? "open") === "open" && branchOf(p) === head && (p.base ?? ctx.defaultBranch) === base);
  if (dup) throw new SimError(`a pull request for branch "${head}" into branch "${base}" already exists:\n${urlOf(ctx, "pr", dup.number)}`);
  const number = nextNumber(ctx.world);
  const sha = git(["rev-parse", "--verify", `${head}^{commit}`]) || git(["rev-parse", "HEAD"]) || `sim-${number}`;
  // GitHub links a PR to the issues its body closes, when they exist.
  const closes = [...new Set([...body.matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi)].map((m) => Number(m[1])))].filter((n) => findItem(ctx.world, "issue", n));
  ctx.world = applyEffects(ctx.world, [{ op: "create_pr", number, labels, sha, base, closes, data: { title, body, createdAt: iso(ctx.now), author: ctx.user, branch: head } }]);
  if (a.flags.draft) findItem(ctx.world, "pr", number).draft = true;
  return `${urlOf(ctx, "pr", number)}\n`;
} };

const prMerge = { ...WRITE, flags: { ...REPO_FLAG, "--squash": { short: "-s" }, "--merge": { short: "-m" }, "--rebase": { short: "-r" }, "--delete-branch": { short: "-d" }, "--match-head-commit": { takes: true } }, run(ctx, a) {
  const pr = target(ctx, "pr", a, "pr merge");
  const methods = ["squash", "merge", "rebase"].filter((m) => a.flags[m]);
  if (methods.length > 1) throw new SimError("only one of `--merge`, `--rebase`, or `--squash` can be enabled");
  if (methods.length === 0) throw new SimError("--merge, --rebase, or --squash required when not running interactively");
  const t = `pr#${pr.number}`, full = `${ctx.nameWithOwner}#${pr.number}`;
  const state = pr.state ?? "open";
  if (state === "closed") throw new SimError(`GraphQL: Pull request is closed (mergePullRequest)`);
  if (state === "merged") {
    // `gh` does nothing for a PR that is already merged, except delete its branch when asked.
    if (a.flags["delete-branch"] && !pr.branchDeleted) ctx.world = applyEffects(ctx.world, [{ op: "delete_branch", target: t }]);
    return { text: "", err: a.flags["delete-branch"] ? `! Pull request ${full} was already merged\n` : "", code: 0 };
  }
  const merge = pr.mergeState ?? (pr.draft ? "DRAFT" : "CLEAN");
  const blocked = { DIRTY: "the merge commit cannot be cleanly created", BLOCKED: "the base branch policy prohibits the merge", BEHIND: "the head branch is not up to date with the base branch" }[merge];
  if (blocked) throw new SimError(`X Pull request ${full} is not mergeable: ${blocked}.\nTo have the pull request merged after all the requirements have been met, add the \`--auto\` flag.`);
  if (pr.draft || merge === "DRAFT") throw new SimError("GraphQL: Pull request Pull request is still a draft (mergePullRequest)");
  const pin = a.flags["match-head-commit"];
  if (pin !== undefined && pin !== String(pr.head)) throw new SimError("GraphQL: Head branch was modified. Review and try the merge again. (mergePullRequest)");
  ctx.world = applyEffects(ctx.world, [{ op: "merge", target: t, ...(typeof pr.head === "string" ? { sha: pr.head } : {}) }, ...(a.flags["delete-branch"] ? [{ op: "delete_branch", target: t }] : [])]);
  const action = { squash: "Squashed and merged", merge: "Merged", rebase: "Rebased and merged" }[methods[0]];
  return { text: "", err: `✓ ${action} pull request ${full} (${titleOf("pr", pr)})\n`, code: 0 };
} };

const labelCreate = { ...WRITE, flags: { ...REPO_FLAG, "--color": { short: "-c", takes: true }, "--description": { short: "-d", takes: true }, "--force": { short: "-f" } }, run(ctx, a) {
  checkRepo(ctx, a);
  if (a.pos.length !== 1) throw new SimError("cannot create label: name argument required");
  const name = a.pos[0], color = a.flags.color?.replace(/^#/, "");
  if (color !== undefined && !/^[0-9a-fA-F]{6}$/.test(color)) throw new SimError(`invalid argument "${a.flags.color}" for "-c, --color" flag: ${a.flags.color} is not a valid color (hex, 6 digits)`);
  const exists = ctx.labels.has(name);
  if (exists && !a.flags.force) throw new SimError(`label with name "${name}" already exists; use \`--force\` to update its color and description`);
  const description = a.flags.description;
  ctx.world = applyEffects(ctx.world, [exists ? { op: "label_update", name, ...(description ? { description } : {}) } : { op: "label_create", name, ...(description ? { description } : {}) }]);
  if (color) ctx.world.labels.find((l) => l.name === name).color = color;
  ctx.labels = new Map(ctx.world.labels.map((l) => [l.name, l]));
  return `✓ Label "${name}" ${exists ? "updated" : "created"} in ${ctx.nameWithOwner}\n`;
} };

// ---- dispatch ----------------------------------------------------------------------------------------------

export const HANDLERS = {
  "issue list": list("issue"), "issue view": viewOne("issue"),
  "pr list": list("pr"), "pr view": viewOne("pr"), "pr checks": checks,
  "label list": labelList, "repo view": repoView, "auth status": authStatus, "run view": runView,
  "issue edit": edit("issue"), "issue close": issueClose, "issue create": issueCreate, "issue comment": comment("issue"), "issue reopen": issueReopen,
  "pr edit": edit("pr"), "pr create": prCreate, "pr comment": comment("pr"), "pr merge": prMerge,
  "label create": labelCreate,
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
    const { world, scenario } = loadWorld(env.GH_SIM_WORLD);
    if (handler.write && scenario) throw new SimError(`GH_SIM_WORLD is a scenario file, and the gh simulator does not write to one: make a world file with \`node tests/sim/seed.mjs ${env.GH_SIM_WORLD} <world.yaml>\``, { code: 2 });
    const ctx = contextOf(world, env);
    const a = parseArgs(command, argv.slice(words.length), handler.flags);
    const result = handler.run(ctx, a);
    // Only a call that got this far changes the file.
    if (handler.write) saveWorld(env.GH_SIM_WORLD, ctx.world);
    return typeof result === "string" ? { stdout: result, code: 0, kind: "ok" } : { stdout: result.text, stderr: result.err, code: result.code, kind: "ok" };
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

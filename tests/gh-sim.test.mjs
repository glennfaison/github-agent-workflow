// Tests for the `gh` simulator (tests/sim). Most spawn the real executable, tests/sim/bin/gh, against a world file.
//   node --test tests/gh-sim.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";
import { SURFACE, ghCommandsIn } from "./sim/surface.mjs";
import { HANDLERS, run } from "./sim/gh-sim.mjs";
import { loadWorld } from "./sim/world.mjs";
import { seed } from "./sim/seed.mjs";
import { checkState } from "../scripts/scenario.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GH = join(ROOT, "tests/sim/bin/gh");
const DIR = mkdtempSync(join(tmpdir(), "gh-sim-"));
process.on("exit", () => rmSync(DIR, { recursive: true, force: true }));

let n = 0;
/** Runs `gh <args>` against `world`. Returns stdout, stderr, the exit code and the call log. */
function gh(world, args, env = {}) {
  const file = join(DIR, `world-${++n}.yaml`), log = join(DIR, `log-${n}.jsonl`);
  writeFileSync(file, stringify(world));
  const r = spawnSync(GH, args, { encoding: "utf8", env: { ...process.env, GH_SIM_WORLD: file, GH_SIM_LOG: log, GH_SIM_NOW: "2026-11-09T12:00:00Z", ...env } });
  let calls = [];
  try { calls = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l)); } catch { /* no call was logged */ }
  return { out: r.stdout, err: r.stderr, code: r.status, calls, json: () => JSON.parse(r.stdout) };
}

const WORLD = {
  labels: [{ name: "ready-for-agent", description: "Ready" }, { name: "bug" }],
  issues: [
    { number: 1, state: "open", title: "Old bug", body: "crashes on import", labels: ["bug"], createdAt: "2026-11-01T00:00:00Z" },
    { number: 2, state: "open", title: "New feature", labels: ["ready-for-agent", "bug"], createdAt: "2026-11-05T00:00:00Z", lease: "live" },
    { number: 3, state: "closed", title: "Done", body: "export button", labels: [], createdAt: "2026-10-01T00:00:00Z" },
  ],
  prs: [
    { number: 10, state: "open", labels: ["agent:needs-work"], head: "h1", base: "main", mergeState: "DIRTY", checks: ["pass", "fail"], openFindings: 2, closes: [2], files: ["a.md", "b.md"], shepherdAttempts: 2, createdAt: "2026-11-06T00:00:00Z" },
    { number: 11, state: "open", draft: true, labels: [], head: "h9", checks: ["pending"], fork: true, createdAt: "2026-11-07T00:00:00Z" },
    { number: 12, state: "merged", labels: [], head: "h3", checks: ["pass"], createdAt: "2026-11-02T00:00:00Z" },
    { number: 13, state: "open", labels: ["agent:ready-for-review"], head: "h4", checks: [], createdAt: "2026-11-03T00:00:00Z" },
  ],
};

// ---- the surface -------------------------------------------------------------------------------------------

function* files(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { if (e !== "node_modules") yield* files(p); } else if ([".md", ".sh", ".mjs", ".yaml"].includes(extname(p))) yield p;
  }
}

test("every gh command the skills use is in the manifest, supported or listed as out of scope", () => {
  const used = new Map();
  for (const dir of ["skills", "scripts"]) for (const f of files(join(ROOT, dir))) for (const c of ghCommandsIn(readFileSync(f, "utf8"))) used.set(c, f);
  const missing = [...used].filter(([c]) => !(c in SURFACE)).map(([c, f]) => `\`gh ${c}\` in ${f.replace(ROOT + "/", "")}`);
  assert.deepEqual(missing, [], "a gh command the simulator does not know: add it to tests/sim/surface.mjs");
  assert.ok(used.size >= 15, `only found ${used.size} commands, the grep is broken`);
});

test("a manifest entry that no skill uses is stale", () => {
  const used = new Set();
  for (const dir of ["skills", "scripts"]) for (const f of files(join(ROOT, dir))) for (const c of ghCommandsIn(readFileSync(f, "utf8"))) used.add(c);
  assert.deepEqual(Object.keys(SURFACE).filter((c) => !used.has(c)), []);
});

test("ghCommandsIn reads commands, not prose", () => {
  assert.deepEqual([...ghCommandsIn("run `gh pr checks N --json bucket` then `gh auth` must succeed and gh api -X PUT x; gh search forbidden")].sort(), ["api", "pr checks", "search"]);
});

test("the supported entries are exactly the simulator's handlers", () => {
  assert.deepEqual(Object.keys(HANDLERS).sort(), Object.entries(SURFACE).filter(([, s]) => s === "supported").map(([c]) => c).sort());
});

test("a planned or out-of-scope command exits 1 with `unsupported:` and is logged", () => {
  for (const [command, status] of Object.entries(SURFACE).filter(([, s]) => s !== "supported")) {
    const r = gh(WORLD, command.split(" "));
    assert.equal(r.code, 1, command);
    assert.match(r.err, /^unsupported: /, `${command} (${status})`);
    assert.equal(r.calls[0].kind, "unsupported");
  }
  assert.match(gh(WORLD, ["gizmo", "frob"]).err, /^unsupported: gizmo frob/);
});

// ---- the call log and the world file -----------------------------------------------------------------------

test("every call is logged with its arguments, exit code and kind", () => {
  const ok = gh(WORLD, ["issue", "list", "--json", "number"]);
  assert.deepEqual(ok.calls.map(({ argv, exit, kind }) => ({ argv, exit, kind })), [{ argv: ["issue", "list", "--json", "number"], exit: 0, kind: "ok" }]);
  assert.equal(ok.calls[0].ts, "2026-11-09T12:00:00.000Z");
  assert.equal(gh(WORLD, ["issue", "view", "99"]).calls[0].kind, "error");
});

test("an unsupported flag names the flag, and a flag of the right command is fine", () => {
  assert.equal(gh(WORLD, ["issue", "list", "--author", "x"]).err, "unsupported: issue list --author\n");
  assert.equal(gh(WORLD, ["pr", "view", "10", "--web"]).err, "unsupported: pr view --web\n");
  assert.equal(gh(WORLD, ["issue", "list", "-l", "bug", "-s", "all", "-L", "5"]).code, 0);
  assert.equal(gh(WORLD, ["pr", "view", "10"]).code, 0);
  assert.equal(gh(WORLD, ["pr", "view"]).err, "unsupported: pr view without exactly one number\n");
});

test("without GH_SIM_WORLD, or with a world that is not there, the call fails with exit 2", () => {
  assert.equal(spawnSync(GH, ["issue", "list"], { encoding: "utf8", env: { ...process.env, GH_SIM_WORLD: "" } }).status, 2);
  assert.equal(gh(WORLD, ["issue", "list"], { GH_SIM_WORLD: join(DIR, "nope.yaml") }).code, 2);
});

test("a scenario file is read as its world, with the label catalog expanded", () => {
  const r = gh({ name: "x", skill: "triage-github-issue", world: { labels: [{ from: "labels.md" }], issues: [{ number: 5, state: "open", labels: ["needs-triage"] }] }, expect: {} }, ["label", "list", "--json", "name", "--jq", ".[].name"]);
  assert.ok(r.out.split("\n").includes("agent:log"));
  assert.equal(gh({ skill: "s", world: { issues: [{ number: 5, state: "open" }] }, expect: {} }, ["issue", "list", "--json", "number", "--jq", ".[].number"]).out, "5\n");
});

test("a check that is not pass, fail, pending, cancel or skipping is refused when the world is read", () => {
  const r = gh({ prs: [{ number: 1, checks: ["ok"] }] }, ["pr", "list"]);
  assert.equal(r.code, 2);
  assert.match(r.err, /pr#1 has a check `ok`/);
});

// ---- issue and pr list ---------------------------------------------------------------------------------------

test("issue list shows open issues, newest first, and filters like gh", () => {
  const nums = (args) => gh(WORLD, ["issue", "list", ...args, "--json", "number", "--jq", ".[].number"]).out.trim().split("\n").filter(Boolean).map(Number);
  assert.deepEqual(nums([]), [2, 1]);
  assert.deepEqual(nums(["--state", "all"]), [2, 1, 3]);
  assert.deepEqual(nums(["--state", "closed"]), [3]);
  assert.deepEqual(nums(["--label", "bug"]), [2, 1]);
  assert.deepEqual(nums(["--label", "bug", "--label", "ready-for-agent"]), [2], "labels are ANDed");
  assert.deepEqual(nums(["--label", "bug,ready-for-agent"]), [2], "a comma list is the same");
  assert.deepEqual(nums(["--state", "all", "--limit", "2"]), [2, 1]);
  assert.equal(gh(WORLD, ["issue", "list", "--limit", "0"]).code, 1);
  assert.match(gh(WORLD, ["issue", "list", "--state", "merged"]).err, /valid values are \{open\|closed\|all\}/);
});

test("issue list does not list PRs, and pr list does not list issues", () => {
  assert.equal(gh(WORLD, ["issue", "list", "--state", "all", "--json", "number", "--jq", "length"]).out, "3\n");
  assert.equal(gh(WORLD, ["pr", "list", "--state", "all", "--json", "number", "--jq", "length"]).out, "4\n");
});

test("pr list separates open, closed and merged", () => {
  const nums = (s) => gh(WORLD, ["pr", "list", "--state", s, "--json", "number", "--jq", "[.[].number]"]).out.trim();
  assert.equal(nums("open"), "[11,10,13]");
  assert.equal(nums("merged"), "[12]");
  assert.equal(nums("closed"), "[]");
  assert.equal(nums("all"), "[11,10,13,12]");
});

test("--search matches words in the title or body, and closed:>= keeps closed issues", () => {
  const nums = (s) => gh(WORLD, ["issue", "list", "--state", "all", "--search", s, "--json", "number", "--jq", "[.[].number]"]).out.trim();
  assert.equal(nums("crashes IMPORT"), "[1]");
  assert.equal(nums("export button closed:>=2026-01-01"), "[3]");
  assert.equal(nums("nothing here"), "[]");
  assert.match(gh(WORLD, ["issue", "list", "--search", "is:open"]).err, /^unsupported: --search qualifier is:open/);
});

test("plain list output is one tab-separated row per item, as gh prints it to a pipe", () => {
  assert.equal(gh(WORLD, ["issue", "list"]).out, "2\tOPEN\tNew feature\tready-for-agent, bug\t2026-11-05T00:00:00Z\n1\tOPEN\tOld bug\tbug\t2026-11-01T00:00:00Z\n");
  assert.match(gh(WORLD, ["pr", "list"]).out, /^11\tPull request 11\tfeat\/11-pr-11\tDRAFT\t2026-11-07T00:00:00Z\n/);
});

// ---- the shape of what --json returns -----------------------------------------------------------------------

test("issue --json has gh's shapes: uppercase state, label objects, author, url", () => {
  const [i] = gh(WORLD, ["issue", "list", "--label", "ready-for-agent", "--json", "number,state,labels,author,url,stateReason,closed,assignees"]).json();
  assert.deepEqual(i, {
    number: 2, state: "OPEN", closed: false, stateReason: "", assignees: [], url: "https://github.com/sim/repo/issues/2",
    author: { id: "U_reporter", is_bot: false, login: "reporter", name: "" },
    labels: [{ id: "LA_ready-for-agent", name: "ready-for-agent", description: "Ready", color: "ededed" }, { id: "LA_bug", name: "bug", description: "", color: "ededed" }],
  });
  assert.equal(gh(WORLD, ["issue", "view", "3", "--json", "state,stateReason,closedAt", "--jq", ".state"]).out, "CLOSED\n");
});

test("pr --json has gh's shapes", () => {
  const p = gh(WORLD, ["pr", "view", "10", "--json", "number,state,isDraft,headRefName,headRefOid,baseRefName,mergeStateStatus,mergeable,isCrossRepository,closingIssuesReferences,files,changedFiles,labels,author"]).json();
  assert.equal(p.state, "OPEN");
  assert.equal(p.headRefOid, "h1");
  assert.equal(p.headRefName, "feat/2-pr-10", "feat/<closed issue>-..., which is what prs_for_issue matches");
  assert.equal(p.baseRefName, "main");
  assert.equal(p.mergeStateStatus, "DIRTY");
  assert.equal(p.mergeable, "CONFLICTING");
  assert.equal(p.isCrossRepository, false);
  assert.deepEqual(p.closingIssuesReferences.map((c) => c.number), [2]);
  assert.deepEqual(p.files.map((f) => f.path), ["a.md", "b.md"]);
  assert.equal(p.author.login, "agent-bot");
  const d = gh(WORLD, ["pr", "view", "11", "--json", "isDraft,isCrossRepository,mergeStateStatus"]).json();
  assert.deepEqual(d, { isDraft: true, isCrossRepository: true, mergeStateStatus: "DRAFT" });
  assert.equal(gh(WORLD, ["pr", "view", "12", "--json", "state", "--jq", ".state"]).out, "MERGED\n");
  assert.equal(gh(WORLD, ["pr", "view", "10", "--json", "headRefName"], {}).code, 0);
});

test("a PR can name its branch, and the repository and the agent can be set by the world", () => {
  const w = { repo: "acme/widgets", user: "bot", prs: [{ number: 3, state: "open", branch: "fix/7-thing", closes: [] }] };
  assert.equal(gh(w, ["pr", "view", "3", "--json", "headRefName", "--jq", ".headRefName"]).out, "fix/7-thing\n");
  assert.equal(gh(w, ["pr", "view", "3", "--json", "url,author", "--jq", ".url, .author.login"]).out, "https://github.com/acme/widgets/pull/3\nbot\n");
  assert.equal(gh(w, ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]).out, "acme/widgets\n");
  assert.match(gh(w, ["auth", "status"]).out, /Logged in to github\.com account bot/);
});

test("a field gh does not have fails as gh does, and one gh has but the world cannot show is unsupported", () => {
  const r = gh(WORLD, ["pr", "view", "10", "--json", "number,authorAssociation"]);
  assert.equal(r.code, 1);
  assert.match(r.err, /^Unknown JSON field: "authorAssociation"\nAvailable fields:\n  additions\n/);
  assert.equal(r.calls[0].kind, "error");
  const u = gh(WORLD, ["pr", "view", "10", "--json", "commits"]);
  assert.equal(u.err, "unsupported: pr view --json commits\n");
  assert.equal(u.calls[0].kind, "unsupported");
  assert.match(gh(WORLD, ["issue", "list", "--json", "isDraft"]).err, /Unknown JSON field: "isDraft"/, "isDraft is a PR field, not an issue field");
  assert.match(gh(WORLD, ["issue", "list", "--json", ""]).err, /Specify one or more comma-separated fields/);
});

test("--jq prints as gh does: strings raw, null as nothing, whole numbers plain, the rest as compact JSON", () => {
  const jq = (e) => gh(WORLD, ["pr", "view", "12", "--json", "number,title,mergedAt,closed,labels,author", "--jq", e]).out;
  assert.equal(jq(".title"), "Pull request 12\n");
  assert.equal(jq(".number"), "12\n");
  assert.equal(jq(".closed"), "true\n");
  assert.equal(jq(".labels"), "[]\n");
  assert.equal(jq(".author | {login}"), '{"login":"agent-bot"}\n');
  assert.equal(gh(WORLD, ["pr", "view", "10", "--json", "mergedAt", "--jq", ".mergedAt"]).out, "\n", "null is an empty line");
  assert.equal(jq(".labels[].name"), "", "no output at all when the expression has no result");
  assert.match(gh(WORLD, ["pr", "view", "12", "--jq", ".x"]).err, /cannot use `--jq` without specifying `--json`/);
  for (let i = 0; i < 10; i++) { // jq exits before it reads its input, so this used to depend on timing
    const bad = gh(WORLD, ["pr", "view", "12", "--json", "number", "--jq", ".["]);
    assert.equal(bad.code, 1, `a bad expression fails: ${bad.err}`);
    assert.match(bad.err, /jq: error/);
  }
  const file = join(DIR, "nojq.yaml"); writeFileSync(file, stringify(WORLD));
  const path = process.env.PATH; process.env.PATH = DIR; // a directory with no jq in it
  let none; try { none = run(["pr", "view", "12", "--json", "number", "--jq", ".number"], { ...process.env, GH_SIM_WORLD: file }); } finally { process.env.PATH = path; }
  assert.deepEqual([none.code, none.stderr], [2, "the gh simulator needs jq on PATH for --jq\n"], "without jq on PATH the call says so");
});

// ---- what a world keeps as state, shown as comments ----------------------------------------------------------

test("a live or stale lease is shown as an agent:lease comment that expires after or before now", () => {
  const comments = (w, kind, n) => gh(w, [kind, "view", String(n), "--json", "comments"]).json().comments;
  const live = comments(WORLD, "issue", 2);
  assert.equal(live.length, 1);
  assert.match(live[0].body, /^<!-- agent:lease step=Working run=sim expires=2026-11-09T13:00:00Z -->$/);
  assert.equal(live[0].author.login, "agent-bot");
  const stale = comments({ issues: [{ number: 1, lease: "stale" }] }, "issue", 1);
  assert.match(stale[0].body, /expires=2026-11-09T11:00:00Z/);
  assert.deepEqual(comments({ issues: [{ number: 1 }] }, "issue", 1), []);
});

test("a PR's readySha, openFindings and shepherdAttempts are shown as the markers a repository would hold", () => {
  const w = { prs: [{ number: 7, state: "open", head: "h5", labels: ["agent:ready-for-review"], readySha: "h4", openFindings: 3, shepherdAttempts: 2 }] };
  const bodies = gh(w, ["pr", "view", "7", "--json", "comments", "--jq", ".comments[].body"]).out.trim().split("\n");
  assert.deepEqual(bodies, [
    "Ready for review. <!-- agent:handoff kind=ready sha=h4 -->",
    "Review findings. <!-- agent:handoff kind=review sha=h5 open=3 -->",
    "<!-- agent:attempt step=shepherding run=sim-1 -->",
    "<!-- agent:attempt step=shepherding run=sim-2 -->",
  ]);
  const ready = gh(w, ["pr", "view", "7", "--json", "comments", "--jq", ".comments[0].createdAt"]).out.trim();
  assert.equal(ready, "2026-11-09T11:50:00Z", "the ready handoff is ten minutes old, so it holds the merge lane");
  const label = gh({ prs: [{ number: 8, state: "open", head: "h6", labels: ["agent:ready-for-review"] }] }, ["pr", "view", "8", "--json", "comments", "--jq", ".comments[0].body"]).out;
  assert.equal(label, "Ready for review. <!-- agent:handoff kind=ready sha=h6 -->\n", "a ready-for-review PR was handed off at its head");
});

test("a stored comment keeps its marker, author and trust, and is not duplicated by a derived one", () => {
  const w = { issues: [{ number: 4, state: "open", comments: [{ author: "agent", trusted: true, marker: "agent:outcome" }, { author: "human" }, { author: "carol", text: "hello" }] }],
    prs: [{ number: 5, state: "open", head: "h", labels: ["agent:ready-for-review"], comments: [{ author: "agent", text: "go <!-- agent:handoff kind=ready sha=zz -->" }] }] };
  const c = gh(w, ["issue", "view", "4", "--json", "comments"]).json().comments;
  assert.deepEqual(c.map((x) => [x.author.login, x.authorAssociation, x.body]), [["agent-bot", "OWNER", "<!-- agent:outcome -->"], ["someone", "NONE", "A comment."], ["carol", "NONE", "hello"]]);
  assert.equal(gh(w, ["pr", "view", "5", "--json", "comments", "--jq", ".comments | length"]).out, "1\n", "the stored ready handoff stands in for the derived one");
});

// ---- plain view output ---------------------------------------------------------------------------------------

test("plain issue view prints the metadata lines and the body, as gh does to a pipe", () => {
  assert.equal(gh(WORLD, ["issue", "view", "1"]).out, "title:\tOld bug\nstate:\tOPEN\nauthor:\treporter\nlabels:\tbug\ncomments:\t0\nassignees:\t\nprojects:\t\nmilestone:\t\nnumber:\t1\n--\ncrashes on import\n");
  const withComments = gh(WORLD, ["issue", "view", "2", "--comments"]).out;
  assert.match(withComments, /number:\t2\n--\n\nauthor:\tagent-bot\nassociation:\tnone\nedited:\tfalse\nstatus:\tnone\n--\n<!-- agent:lease/);
});

test("plain pr view shows DRAFT for a draft, and a missing item is an error", () => {
  assert.match(gh(WORLD, ["pr", "view", "11"]).out, /^title:\tPull request 11\nstate:\tDRAFT\n/);
  assert.equal(gh(WORLD, ["pr", "view", "99"]).err, "GraphQL: Could not resolve to a PullRequest with the number of 99. (repository.pullRequest)\n");
  assert.equal(gh(WORLD, ["issue", "view", "99"]).err, "GraphQL: Could not resolve to an Issue with the number of 99. (repository.issue)\n");
  assert.match(gh(WORLD, ["issue", "view", "1", "-R", "other/repo"]).err, /Could not resolve to a Repository with the name 'other\/repo'/);
  assert.equal(gh(WORLD, ["issue", "view", "#1", "-R", "sim/repo"]).code, 0);
});

// ---- pr checks -----------------------------------------------------------------------------------------------

test("pr checks --json gives buckets and exits 0 whatever they are, as gh does", () => {
  const r = gh(WORLD, ["pr", "checks", "10", "--json", "bucket,name,state"]);
  assert.equal(r.code, 0);
  assert.deepEqual(r.json(), [{ bucket: "pass", name: "check-1", state: "SUCCESS" }, { bucket: "fail", name: "check-2", state: "FAILURE" }]);
  assert.equal(gh(WORLD, ["pr", "checks", "11", "--json", "bucket", "--jq", "[.[].bucket]"]).out, '["pending"]\n');
});

test("plain pr checks exits 1 on a failure, 8 on a pending check, 0 otherwise", () => {
  assert.equal(gh(WORLD, ["pr", "checks", "10"]).code, 1);
  assert.equal(gh(WORLD, ["pr", "checks", "11"]).code, 8);
  const ok = gh(WORLD, ["pr", "checks", "12"]);
  assert.equal(ok.code, 0);
  assert.match(ok.out, /^check-1\tpass\t1s\thttps:\/\/github\.com\/sim\/repo\/actions\/runs\/\d+\/job\/\d+\t\n$/);
  const mixed = gh({ prs: [{ number: 1, checks: ["pass", "pending", "fail"] }] }, ["pr", "checks", "1"]);
  assert.equal(mixed.code, 1, "a failure wins over a pending check");
});

test("a PR with no checks is an error, even with --json, and prints nothing: gh does not return []", () => {
  const r = gh(WORLD, ["pr", "checks", "13", "--json", "bucket", "--jq", "[.[].bucket] | length"]);
  assert.equal(r.code, 1);
  assert.equal(r.out, "");
  assert.equal(r.err, "no checks reported on the 'feat/13-pr-13' branch\n");
});

test("statusCheckRollup shows each check as a CheckRun with its status and conclusion", () => {
  const r = gh(WORLD, ["pr", "view", "10", "--json", "statusCheckRollup", "--jq", ".statusCheckRollup | map([.name, .status, .conclusion])"]).json();
  assert.deepEqual(r, [["check-1", "COMPLETED", "SUCCESS"], ["check-2", "COMPLETED", "FAILURE"]]);
  assert.deepEqual(gh(WORLD, ["pr", "view", "11", "--json", "statusCheckRollup", "--jq", ".statusCheckRollup | map([.status, .conclusion])"]).json(), [["IN_PROGRESS", ""]]);
});

test("run view --log-failed reads the log of a failing check by the id in its link, and nothing else", () => {
  const link = gh(WORLD, ["pr", "checks", "10", "--json", "link", "--jq", ".[1].link"]).out.trim();
  const id = /runs\/(\d+)\//.exec(link)[1];
  const r = gh(WORLD, ["run", "view", id, "--log-failed"]);
  assert.equal(r.code, 0);
  assert.match(r.out, /^check-2\tRun\t.* Error: simulated failure of check-2 on pr#10\n$/);
  const passId = /runs\/(\d+)\//.exec(gh(WORLD, ["pr", "checks", "10", "--json", "link", "--jq", ".[0].link"]).out)[1];
  assert.equal(gh(WORLD, ["run", "view", passId, "--log-failed"]).err, "log not found\n");
  assert.match(gh(WORLD, ["run", "view", "5", "--log-failed"]).err, /^HTTP 404: Not Found/);
  assert.equal(gh(WORLD, ["run", "view", id]).err, "unsupported: run view without --log or --log-failed\n");
});

// ---- labels, repo, auth --------------------------------------------------------------------------------------

test("label list is sorted by name and has gh's fields", () => {
  assert.equal(gh(WORLD, ["label", "list"]).out, "bug\t\t#ededed\nready-for-agent\tReady\t#ededed\n");
  assert.deepEqual(gh(WORLD, ["label", "list", "--limit", "300", "--json", "name,description"]).json(), [{ name: "bug", description: "" }, { name: "ready-for-agent", description: "Ready" }]);
  assert.equal(gh(WORLD, ["label", "list", "--limit", "1", "--json", "name", "--jq", ".[].name"]).out, "bug\n");
  assert.equal(gh({}, ["label", "list", "--json", "name"]).out, "[]\n", "a world with no labels has none");
});

test("repo view and auth status answer from the world", () => {
  assert.deepEqual(gh(WORLD, ["repo", "view", "--json", "nameWithOwner,defaultBranchRef"]).json(), { nameWithOwner: "sim/repo", defaultBranchRef: { name: "main" } });
  assert.equal(gh({ default_branch: "trunk" }, ["repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"]).out, "trunk\n");
  assert.match(gh(WORLD, ["repo", "view", "--json", "stargazerCount"]).err, /unsupported: repo view --json stargazerCount/);
  assert.match(gh(WORLD, ["auth", "status"]).out, /^github\.com\n {2}✓ Logged in to github\.com account agent-bot/);
  assert.equal(gh(WORLD, ["repo", "view", "other/repo"]).err, "unsupported: repo view <repository>\n");
});

// ---- the golden scenarios ------------------------------------------------------------------------------------

test("every golden scenario's world can be loaded and read through gh", () => {
  let count = 0;
  for (const dir of readdirSync(join(ROOT, "tests/scenarios"))) {
    for (const f of readdirSync(join(ROOT, "tests/scenarios", dir)).filter((x) => x.endsWith(".yaml"))) {
      const file = join(ROOT, "tests/scenarios", dir, f);
      const { world } = loadWorld(file);
      const env = { ...process.env, GH_SIM_WORLD: file, GH_SIM_NOW: "2026-11-09T12:00:00Z" };
      const read = (args) => run(args, env);
      const issues = read(["issue", "list", "--state", "all", "--limit", "1000", "--json", "number,state,labels,comments,createdAt,updatedAt,author,stateReason,url"]);
      const prs = read(["pr", "list", "--state", "all", "--limit", "1000", "--json", "number,state,labels,comments,headRefName,headRefOid,baseRefName,mergeStateStatus,isDraft,isCrossRepository,files,closingIssuesReferences,statusCheckRollup,mergedAt"]);
      assert.equal(issues.code, 0, `${dir}/${f}: ${issues.stderr}`);
      assert.equal(prs.code, 0, `${dir}/${f}: ${prs.stderr}`);
      assert.equal(JSON.parse(issues.stdout).length, world.issues.length, `${dir}/${f}`);
      assert.equal(JSON.parse(prs.stdout).length, world.prs.length, `${dir}/${f}`);
      for (const pr of world.prs.filter((p) => (p.checks ?? []).length > 0)) assert.equal(read(["pr", "checks", String(pr.number), "--json", "bucket"]).code, 0, `${dir}/${f} pr#${pr.number}`);
      const labels = read(["label", "list", "--limit", "300", "--json", "name"]);
      assert.equal(labels.code, 0, `${dir}/${f}: ${labels.stderr}`);
      assert.equal(JSON.parse(labels.stdout).length, (world.labels ?? []).length, `${dir}/${f}`);
      count++;
    }
  }
  assert.ok(count >= 80, `only ${count} scenarios were found`);
});

test("a PR's check buckets round-trip: the world's checks are what pr checks reports", () => {
  for (const checks of [["pass"], ["fail"], ["pending"], ["cancel"], ["pass", "pending"], ["skipping", "pass"]]) {
    assert.deepEqual(gh({ prs: [{ number: 1, checks }] }, ["pr", "checks", "1", "--json", "bucket", "--jq", "[.[].bucket]"]).json(), checks);
  }
});

test("the shepherd skill's check-state one-liner gives what checkState in scenario.mjs gives, for every world with checks", () => {
  const expr = '[.[].bucket] | if length==0 then "no-checks-yet" elif any(.=="pending") then "pending" elif any(.=="fail" or .=="cancel") then "failing" else "green" end';
  for (const checks of [["pass"], ["fail"], ["pending"], ["cancel"], ["pass", "pending"], ["pass", "pass"], ["pass", "fail", "pending"]]) {
    const pr = { number: 1, checks };
    assert.equal(gh({ prs: [pr] }, ["pr", "checks", "1", "--json", "bucket", "--jq", expr]).out.trim(), checkState(pr), JSON.stringify(checks));
  }
  // The one case where they differ is the one the skill gets wrong: with no checks `gh` prints nothing, not `[]`, so the
  // one-liner never says "no-checks-yet". The agent has to read the empty output and the error as that state.
  assert.equal(checkState({ checks: [] }), "no-checks-yet");
  assert.equal(gh({ prs: [{ number: 1, checks: [] }] }, ["pr", "checks", "1", "--json", "bucket", "--jq", expr]).out, "");
});

// ---- seeding -------------------------------------------------------------------------------------------------

test("seed makes a world file from a scenario, and reports the fields no gh call shows", () => {
  const src = join(DIR, "sc.yaml");
  writeFileSync(src, stringify({ name: "n", skill: "retrospective", world: { labels: [{ from: "labels.md" }], issues: [{ number: 90, state: "open", labels: ["agent:log"], entries: [{ run: "r1" }], kind: "bug" }] }, expect: {} }));
  for (const out of [join(DIR, "w.yaml"), join(DIR, "w.json")]) {
    const { notShown } = seed(src, out);
    assert.deepEqual(notShown, ["issue#90.entries", "issue#90.kind"]);
    const w = parse(readFileSync(out, "utf8"));
    assert.equal(w.issues[0].number, 90);
    assert.ok(w.labels.some((l) => l.name === "agent:log"), "the catalog is expanded");
    assert.equal("skill" in w || "expect" in w, false, "a world file is not a scenario");
    assert.equal(run(["issue", "list", "--json", "number", "--jq", ".[].number"], { ...process.env, GH_SIM_WORLD: out }).stdout, "90\n");
  }
});

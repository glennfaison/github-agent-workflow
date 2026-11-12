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
import { checkState, applyEffects, diffWorlds, sameWorld, canonicalWorld, checkScenario, expandScenario } from "../scripts/scenario.mjs";
import { contractOf } from "../scripts/scenario-coverage.mjs";

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

// ---- writes --------------------------------------------------------------------------------------------------

/** A world file a run can write to, and a way to run `gh` against it and read the world back. */
function run2(world, { file = `w-${++n}.yaml`, env = {} } = {}) {
  const path = join(DIR, file);
  writeFileSync(path, /\.json$/.test(file) ? JSON.stringify(world) : stringify(world));
  const e = { ...process.env, GH_SIM_WORLD: path, GH_SIM_LOG: join(DIR, `log-${path.replace(/\W/g, "")}.jsonl`), GH_SIM_NOW: "2026-11-09T12:00:00Z", ...env };
  const call = (...argv) => { const r = spawnSync(GH, argv, { encoding: "utf8", env: e }); return { out: r.stdout, err: r.stderr, code: r.status, json: () => JSON.parse(r.stdout) }; };
  return { path, env: e, call, read: () => parse(readFileSync(path, "utf8")), bytes: () => readFileSync(path, "utf8") };
}

const W2 = () => ({
  labels: [{ name: "ready-for-agent" }, { name: "agent:in-progress" }, { name: "agent:pr-open" }, { name: "agent:needs-work" }, { name: "agent:ready-for-review" }, { name: "agent:log", description: "Log" }],
  issues: [
    { number: 1, state: "open", title: "Thing", labels: ["ready-for-agent"], comments: [] },
    { number: 2, state: "closed", title: "Old", labels: [] },
  ],
  prs: [
    { number: 3, state: "open", labels: ["agent:ready-for-review"], head: "h3", base: "main", closes: [1], checks: ["pass"], comments: [] },
    { number: 4, state: "open", draft: true, labels: [], head: "h4", checks: [] },
  ],
});

test("edit adds and removes labels, one call for both, and removing a label an item lacks is fine", () => {
  const r = run2(W2());
  const out = r.call("issue", "edit", "1", "--remove-label", "ready-for-agent", "--add-label", "agent:pr-open", "--remove-label", "agent:in-progress");
  assert.equal(out.code, 0, out.err);
  assert.equal(out.out, "https://github.com/sim/repo/issues/1\n");
  assert.deepEqual(r.read().issues[0].labels, ["agent:pr-open"]);
  assert.equal(r.call("pr", "view", "3", "--json", "labels", "--jq", ".labels[].name").out, "agent:ready-for-review\n");
  assert.equal(r.call("pr", "edit", "3", "--remove-label", "agent:ready-for-review", "--add-label", "agent:needs-work").code, 0);
  assert.deepEqual(r.read().prs[0].labels, ["agent:needs-work"]);
  assert.equal(r.call("issue", "edit", "1", "--add-label", "agent:pr-open").code, 0, "adding a label it has is fine");
  assert.deepEqual(r.read().issues[0].labels, ["agent:pr-open"]);
});

test("edit sets a body (from a file or from stdin), a title, and asks for reviewers", () => {
  const r = run2(W2());
  const f = join(DIR, "body.md"); writeFileSync(f, "new body\n");
  assert.equal(r.call("issue", "edit", "1", "--body-file", f).code, 0);
  assert.equal(r.read().issues[0].body, "new body\n");
  assert.equal(spawnSync(GH, ["issue", "edit", "1", "--body-file", "-"], { input: "from stdin", encoding: "utf8", env: r.env }).status, 0);
  assert.equal(r.read().issues[0].body, "from stdin");
  assert.equal(r.call("pr", "edit", "3", "--title", "Better title", "--add-reviewer", "alice,acme/team").code, 0);
  assert.equal(r.read().prs[0].title, "Better title");
  assert.equal(r.call("pr", "view", "3", "--json", "title", "--jq", ".title").out, "Better title\n");
  assert.equal(r.call("issue", "edit", "1").err, "field to edit flag required when not running interactively\n");
  assert.equal(r.call("issue", "edit", "1", "--add-reviewer", "x").err, "unsupported: issue edit --add-reviewer\n", "reviewers are for PRs");
});

test("comment posts as the agent, with the marker the body carries, and prints the comment's URL", () => {
  const r = run2(W2());
  const marker = r.call("issue", "comment", "1", "--body", "Claimed.\n<!-- agent:lease step=Working run=r1 expires=2026-11-09T13:00:00Z -->");
  assert.match(marker.out, /^https:\/\/github\.com\/sim\/repo\/issues\/1#issuecomment-\d+\n$/);
  r.call("pr", "comment", "3", "--body", "plain words");
  const w = r.read();
  assert.deepEqual(w.issues[0].comments, [{ author: "agent", marker: "agent:lease", text: "Claimed.\n<!-- agent:lease step=Working run=r1 expires=2026-11-09T13:00:00Z -->", createdAt: "2026-11-09T12:00:00Z" }]);
  assert.deepEqual(w.prs[0].comments, [{ author: "agent", text: "plain words", createdAt: "2026-11-09T12:00:00Z" }]);
  const seen = r.call("issue", "view", "1", "--json", "comments", "--jq", ".comments[] | [.author.login, .authorAssociation, .createdAt]").out;
  assert.equal(seen, '["agent-bot","NONE","2026-11-09T12:00:00Z"]\n');
  const f = join(DIR, "c.md"); writeFileSync(f, "from a file");
  r.call("issue", "comment", "1", "--body-file", f);
  assert.equal(r.read().issues[0].comments[1].text, "from a file");
});

test("a comment the run just wrote is fresh: a ready handoff holds the merge lane", () => {
  const r = run2({ prs: [{ number: 7, state: "open", head: "h", labels: ["agent:ready-for-review"], comments: [{ author: "agent", text: "old <!-- agent:handoff kind=ready sha=h -->", createdAt: "2026-11-09T11:55:00Z" }] }] });
  const at = r.call("pr", "view", "7", "--json", "comments", "--jq", ".comments[0].createdAt").out.trim();
  assert.equal(at, "2026-11-09T11:55:00Z", "the time a comment was written is kept");
});

test("close sets the reason, can comment first, and says so when it is already closed", () => {
  const r = run2(W2());
  const out = r.call("issue", "close", "1", "--reason", "not planned", "--comment", "Duplicate of #2");
  assert.equal(out.code, 0, out.err);
  assert.equal(out.err, "✓ Closed issue sim/repo#1 (Thing)\n");
  const i = r.read().issues[0];
  assert.deepEqual([i.state, i.closeReason, i.comments.map((c) => c.text)], ["closed", "not planned", ["Duplicate of #2"]]);
  assert.equal(r.call("issue", "view", "1", "--json", "state,stateReason", "--jq", ".state + \" \" + .stateReason").out, "CLOSED NOT_PLANNED\n");
  const again = r.call("issue", "close", "1");
  assert.deepEqual([again.code, again.err], [0, "! Issue sim/repo#1 (Thing) is already closed\n"]);
  assert.equal(r.read().issues[0].comments.length, 1, "closing a closed issue changes nothing");
  assert.equal(r.call("issue", "close", "2", "--reason", "whatever").err, 'invalid argument "whatever" for "-r, --reason" flag: valid values are {completed|not planned}\n');
  assert.equal(r.read().issues[1].closeReason, undefined);
});

test("reopen opens a closed issue, and says so when it is open", () => {
  const r = run2(W2());
  r.call("issue", "close", "1", "--reason", "completed");
  assert.equal(r.call("issue", "reopen", "1", "--comment", "Back.").code, 0);
  const i = r.read().issues[0];
  assert.deepEqual([i.state, i.closeReason, i.comments.at(-1).text], ["open", undefined, "Back."]);
  assert.equal(r.call("issue", "reopen", "1").err, "! Issue sim/repo#1 (Thing) is already open\n");
});

test("issue create makes the next number, with its labels, and prints the URL", () => {
  const r = run2(W2());
  const out = r.call("issue", "create", "--title", "New log", "--body", "body text", "--label", "agent:log");
  assert.equal(out.out, "https://github.com/sim/repo/issues/5\n", "numbers are shared with PRs: the highest is 4");
  assert.deepEqual(r.read().issues.at(-1), { number: 5, state: "open", labels: ["agent:log"], comments: [], title: "New log", body: "body text", createdAt: "2026-11-09T12:00:00Z", author: "agent-bot" });
  assert.deepEqual(r.call("issue", "view", "5", "--json", "title,author,labels", "--jq", "[.title, .author.login, .labels[0].name, .labels[0].description]").out, '["New log","agent-bot","agent:log","Log"]\n');
  assert.match(r.call("issue", "create", "--title", "x").err, /must provide `--title` and `--body` when not running interactively/);
  assert.match(r.call("issue", "create", "--body", "x").err, /must provide/);
  assert.equal(r.call("issue", "create", "--title", " ", "--body", "x").err, "title can't be blank\n");
});

test("pr create opens a PR on the current branch at the current commit, linked to the issues its body closes", () => {
  const repo = join(DIR, `repo-${++n}`);
  for (const a of [["init", "-q", repo], ["-C", repo, "-c", "user.email=a@b", "-c", "user.name=n", "commit", "-q", "--allow-empty", "-m", "i"], ["-C", repo, "checkout", "-q", "-b", "feat/1-thing"]]) spawnSync("git", a);
  const sha = spawnSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
  const r = run2(W2());
  const call = (...argv) => { const x = spawnSync(GH, argv, { encoding: "utf8", env: r.env, cwd: repo }); return { out: x.stdout, err: x.stderr, code: x.status }; };
  const out = call("pr", "create", "--base", "main", "--title", "Do the thing", "--body", "Closes #1 and fixes #9.\n\nSome words.", "--label", "agent:needs-work");
  assert.equal(out.out, "https://github.com/sim/repo/pull/5\n");
  assert.deepEqual(r.read().prs.at(-1), { number: 5, state: "open", labels: ["agent:needs-work"], draft: false, head: sha, base: "main", checks: [], openFindings: 0, closes: [1], comments: [], title: "Do the thing", body: "Closes #1 and fixes #9.\n\nSome words.", createdAt: "2026-11-09T12:00:00Z", author: "agent-bot", branch: "feat/1-thing" });
  assert.deepEqual(r.call("pr", "view", "5", "--json", "headRefName,headRefOid,closingIssuesReferences", "--jq", "[.headRefName, .headRefOid, (.closingIssuesReferences | map(.number))]").out, `["feat/1-thing","${sha}",[1]]\n`, "reads see the branch and the link");
  const dup = call("pr", "create", "--base", "main", "--title", "Again", "--body", "x");
  assert.equal(dup.code, 1);
  assert.equal(dup.err, 'a pull request for branch "feat/1-thing" into branch "main" already exists:\nhttps://github.com/sim/repo/pull/5\n');
  assert.equal(call("pr", "create", "--base", "main", "--head", "other", "--title", "Other", "--body", "x", "--draft").code, 0);
  assert.equal(r.read().prs.at(-1).draft, true);
  assert.equal(call("pr", "create", "--base", "feat/1-thing", "--title", "x", "--body", "y").err, 'head branch "feat/1-thing" is the same as base branch "feat/1-thing", cannot create a pull request\n');
});

test("pr merge merges, pinned to a head, and can delete the branch", () => {
  const r = run2(W2());
  const out = r.call("pr", "merge", "3", "--match-head-commit", "h3", "--squash", "--delete-branch");
  assert.equal(out.code, 0, out.err);
  assert.equal(out.err, "✓ Squashed and merged pull request sim/repo#3 (Pull request 3)\n");
  const p = r.read().prs[0];
  assert.deepEqual([p.state, p.branchDeleted], ["merged", true]);
  assert.equal(r.read().issues[0].state, "open", "the issue it closes is not closed: the skills settle that (issue-after-pr.md)");
  assert.equal(r.call("pr", "view", "3", "--json", "state", "--jq", ".state").out, "MERGED\n");
  const again = r.call("pr", "merge", "3", "--squash");
  assert.deepEqual([again.code, again.err], [0, ""], "merging a merged PR does nothing");
  assert.match(run2(W2()).call("pr", "merge", "3", "--rebase").err, /Rebased and merged/);
  assert.match(run2(W2()).call("pr", "merge", "3", "--merge").err, /^✓ Merged pull request/);
});

test("a merge gh would refuse is refused, and changes nothing", () => {
  const cases = [
    [{ mergeState: "DIRTY" }, ["--squash"], /^X Pull request sim\/repo#3 is not mergeable: the merge commit cannot be cleanly created\./],
    [{ mergeState: "BEHIND" }, ["--squash"], /not up to date with the base branch/],
    [{ mergeState: "BLOCKED" }, ["--squash"], /the base branch policy prohibits the merge/],
    [{ draft: true }, ["--squash"], /^GraphQL: Pull request Pull request is still a draft/],
    [{ state: "closed" }, ["--squash"], /^GraphQL: Pull request is closed/],
    [{}, ["--squash", "--match-head-commit", "old"], /^GraphQL: Head branch was modified\. Review and try the merge again\./],
    [{}, [], /^--merge, --rebase, or --squash required when not running interactively/],
    [{}, ["--squash", "--rebase"], /^only one of `--merge`, `--rebase`, or `--squash` can be enabled/],
  ];
  for (const [patch, flags, want] of cases) {
    const w = W2(); Object.assign(w.prs[0], patch);
    const r = run2(w), before = r.bytes();
    const out = r.call("pr", "merge", "3", ...flags);
    assert.equal(out.code, 1, JSON.stringify([patch, flags]));
    assert.match(out.err, want);
    assert.equal(r.bytes(), before, `${JSON.stringify([patch, flags])} changed the world`);
  }
});

test("label create adds a label, updates one with --force, and refuses a duplicate without it", () => {
  const r = run2(W2());
  assert.equal(r.call("label", "create", "agent:stuck", "--color", "B60205", "--description", "Gave up", "--force").out, '✓ Label "agent:stuck" created in sim/repo\n');
  assert.deepEqual(r.read().labels.at(-1), { name: "agent:stuck", description: "Gave up", color: "B60205" });
  assert.equal(r.call("label", "list", "--json", "name,color,description", "--jq", ".[] | select(.name==\"agent:stuck\") | .color + \" \" + .description").out, "B60205 Gave up\n");
  assert.equal(r.call("label", "create", "agent:stuck", "--description", "x").err, 'label with name "agent:stuck" already exists; use `--force` to update its color and description\n');
  assert.equal(r.call("label", "create", "agent:stuck", "--description", "Updated", "--force").out, '✓ Label "agent:stuck" updated in sim/repo\n');
  assert.equal(r.read().labels.at(-1).description, "Updated");
  assert.equal(r.call("label", "create", "plain").code, 0);
  assert.equal(r.call("label", "create", "bad", "--color", "red").code, 1);
  assert.equal(r.call("issue", "edit", "1", "--add-label", "plain").code, 0, "a label that was just created can be used");
  assert.equal(run2({ issues: [] }).call("label", "create", "first").code, 0, "a world with no labels gets a catalog");
});

test("a label outside the catalog is refused, in a world that has a catalog and in no other", () => {
  const r = run2(W2()), before = r.bytes();
  for (const argv of [["issue", "edit", "1", "--add-label", "nope"], ["issue", "edit", "1", "--remove-label", "nope"], ["pr", "edit", "3", "--add-label", "ready-for-agent,nope"], ["issue", "create", "--title", "t", "--body", "b", "--label", "nope"]]) {
    const out = r.call(...argv);
    assert.deepEqual([out.code, out.err], [1, "'nope' not found\n"], argv.join(" "));
  }
  assert.equal(r.bytes(), before, "nothing was written, not even the label that was fine");
  const free = run2({ issues: [{ number: 1, state: "open" }] });
  assert.equal(free.call("issue", "edit", "1", "--add-label", "anything").code, 0);
  assert.deepEqual(free.read().issues[0].labels, ["anything"]);
});

test("a call that fails leaves the world file byte for byte as it was", () => {
  const r = run2(W2()), before = r.bytes();
  const fails = [
    ["issue", "edit", "99", "--add-label", "agent:pr-open"], ["issue", "comment", "1", "--body", ""], ["issue", "comment", "1"], ["pr", "comment", "99", "--body", "x"],
    ["issue", "close", "1", "--reason", "bad", "--comment", "x"], ["issue", "create", "--title", "t"], ["pr", "merge", "99", "--squash"],
    ["pr", "edit", "3", "--body", "a", "--body-file", "b"], ["issue", "edit", "1", "--body-file", join(DIR, "missing.md"), "--add-label", "agent:pr-open"],
    ["issue", "close", "1", "--web"],
  ];
  for (const argv of fails) { assert.notEqual(r.call(...argv).code, 0, argv.join(" ")); assert.equal(r.bytes(), before, `${argv.join(" ")} wrote`); }
});

test("a scenario file is never written to", () => {
  const sc = { name: "x", skill: "triage-github-issue", world: { issues: [{ number: 1, state: "open", labels: [] }] }, expect: {} };
  const r = run2(sc), before = r.bytes();
  const out = r.call("issue", "edit", "1", "--add-label", "x");
  assert.equal(out.code, 2);
  assert.match(out.err, /GH_SIM_WORLD is a scenario file, and the gh simulator does not write to one: make a world file with `node tests\/sim\/seed\.mjs /);
  assert.equal(r.bytes(), before);
  assert.equal(r.call("issue", "list").code, 0, "it can still be read");
});

test("a world file is written back in its own format, and is still a world file", () => {
  const r = run2(W2(), { file: "w-json.json" });
  r.call("issue", "edit", "1", "--add-label", "agent:pr-open");
  assert.equal(JSON.parse(r.bytes()).issues[0].labels.at(-1), "agent:pr-open");
  assert.deepEqual(readdirSync(DIR).filter((f) => f.endsWith(".tmp")), [], "no temporary file is left behind");
});

test("what a world holds that no gh call shows is kept through a write", () => {
  const r = run2({ issues: [{ number: 1, state: "open", labels: [], entries: [{ run: "r1" }], kind: "bug" }], prs: [{ number: 2, state: "open", head: "h", labels: [], readySha: "h", shepherdAttempts: 1, lease: "live" }] });
  r.call("issue", "edit", "1", "--add-label", "x");
  const w = r.read();
  assert.deepEqual([w.issues[0].entries, w.issues[0].kind, w.prs[0].readySha, w.prs[0].shepherdAttempts, w.prs[0].lease], [[{ run: "r1" }], "bug", "h", 1, "live"]);
});

test("every write is logged, and a refused one says so", () => {
  const r = run2(W2());
  r.call("issue", "edit", "1", "--add-label", "agent:pr-open"); r.call("issue", "edit", "1", "--add-label", "nope");
  const calls = readFileSync(r.env.GH_SIM_LOG, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(calls.map((c) => [c.exit, c.kind]), [[0, "ok"], [1, "error"]]);
});

// ---- what a run leaves behind, read by diffWorlds -------------------------------------------------------------

test("a run made of these calls is read back by diffWorlds as the effects it had, and round-trips", () => {
  const r = run2(W2());
  const before = structuredClone(r.read());
  const steps = [
    ["issue", "edit", "1", "--add-label", "agent:in-progress"],
    ["issue", "comment", "1", "--body", "Claimed. <!-- agent:lease step=Working run=r1 expires=2026-11-09T13:00:00Z -->"],
    ["pr", "edit", "3", "--remove-label", "agent:ready-for-review", "--add-label", "agent:needs-work", "--add-reviewer", "alice"],
    ["pr", "comment", "3", "--body", "Done. <!-- agent:handoff kind=ready sha=h3 -->"],
    ["pr", "merge", "3", "--squash", "--match-head-commit", "h3", "--delete-branch"],
    ["issue", "close", "1", "--reason", "completed", "--comment", "Implemented in #3."],
    ["label", "create", "agent:stuck", "--description", "Gave up"],
    ["issue", "create", "--title", "Follow-up", "--body", "b", "--label", "agent:log"],
  ];
  for (const s of steps) { const out = r.call(...s); assert.equal(out.code, 0, `${s.join(" ")}: ${out.err}`); }
  const after = r.read();
  const diff = diffWorlds(before, after);
  assert.deepEqual(diff.filter((e) => e.op === "unmodelled"), []);
  assert.deepEqual(diff.map((e) => [e.op, e.target ?? e.name ?? e.number, e.label ?? e.marker ?? e.reason ?? ""]), [
    ["create_issue", 5, ""],
    ["label_add", "issue#1", "agent:in-progress"], ["comment", "issue#1", "agent:lease"], ["comment", "issue#1", ""], ["close", "issue#1", "completed"],
    ["label_remove", "pr#3", "agent:ready-for-review"], ["label_add", "pr#3", "agent:needs-work"], ["comment", "pr#3", "agent:handoff"], ["merge", "pr#3", ""], ["delete_branch", "pr#3", ""],
    ["label_create", "agent:stuck", ""],
  ]);
  assert.deepEqual(diff[0].data, { title: "Follow-up", body: "b", createdAt: "2026-11-09T12:00:00Z", author: "agent-bot" });
  assert.ok(sameWorld(applyEffects(before, diff), after), "applyEffects(before, diff) is not the world the run left");
});

test("claim and release through lib.sh leave the world as a lease does: a label and a lease comment, then the label gone", () => {
  const r = run2(W2());
  const before = structuredClone(r.read());
  const LIB = join(ROOT, "skills/meta/agent-workflow-protocol/scripts/lib.sh");
  const sh = (cmd) => spawnSync("bash", ["-c", `source "${LIB}"; ${cmd}`], { encoding: "utf8", env: { ...r.env, PATH: `${join(ROOT, "tests/sim/bin")}:${process.env.PATH}` } });
  assert.equal(sh('claim 1 issue agent:in-progress Working "1 hour"').status, 0);
  const claimed = diffWorlds(before, r.read());
  assert.deepEqual(claimed.map((e) => [e.op, e.target, e.label ?? e.marker]), [["label_add", "issue#1", "agent:in-progress"], ["comment", "issue#1", "agent:lease"]]);
  assert.match(claimed[1].text, /^Claimed by Working run .* until \d{4}-.*\n<!-- agent:lease step=Working run=\S+ expires=\S+ -->$/);
  assert.equal(sh("has_label 1 issue agent:in-progress && echo held").stdout, "held\n", "lib.sh sees the label it just added");
  assert.equal(sh('release 1 issue agent:in-progress').status, 0);
  assert.deepEqual(diffWorlds(before, r.read()).map((e) => [e.op, e.marker]), [["comment", "agent:lease"]], "the label is gone, the lease comment stays");
  assert.equal(sh('claim 3 pr agent:in-progress Reviewing "30 min"; release 3 pr agent:in-progress').status, 0);
  assert.deepEqual(diffWorlds(before, r.read()).filter((e) => e.target === "pr#3").map((e) => e.marker), ["agent:lease"]);
  assert.equal(sh("lease_held=true claim 1 issue agent:stuck Working x").status, 0);
  assert.equal(r.read().issues[0].labels.includes("agent:stuck"), false, "a nested claim does nothing");
});

// ---- the golden scenarios, replayed ---------------------------------------------------------------------------

/** The body a run posts for a comment effect: its text, ending in its marker when it has one (`gh` does not post an empty body). */
const bodyFor = (e) => (e.marker && !(e.text ?? "").includes(`<!-- ${e.marker}`) ? `${e.text ? `${e.text} ` : ""}<!-- ${e.marker} -->` : e.text ?? "A comment.");

/** The `gh` call that makes an effect, or null when the effect is not one a `gh` call makes. */
function callFor(e) {
  const [kind, num] = (e.target ?? "").split("#");
  switch (e.op) {
    case "label_add": return [kind, "edit", num, "--add-label", e.label];
    case "label_remove": return [kind, "edit", num, "--remove-label", e.label];
    case "comment": return [kind, "comment", num, "--body", bodyFor(e)];
    case "close": return kind === "issue" ? ["issue", "close", num] : null;
    case "merge": return ["pr", "merge", num, "--squash"];
    case "delete_branch": return ["pr", "merge", num, "--squash", "--delete-branch"];
    case "label_create": return ["label", "create", e.name, ...(e.description ? ["--description", e.description] : [])];
    case "label_update": return ["label", "create", e.name, "--force", ...(e.description ? ["--description", e.description] : [])];
    case "create_issue": return ["issue", "create", "--title", "Created", "--body", "Created", ...(e.labels ?? []).flatMap((l) => ["--label", l])];
    default: return null;
  }
}

test("the effects of every golden scenario, made as gh calls, leave the world the checker says", () => {
  let replayed = 0, empty = 0;
  const skipped = [];
  for (const dir of readdirSync(join(ROOT, "tests/scenarios"))) {
    for (const f of readdirSync(join(ROOT, "tests/scenarios", dir)).filter((x) => x.endsWith(".yaml"))) {
      const sc = parse(readFileSync(join(ROOT, "tests/scenarios", dir, f), "utf8"));
      // A push and a file written in the checkout are `git` and the filesystem, not `gh`, and a review request changes no world.
      let effects = (sc.expect?.effects ?? []).filter((e) => !["review_request", "push", "write_file"].includes(e.op));
      // `gh` numbers what it creates. A scenario names its new issues with numbers of its own, so map them to the ones `gh` gives.
      const used = [...(sc.world?.issues ?? []), ...(sc.world?.prs ?? [])].map((i) => i.number), numbers = new Map();
      effects = effects.map((e) => {
        if (e.op === "create_issue") { const next = Math.max(0, ...used) + 1; used.push(next); numbers.set(`issue#${e.number}`, `issue#${next}`); return { ...e, number: next }; }
        return e.target && numbers.has(e.target) ? { ...e, target: numbers.get(e.target) } : e;
      });
      const calls = effects.map(callFor);
      if (effects.length === 0) { empty++; continue; }
      if (calls.some((c) => c === null)) { skipped.push(`${dir}/${f}`); continue; }
      const world = join(DIR, `golden-${replayed}.yaml`);
      const { world: before } = seed(join(ROOT, "tests/scenarios", dir, f), world);
      const env = { ...process.env, GH_SIM_WORLD: world, GH_SIM_NOW: "2026-11-09T12:00:00Z" };
      for (const c of calls) { const r = run(c, env); assert.equal(r.code, 0, `${dir}/${f}: gh ${c.join(" ")}: ${r.stderr}`); }
      // The checker's own account of the same effects. A comment's text is the body that was posted.
      const expected = applyEffects(before, effects.map((e) => (e.op === "comment" ? { ...e, text: bodyFor(e) } : e.op === "create_issue" ? { ...e, data: { title: "Created", body: "Created", createdAt: "2026-11-09T12:00:00Z", author: "agent-bot" } } : e)));
      const got = parse(readFileSync(world, "utf8"));
      assert.deepEqual(canonicalWorld(got), canonicalWorld(expected), `${dir}/${f}`);
      replayed++;
    }
  }
  // Not replayed: a scenario that opens a PR (its commit is a `git` fact) or syncs the label catalog (a repository op).
  // A new scenario with an effect that no `gh` call makes has to be added here on purpose.
  const NOT_REPLAYED = [
    "implement-github-issue/a-split-marker-from-a-stranger-does-not-count.yaml", "implement-github-issue/an-interrupted-pass-does-not-open-a-second-pr.yaml", "implement-github-issue/merged-pr-on-a-keep-open-issue-is-ignored.yaml",
    "setup-github-agent-workflow/an-agent-label-is-reset-and-a-triage-label-is-kept.yaml", "setup-github-agent-workflow/an-empty-repository-gets-every-label.yaml",
  ];
  assert.deepEqual(skipped.filter((f) => !NOT_REPLAYED.includes(f)), [], "a scenario has an effect that no gh call makes");
  assert.ok(replayed >= 37, `only ${replayed} scenarios were replayed`);
  assert.ok(empty >= 40, `${empty} scenarios have no effects`);
});

// ---- api ------------------------------------------------------------------------------------------------------

const W3 = () => ({
  repo: "acme/widgets",
  files: { "AGENTS.md": "rules\n", ".github/CODEOWNERS": "* @me\n", "src/a.js": "x" },
  issues: [{ number: 5, state: "open", title: "Thing", labels: [], lease: "live", comments: [{ author: "agent", marker: "agent:lease", text: "Claimed <!-- agent:lease step=Working run=r expires=2030-01-01T00:00:00Z -->" }, { author: "carol", trusted: true, text: "hi" }] }],
  prs: [
    { number: 9, state: "open", head: "h1", base: "main", mergeState: "BEHIND", files: ["a.md", "b.md"], author: "dev", association: "MEMBER", body: "<!-- agent:implements issue=5 -->", labels: ["bug"], createdAt: "2026-11-02T00:00:00Z", comments: [] },
    { number: 10, state: "merged", head: "h2", files: [], closes: [5], createdAt: "2026-11-03T00:00:00Z", branch: "bugfix/5-x" },
    { number: 11, state: "closed", head: "h3", createdAt: "2026-11-01T00:00:00Z", draft: true },
  ],
});
const API = (path) => `repos/{owner}/{repo}/${path}`;

test("api user is the agent", () => {
  assert.equal(run2(W3()).call("api", "user", "--jq", ".login").out, "agent-bot\n");
  assert.equal(run2({ ...W3(), user: "bot" }).call("api", "user", "--jq", ".login").out, "bot\n");
});

test("api lists an item's comments as the REST API does, derived ones first, for an issue and for a PR", () => {
  const r = run2(W3());
  const rows = r.call("api", API("issues/5/comments"), "--paginate", "--jq", '.[] | [.id, .user.login, .author_association, (.body | length > 0), .created_at == .updated_at] | @tsv').out.trim().split("\n");
  assert.deepEqual(rows, ["5001\tagent-bot\tNONE\ttrue\ttrue", "5002\tagent-bot\tNONE\ttrue\ttrue", "5003\tcarol\tOWNER\ttrue\ttrue"]);
  const [c] = r.call("api", API("issues/5/comments")).json();
  assert.deepEqual(Object.keys(c).sort(), ["author_association", "body", "created_at", "html_url", "id", "issue_url", "node_id", "updated_at", "url", "user"]);
  assert.equal(c.html_url, "https://github.com/acme/widgets/issues/5#issuecomment-5001");
  assert.equal(c.url, "https://api.github.com/repos/acme/widgets/issues/comments/5001");
  assert.equal(r.call("api", API("issues/9/comments"), "--jq", "length").out, "0\n", "a PR's comments are issue comments");
  assert.equal(r.call("api", API("issues/99/comments")).err, "gh: Not Found (HTTP 404)\n");
  assert.equal(r.call("api", "repos/other/repo/issues/5/comments").err, "gh: Not Found (HTTP 404)\n");
  assert.equal(r.call("api", API("issues/5/comments"), "--jq", ".[0].body | @json").out.startsWith('"<!-- agent:lease'), true, "the derived lease comment is first");
});

test("a REST comment's ids agree with what gh issue view shows", () => {
  const r = run2(W3());
  const rest = r.call("api", API("issues/5/comments"), "--jq", "[.[].html_url]").json();
  const view = r.call("issue", "view", "5", "--json", "comments", "--jq", "[.comments[].url]").json();
  assert.deepEqual(rest, view);
});

test("PATCH edits a stored comment in place, keeps its place, and is read back by diffWorlds as comment_edit", () => {
  const r = run2(W3()), before = structuredClone(r.read());
  const out = r.call("api", "-X", "PATCH", API("issues/comments/5002"), "-f", "body=Claimed again <!-- agent:lease step=Working run=r2 expires=2031-01-01T00:00:00Z -->");
  assert.equal(out.code, 0, out.err);
  const c = JSON.parse(out.out);
  assert.deepEqual([c.id, c.body.slice(0, 14), c.updated_at], [5002, "Claimed again ", "2026-11-09T12:00:00Z"]);
  const w = r.read();
  assert.deepEqual(w.issues[0].comments[0], { author: "agent", marker: "agent:lease", text: "Claimed again <!-- agent:lease step=Working run=r2 expires=2031-01-01T00:00:00Z -->", updatedAt: "2026-11-09T12:00:00Z" });
  assert.equal(w.issues[0].comments.length, 2, "edited, not added");
  assert.deepEqual(diffWorlds(before, w), [{ op: "comment_edit", target: "issue#5", index: 0, text: w.issues[0].comments[0].text }]);
  assert.ok(sameWorld(applyEffects(before, diffWorlds(before, w)), w));
  assert.match(r.call("api", API("issues/5/comments"), "--jq", ".[1].updated_at").out, /^2026-11-09T12:00:00Z$/m);
  const other = r.call("api", "-X", "PATCH", API("issues/comments/5003"), "-f", "body=changed by the agent");
  assert.equal(other.code, 0, "the simulator does not model who may edit a comment");
});

test("PATCH of a comment that does not exist, without a body, or that is a view of a world field, fails", () => {
  const r = run2(W3()), before = r.bytes();
  assert.equal(r.call("api", "-X", "PATCH", API("issues/comments/5999"), "-f", "body=x").err, "gh: Not Found (HTTP 404)\n");
  assert.equal(r.call("api", "-X", "PATCH", API("issues/comments/77001"), "-f", "body=x").err, "gh: Not Found (HTTP 404)\n");
  assert.equal(r.call("api", "-X", "PATCH", API("issues/comments/5002")).err, "gh: Validation Failed (HTTP 422)\n");
  const derived = r.call("api", "-X", "PATCH", API("issues/comments/5001"), "-f", "body=x");
  assert.match(derived.err, /^unsupported: api PATCH of a comment the simulator derives from a world field/);
  assert.equal(r.bytes(), before);
  const sc = run2({ skill: "s", world: W3(), expect: {} });
  const refused = sc.call("api", "-X", "PATCH", API("issues/comments/5002"), "-f", "body=x");
  assert.equal(refused.code, 2);
  assert.match(refused.err, /scenario file/);
});

test("api pulls/N/files lists a PR's files, and a PR that is not there is a 404", () => {
  const r = run2(W3());
  assert.equal(r.call("api", API("pulls/9/files"), "--paginate", "--jq", ".[] | .filename, (.previous_filename // empty)").out, "a.md\nb.md\n");
  assert.equal(r.call("api", API("pulls/10/files")).out, "[]\n");
  assert.equal(r.call("api", API("pulls/99/files")).err, "gh: Not Found (HTTP 404)\n");
  assert.deepEqual(Object.keys(r.call("api", API("pulls/9/files")).json()[0]).sort(), ["additions", "changes", "deletions", "filename", "sha", "status"]);
});

test("a PR's files can name the file a rename came from, and a comment can carry its own association", () => {
  const r = run2({ prs: [{ number: 3, state: "open", files: ["a.md", { path: "docs/b.md", previous: "scripts/old.sh" }] }], issues: [{ number: 1, comments: [{ author: "dev", association: "MEMBER", text: "x" }, { author: "dev", trusted: true, association: "NONE", text: "y" }, { author: "dev", trusted: true, text: "z" }] }] });
  assert.equal(r.call("api", API("pulls/3/files"), "--jq", ".[] | .filename, (.previous_filename // empty)").out, "a.md\ndocs/b.md\nscripts/old.sh\n");
  assert.equal(r.call("pr", "view", "3", "--json", "files", "--jq", "[.files[].path]").out, '["a.md","docs/b.md"]\n');
  assert.equal(r.call("api", API("issues/1/comments"), "--jq", "[.[].author_association]").out, '["MEMBER","NONE","OWNER"]\n', "an explicit association wins over trusted");
});

test("api contents is raw with the raw Accept header, a base64 object without it, and a 404 for a file that is not there", () => {
  const r = run2(W3());
  assert.equal(r.call("api", "-H", "Accept: application/vnd.github.raw", API("contents/AGENTS.md?ref=main")).out, "rules\n");
  assert.equal(r.call("api", "-H", "Accept: application/vnd.github.raw", API("contents/.github/CODEOWNERS?ref=feat")).out, "* @me\n");
  const j = r.call("api", API("contents/AGENTS.md")).json();
  assert.deepEqual([j.type, j.path, j.encoding, Buffer.from(j.content, "base64").toString()], ["file", "AGENTS.md", "base64", "rules\n"]);
  const miss = r.call("api", "-H", "Accept: application/vnd.github.raw", API("contents/nope.md?ref=main"));
  assert.deepEqual([miss.code, miss.out, miss.err], [1, "", "gh: Not Found (HTTP 404)\n"]);
  assert.equal(run2({}).call("api", "-H", "Accept: application/vnd.github.raw", API("contents/AGENTS.md")).code, 1, "a world with no files has none");
});

test("api git/trees lists the blobs and the directories of the files the world has", () => {
  const r = run2(W3());
  assert.equal(r.call("api", API("git/trees/HEAD?recursive=1"), "--jq", '.tree[] | select(.type == "blob") | .path').out, ".github/CODEOWNERS\nAGENTS.md\nsrc/a.js\n");
  assert.equal(r.call("api", API("git/trees/HEAD?recursive=1"), "--jq", '[.tree[] | select(.type == "tree") | .path]').out, '[".github","src"]\n');
  assert.equal(run2({}).call("api", API("git/trees/HEAD?recursive=1"), "--jq", ".tree | length").out, "0\n");
  assert.match(r.call("api", API("git/trees/HEAD")).err, /^unsupported: api GET repos\/acme\/widgets\/git\/trees\/HEAD \(only HEAD with recursive=1\)/);
});

test("api pulls lists the PRs as REST objects, newest first, paged, with the author's association", () => {
  const r = run2(W3());
  const rows = (q, ...more) => r.call("api", API(`pulls?${q}`), ...more, "--jq", '.[] | [.number, .state, .head.ref, .author_association, .user.login, .merged_at != null, .draft] | @tsv').out.trim().split("\n");
  assert.deepEqual(rows("state=all&per_page=100&page=1"), ["10\tclosed\tbugfix/5-x\tNONE\tagent-bot\ttrue\tfalse", "9\topen\tfeat/9-pr-9\tMEMBER\tdev\tfalse\tfalse", "11\tclosed\tfeat/11-pr-11\tNONE\tagent-bot\tfalse\ttrue"], "newest first, by createdAt");
  assert.deepEqual(rows("state=open").map((x) => x.split("\t")[0]), ["9"]);
  assert.deepEqual(rows("state=closed").map((x) => x.split("\t")[0]), ["10", "11"], "closed includes merged, as the API does");
  assert.deepEqual(rows("state=all&per_page=1&page=2").map((x) => x.split("\t")[0]), ["9"], "the second of three, newest first");
  assert.equal(rows("state=all&per_page=1&page=4")[0], "", "a page past the end is empty");
  assert.deepEqual(rows("state=all&per_page=1", "--paginate").length, 3, "--paginate returns them all");
  assert.equal(r.call("api", API("pulls?state=bogus")).err, "gh: Validation Failed (HTTP 422)\n");
  const p = r.call("api", API("pulls/9")).json();
  assert.deepEqual([p.number, p.head.sha, p.base.ref, p.author_association, p.labels.map((l) => l.name), p.html_url], [9, "h1", "main", "MEMBER", ["bug"], "https://github.com/acme/widgets/pull/9"]);
  assert.equal(r.call("api", API("pulls/99")).err, "gh: Not Found (HTTP 404)\n");
});

test("update-branch gives a BEHIND PR a new head and brings it up to date, and refuses what GitHub refuses", () => {
  const r = run2(W3()), before = structuredClone(r.read());
  const ok = r.call("api", "-X", "PUT", API("pulls/9/update-branch"), "-f", "expected_head_sha=h1");
  assert.equal(ok.code, 0, ok.err);
  assert.deepEqual(ok.json(), { message: "Updating pull request branch.", url: "https://api.github.com/repos/acme/widgets/pulls/9" });
  assert.equal(r.call("pr", "view", "9", "--json", "headRefOid,mergeStateStatus", "--jq", '.headRefOid + " " + .mergeStateStatus').out, "h1+ CLEAN\n");
  assert.deepEqual(diffWorlds(before, r.read()), [{ op: "push", target: "pr#9", sha: "h1+" }]);
  assert.ok(sameWorld(applyEffects(before, diffWorlds(before, r.read())), r.read()));
  assert.equal(r.call("api", "-X", "PUT", API("pulls/9/update-branch")).err, "gh: There are no new commits on the base branch. (HTTP 422)\n", "it is up to date now");
  const cases = [
    [{ mergeState: "BEHIND" }, ["-f", "expected_head_sha=old"], "gh: expected head sha didn't match current head ref. (HTTP 422)"],
    [{ mergeState: "DIRTY" }, [], "gh: merge conflict between base and head (HTTP 422)"],
    [{ mergeState: "CLEAN" }, [], "gh: There are no new commits on the base branch. (HTTP 422)"],
    [{ mergeState: "BEHIND", state: "closed" }, [], "gh: Pull request is not open (HTTP 422)"],
  ];
  for (const [patch, flags, want] of cases) {
    const w = W3(); Object.assign(w.prs[0], patch);
    const x = run2(w), was = x.bytes();
    const out = x.call("api", "-X", "PUT", API("pulls/9/update-branch"), ...flags);
    assert.deepEqual([out.code, out.err.trim()], [1, want], JSON.stringify(patch));
    assert.equal(x.bytes(), was, "a refused update changes nothing");
  }
  assert.equal(r.call("api", "-X", "PUT", API("pulls/99/update-branch")).err, "gh: Not Found (HTTP 404)\n");
});

const W4 = () => ({
  repo: "acme/widgets",
  issues: [
    { number: 1, state: "open", title: "Epic", labels: ["ready-for-agent"], body: "big" },
    { number: 2, state: "open", title: "Slice", parent: 1 },
    { number: 3, state: "closed", title: "Slice 2", parent: 1, closeReason: "not planned" },
    { number: 4, state: "open", title: "Grandchild", parent: 2 },
    { number: 5, state: "open", title: "Loose" },
  ],
});

test("api reads an issue, with an id the sub-issue API takes", () => {
  const r = run2(W4());
  const i = r.call("api", API("issues/3")).json();
  assert.deepEqual([i.number, i.id, i.state, i.state_reason, i.title, i.html_url], [3, 200003, "closed", "not_planned", "Slice 2", "https://github.com/acme/widgets/issues/3"]);
  assert.equal(r.call("api", API("issues/1"), "--jq", ".id").out, "200001\n");
  assert.equal(r.call("api", API("issues/1"), "--jq", "[.labels[].name]").out, '["ready-for-agent"]\n');
  assert.equal(r.call("api", API("issues/99")).err, "gh: Not Found (HTTP 404)\n");
});

test("api reads an issue's parent, and a 404 is how an issue with none answers", () => {
  const r = run2(W4());
  assert.equal(r.call("api", API("issues/2/parent"), "--jq", ".number").out, "1\n");
  assert.equal(r.call("api", API("issues/4/parent"), "--jq", ".number").out, "2\n");
  const top = r.call("api", API("issues/1/parent"), "--jq", ".number");
  assert.deepEqual([top.code, top.out, top.err], [1, "", "gh: Not Found (HTTP 404)\n"]);
  assert.equal(r.call("api", API("issues/99/parent")).err, "gh: Not Found (HTTP 404)\n");
  const dangling = run2({ issues: [{ number: 2, state: "open", parent: 77 }] });
  assert.equal(dangling.call("api", API("issues/2/parent")).code, 1, "a parent the world does not hold is not found");
});

test("api lists an issue's sub-issues, oldest number first", () => {
  const r = run2(W4());
  assert.equal(r.call("api", API("issues/1/sub_issues"), "--paginate", "--jq", ".[].number").out, "2\n3\n");
  assert.equal(r.call("api", API("issues/5/sub_issues"), "--jq", "length").out, "0\n");
  assert.equal(r.call("api", API("issues/99/sub_issues")).err, "gh: Not Found (HTTP 404)\n");
  assert.equal(r.call("api", API("issues/1/sub_issues?per_page=1&page=2"), "--jq", ".[].number").out, "3\n");
});

test("POST sub_issues links an issue by id, and the link is read back", () => {
  const r = run2(W4());
  const id = r.call("api", API("issues/5"), "--jq", ".id").out.trim();
  const out = r.call("api", "-X", "POST", API("issues/1/sub_issues"), "-F", `sub_issue_id=${id}`);
  assert.equal(out.code, 0, out.err);
  assert.equal(out.json().number, 1, "it answers with the parent");
  assert.equal(r.read().issues[4].parent, 1);
  assert.equal(r.call("api", API("issues/5/parent"), "--jq", ".number").out, "1\n");
  assert.equal(r.call("api", API("issues/1/sub_issues"), "--jq", "[.[].number]").out, "[2,3,5]\n");
});

test("a sub-issue link GitHub would refuse is refused, and changes nothing", () => {
  const r = run2(W4()), before = r.bytes();
  const link = (parent, child, extra = []) => r.call("api", "-X", "POST", API(`issues/${parent}/sub_issues`), "-F", `sub_issue_id=${child}`, ...extra);
  assert.equal(link(1, 200001).err, "gh: An issue cannot be a sub-issue of itself (HTTP 422)\n");
  assert.equal(link(1, 200002).err, "gh: Issue may not have more than one parent (HTTP 422)\n");
  assert.equal(link(4, 200001).err, "gh: Issue would create a cycle of sub-issues (HTTP 422)\n", "1 is 4's grandparent");
  assert.equal(link(5, 123).err, "gh: Not Found (HTTP 404)\n", "no issue has that id");
  assert.equal(link(99, 200005).err, "gh: Not Found (HTTP 404)\n");
  assert.equal(r.call("api", "-X", "POST", API("issues/1/sub_issues")).err, "gh: Not Found (HTTP 404)\n", "no id given");
  assert.equal(r.bytes(), before);
  const sc = run2({ skill: "s", world: W4(), expect: {} });
  const refused = sc.call("api", "-X", "POST", API("issues/1/sub_issues"), "-F", "sub_issue_id=200005");
  assert.equal(refused.code, 2);
  assert.match(refused.err, /scenario file/);
});

test("a run that files an issue and links it leaves its parent in the create effect, and linking an old issue is unmodelled", () => {
  const r = run2(W4()), before = structuredClone(r.read());
  const made = r.call("issue", "create", "--title", "Add the parser", "--body", "Part of #1.");
  const n = Number(made.out.trim().split("/").pop());
  assert.equal(r.call("api", "-X", "POST", API("issues/1/sub_issues"), "-F", `sub_issue_id=${200000 + n}`).code, 0);
  const diff = diffWorlds(before, r.read());
  assert.deepEqual(diff.filter((e) => e.op === "unmodelled"), []);
  assert.deepEqual(diff.find((e) => e.op === "create_issue").data, { title: "Add the parser", body: "Part of #1.", createdAt: diff[0].data.createdAt, author: "agent-bot", parent: 1 });
  assert.ok(sameWorld(applyEffects(before, diff), r.read()));
  const old = run2(W4());
  const b2 = structuredClone(old.read());
  old.call("api", "-X", "POST", API("issues/1/sub_issues"), "-F", "sub_issue_id=200005");
  assert.deepEqual(diffWorlds(b2, old.read()).map((e) => [e.op, e.field]), [["unmodelled", "parent"]], "an issue that already existed gets its parent as a change no effect can express");
});

test("api refuses what it does not model, and says what", () => {
  const r = run2(W3());
  for (const [argv, want] of [
    [["api", "graphql", "-f", "query=x"], /^unsupported: api POST graphql/],
    [["api", API("issues/5/labels")], /^unsupported: api GET repos\/acme\/widgets\/issues\/5\/labels/],
    [["api", "-X", "DELETE", API("issues/comments/5002")], /^unsupported: api DELETE/],
    [["api", "-X", "GET", API("issues/5/comments"), "-f", "per_page=1"], /^unsupported: api GET with -f or -F/],
    [["api", API("issues/5/comments"), "-f", "per_page=1"], /^unsupported: api POST repos\/acme\/widgets\/issues\/5\/comments/],
    [["api", "-X", "PATCH", API("issues/comments/5002"), "-F", "body=@file"], /^unsupported: api -F @file/],
    [["api", API("issues/5/comments"), "--input", "x"], /^unsupported: api --input/],
    [["api"], /^unsupported: api without exactly one endpoint/],
    [["api", API("issues/5/comments"), "-f", "novalue"], /requires a value separated by an '=' sign/],
  ]) { const out = r.call(...argv); assert.equal(out.code, 1, argv.join(" ")); assert.match(out.err, want, argv.join(" ")); }
  assert.equal(readFileSync(r.env.GH_SIM_LOG, "utf8").trim().split("\n").filter((l) => JSON.parse(l).kind === "unsupported").length, 8);
});

test("no gh command is left as planned: every one is supported or out of scope", () => {
  assert.deepEqual(Object.entries(SURFACE).filter(([, st]) => st === "planned"), []);
});

// ---- faults ----------------------------------------------------------------------------------------------------

test("a fault makes the call it matches fail, changes nothing, and is marked in the log", () => {
  const w = W2(); w.faults = [{ match: "pr merge", fail: "X Pull request sim/repo#3 is not mergeable: the base branch policy prohibits the merge." }];
  const r = run2(w), before = r.bytes();
  const out = r.call("pr", "merge", "3", "--squash");
  assert.deepEqual([out.code, out.out, out.err], [1, "", "X Pull request sim/repo#3 is not mergeable: the base branch policy prohibits the merge.\n"]);
  assert.equal(r.bytes(), before);
  const [call] = readFileSync(r.env.GH_SIM_LOG, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual([call.exit, call.kind, call.fault], [1, "fault", 0]);
  assert.equal(r.call("pr", "view", "3", "--json", "state", "--jq", ".state").out, "OPEN\n", "a call that does not match is not touched");
  assert.equal(r.call("pr", "merge", "4", "--squash").err.includes("not mergeable"), true, "it matches any PR");
});

test("a fault matches whole words of the call, from the start", () => {
  const w = W2(); w.faults = [{ match: "api -X PATCH", fail: "HTTP 500" }, { match: "pr merge 3", fail: "only PR 3" }, { match: "label", fail: "labels down", exit: 4 }];
  const r = run2(w);
  assert.equal(r.call("api", "-X", "PATCH", API("issues/comments/1001"), "-f", "body=x").err, "HTTP 500\n");
  assert.equal(r.call("api", "user").code, 0, "a GET is another call");
  assert.equal(r.call("pr", "merge", "3", "--squash").err, "only PR 3\n");
  assert.equal(r.call("pr", "merge", "33", "--squash").err.includes("only PR 3"), false, "pr merge 3 is not pr merge 33");
  const l = r.call("label", "list");
  assert.deepEqual([l.code, l.err], [4, "labels down\n"], "the exit code is the fault's own");
  assert.equal(r.call("labels").err, "unsupported: labels\n", "`label` does not match `labels`");
});

test("times limits a fault, counted in the log, and each fault counts its own", () => {
  const w = W2(); w.faults = [{ match: "issue edit", fail: "flaky", times: 2 }, { match: "issue comment", fail: "down", times: 1 }];
  const r = run2(w);
  const edit = () => r.call("issue", "edit", "1", "--add-label", "agent:in-progress");
  assert.deepEqual([edit().code, edit().code, edit().code], [1, 1, 0], "it fires twice, and then the call goes through");
  assert.deepEqual(r.read().issues[0].labels, ["ready-for-agent", "agent:in-progress"]);
  assert.equal(r.call("issue", "comment", "1", "--body", "x").err, "down\n");
  assert.equal(r.call("issue", "comment", "1", "--body", "x").code, 0);
  assert.deepEqual(readFileSync(r.env.GH_SIM_LOG, "utf8").trim().split("\n").map((l) => JSON.parse(l).fault ?? null), [0, 0, null, 1, null]);
  const nolog = spawnSync(GH, ["issue", "edit", "1", "--add-label", "x"], { encoding: "utf8", env: { ...r.env, GH_SIM_LOG: "" } });
  assert.deepEqual([nolog.status, /needs GH_SIM_LOG/.test(nolog.stderr)], [2, true]);
});

test("a fault is counted by its definition: a different fault at the same place starts fresh, the same one does not", () => {
  const w = W2(); w.faults = [{ match: "issue edit", fail: "first", times: 1 }];
  const r = run2(w);
  const edit = () => r.call("issue", "edit", "1", "--add-label", "agent:in-progress");
  assert.deepEqual([edit().err, edit().code], ["first\n", 0]);
  const rewrite = (faults) => { const x = r.read(); x.faults = faults; writeFileSync(r.path, stringify(x)); };
  rewrite([{ match: "issue edit", fail: "second", times: 1 }]); // another fault, at index 0 again
  assert.deepEqual([edit().err, edit().code], ["second\n", 0], "it is not spent by what the first one did");
  rewrite([{ match: "issue edit", fail: "first", times: 1 }]); // the first one, written again
  assert.equal(edit().code, 0, "it is still spent");
  const ids = readFileSync(r.env.GH_SIM_LOG, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((c) => c.fault !== undefined);
  assert.deepEqual(ids.map((c) => c.fault), [0, 0]);
  assert.equal(new Set(ids.map((c) => c.faultId)).size, 2);
  assert.match(ids[0].faultId, /^[0-9a-f]{10}$/);
});

test("a fault's before effects change the world first, as another run getting in ahead of this call", () => {
  const w = W2(); w.faults = [{ match: "issue create", before: [{ op: "create_issue", number: 6, labels: ["agent:log"], data: { title: "racing run", body: "" } }], times: 1 }];
  const r = run2(w);
  const out = r.call("issue", "create", "--title", "mine", "--body", "b", "--label", "agent:log");
  assert.equal(out.out, "https://github.com/sim/repo/issues/7\n", "the number after the one that got in first");
  assert.deepEqual(r.read().issues.map((i) => i.number), [1, 2, 6, 7]);
  assert.equal(JSON.parse(readFileSync(r.env.GH_SIM_LOG, "utf8").trim()).fault, 0, "the call is marked as met by a fault");
  const both = W2(); both.faults = [{ match: "pr merge", before: [{ op: "comment", target: "pr#3", marker: "agent:handoff", text: "a human spoke" }], fail: "changed under you" }];
  const b = run2(both);
  assert.equal(b.call("pr", "merge", "3", "--squash").err, "changed under you\n");
  assert.equal(b.read().prs[0].comments.at(-1).text, "a human spoke", "the effects stay when the call fails");
  const sc = run2({ skill: "s", world: both, expect: {} });
  const refused = sc.call("pr", "merge", "3", "--squash");
  assert.equal(refused.code, 2);
  assert.match(refused.err, /scenario file/);
  assert.equal(run2({ skill: "s", world: { ...W2(), faults: [{ match: "pr merge", fail: "x" }] }, expect: {} }).call("pr", "merge", "3", "--squash").err, "x\n", "a fault that only fails can meet a scenario file");
});

test("a fault written wrong is refused when the world is read", () => {
  for (const [fault, want] of [[{ fail: "x" }, /fault 0 needs a `match`/], [{ match: "pr merge" }, /fault 0 needs a `fail` message or `before` effects/], [{ match: "pr merge", fail: "x", times: 0 }, /`times` to be a whole number above 0/], [{ match: "", fail: "x" }, /a `match`/]]) {
    const out = run2({ ...W2(), faults: [fault] }).call("issue", "list");
    assert.equal(out.code, 2, JSON.stringify(fault));
    assert.match(out.err, want);
  }
});

test("a fault does not show in the diff: the world's faults are not state", () => {
  const w = W2(); w.faults = [{ match: "pr merge", fail: "nope", times: 1 }];
  const r = run2(w), before = structuredClone(r.read());
  r.call("pr", "merge", "3", "--squash"); r.call("issue", "edit", "1", "--add-label", "agent:in-progress");
  assert.deepEqual(diffWorlds(before, r.read()).map((e) => e.op), ["label_add"]);
});

test("a golden scenario whose world carries faults is judged as it was, and the diff does not see them", () => {
  let n = 0;
  for (const dir of readdirSync(join(ROOT, "tests/scenarios"))) {
    for (const f of readdirSync(join(ROOT, "tests/scenarios", dir)).filter((x) => x.endsWith(".yaml"))) {
      const sc = expandScenario(parse(readFileSync(join(ROOT, "tests/scenarios", dir, f), "utf8")));
      const withFaults = structuredClone(sc);
      withFaults.world = { ...(sc.world ?? {}), faults: [{ match: "pr merge", fail: "not mergeable", times: 1 }, { match: "api -X PATCH", fail: "HTTP 500" }] };
      assert.deepEqual(checkScenario(contractOf(sc.skill), withFaults), [], `${dir}/${f}`);
      // The world a run starts from and the one it leaves both carry the faults, so they are no part of what the run did.
      const effects = (sc.expect?.effects ?? []).filter((e) => !["unmodelled", "push", "write_file"].includes(e.op) && e.op !== "labels_sync");
      assert.deepEqual(diffWorlds(withFaults.world, applyEffects(withFaults.world, effects)), diffWorlds(sc.world ?? {}, applyEffects(sc.world ?? {}, effects)), `${dir}/${f}`);
      n++;
    }
  }
  assert.ok(n >= 80);
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

// The world a simulated `gh` answers from, and how each part of it looks through `gh`.
// The world file is the scenarios' format (tests/scenarios, scripts/scenario.mjs): issues, prs, labels, files.

import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { parse, stringify } from "yaml";
import { expandScenario } from "../../scripts/scenario.mjs";

/** An error the simulator reports as `gh` would: a message on stderr and an exit code. */
export class SimError extends Error {
  constructor(message, { code = 1, kind = "error" } = {}) {
    super(message);
    this.code = code;
    this.kind = kind;
  }
}
export const unsupported = (what) => new SimError(`unsupported: ${what}`, { kind: "unsupported" });

// ---- the fields `gh` accepts for --json, copied from `gh` v2.80 (api/query_builder.go) ---------------------

const SHARED = ["assignees", "author", "body", "closed", "comments", "createdAt", "closedAt", "id", "labels", "milestone", "number", "projectCards", "projectItems", "reactionGroups", "state", "title", "updatedAt", "url"];
export const GH_FIELDS = {
  issue: [...SHARED, "isPinned", "stateReason", "closedByPullRequestsReferences", "issueType", "parent", "subIssues", "subIssuesSummary", "blockedBy", "blocking"],
  pr: [
    ...SHARED, "additions", "autoMergeRequest", "baseRefName", "baseRefOid", "changedFiles", "closingIssuesReferences", "commits", "deletions", "files",
    "fullDatabaseId", "headRefName", "headRefOid", "headRepository", "headRepositoryOwner", "isCrossRepository", "isDraft", "latestReviews",
    "maintainerCanModify", "mergeable", "mergeCommit", "mergedAt", "mergedBy", "mergeStateStatus", "potentialMergeCommit", "reviewDecision",
    "reviewRequests", "reviews", "statusCheckRollup",
  ],
  check: ["name", "state", "startedAt", "completedAt", "link", "bucket", "event", "workflow", "description"],
  label: ["color", "createdAt", "description", "id", "isDefault", "name", "updatedAt", "url"],
  repo: ["archivedAt", "assignableUsers", "codeOfConduct", "contactLinks", "createdAt", "defaultBranchRef", "deleteBranchOnMerge", "description", "diskUsage", "forkCount", "fundingLinks", "hasDiscussionsEnabled", "hasIssuesEnabled", "hasProjectsEnabled", "hasWikiEnabled", "homepageUrl", "id", "isArchived", "isBlankIssuesEnabled", "isEmpty", "isFork", "isInOrganization", "isMirror", "isPrivate", "isSecurityPolicyEnabled", "isTemplate", "isUserConfigurationRepository", "issueTemplates", "issues", "labels", "languages", "latestRelease", "licenseInfo", "mentionableUsers", "mergeCommitAllowed", "milestones", "mirrorUrl", "name", "nameWithOwner", "openGraphImageUrl", "owner", "parent", "primaryLanguage", "projects", "projectsV2", "pullRequestTemplates", "pullRequests", "pushedAt", "rebaseMergeAllowed", "repositoryTopics", "securityPolicyUrl", "squashMergeAllowed", "sshUrl", "stargazerCount", "templateRepository", "updatedAt", "url", "usesCustomOpenGraphImage", "viewerCanAdminister", "viewerDefaultCommitEmail", "viewerDefaultMergeMethod", "viewerHasStarred", "viewerPermission", "viewerPossibleCommitEmails", "viewerSubscription", "visibility", "watchers"],
};

// ---- loading ---------------------------------------------------------------------------------------------

export const CHECK_VALUES = ["pass", "fail", "pending", "cancel", "skipping"];

// Fields a scenario keeps for the oracles that stand for facts a model would read from prose (a body, a log
// entry). They are not GitHub state, so no `gh` call shows them.
export const NOT_SHOWN = { issue: ["entries", "kind", "openQuestions", "useCase", "wontfix"], pr: ["marker"] };

/**
 * Reads a world file: a bare world, or a scenario file (its `world:`). The label catalog is expanded.
 * @returns {{ world: object, scenario: boolean, notShown: string[] }}
 */
export function loadWorld(file) {
  let text;
  try { text = readFileSync(file, "utf8"); } catch { throw new SimError(`GH_SIM_WORLD: cannot read ${file}`, { code: 2 }); }
  let doc;
  try { doc = parse(text) ?? {}; } catch (e) { throw new SimError(`GH_SIM_WORLD: ${file} is not valid YAML or JSON: ${e.message}`, { code: 2 }); }
  const scenario = "skill" in doc || "expect" in doc;
  const world = expandScenario({ world: scenario ? doc.world ?? {} : doc }).world;
  world.issues ??= []; world.prs ??= [];
  for (const pr of world.prs) for (const c of pr.checks ?? []) {
    if (!CHECK_VALUES.includes(c)) throw new SimError(`GH_SIM_WORLD: pr#${pr.number} has a check \`${c}\`; a check is one of ${CHECK_VALUES.join(", ")}`, { code: 2 });
  }
  const notShown = [];
  for (const [kind, key] of [["issue", "issues"], ["pr", "prs"]]) {
    for (const it of world[key]) for (const f of NOT_SHOWN[kind]) if (f in it) notShown.push(`${kind}#${it.number}.${f}`);
  }
  return { world, scenario, notShown };
}

/**
 * Writes the world back to its file, whole and atomically (a file is written beside it and renamed), in the file's own
 * format: JSON for `.json`, YAML otherwise. A call that fails never reaches this, so a failed write leaves the file as it was.
 */
export function saveWorld(file, world) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, /\.json$/.test(file) ? JSON.stringify(world, null, 2) + "\n" : stringify(world));
  renameSync(tmp, file);
}

// ---- the context a call runs in --------------------------------------------------------------------------

/** owner, name, the agent's login, the clock. `GH_SIM_NOW` (an ISO time) fixes the clock for a test. */
export function contextOf(world, env = process.env) {
  const [owner = "sim", name = "repo"] = typeof world.repo === "string" ? world.repo.split("/") : [world.repo?.owner, world.repo?.name];
  const now = env.GH_SIM_NOW ? Date.parse(env.GH_SIM_NOW) : Date.now();
  if (Number.isNaN(now)) throw new SimError(`GH_SIM_NOW: \`${env.GH_SIM_NOW}\` is not a time`, { code: 2 });
  const labels = new Map((world.labels ?? []).map((l) => [l.name, l]));
  return {
    owner, name, nameWithOwner: `${owner}/${name}`, user: world.user ?? "agent-bot", now,
    defaultBranch: world.default_branch ?? "main", world, labels,
  };
}

export const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const MINUTE = 60_000;

/** An item with no `createdAt` is created at a fixed time, one minute per number, so that order is stable. */
export const createdAt = (it) => it.createdAt ? iso(Date.parse(it.createdAt)) : iso(Date.UTC(2026, 0, 1) + it.number * MINUTE);

// ---- comments --------------------------------------------------------------------------------------------

function bodyOf(c) {
  let b = c.text ?? c.body ?? (c.marker ? "" : "A comment.");
  if (c.marker && !b.includes(`<!-- ${c.marker}`)) b = `${b}${b ? " " : ""}<!-- ${c.marker} -->`;
  return b;
}

// What the world keeps as state, shown as the comments a real repository would hold for it, so that the
// marker readers in lib.sh find them. They are views: nothing here is stored back.
function derivedComments(ctx, kind, it) {
  const out = [];
  const agent = (body, at) => out.push({ login: ctx.user, association: "NONE", body, at });
  const has = (re) => (it.comments ?? []).some((c) => re.test(bodyOf(c)));
  const expires = (ms) => iso(ctx.now + ms);
  if (it.lease === "live") agent(`<!-- agent:lease step=Working run=sim expires=${expires(60 * MINUTE)} -->`);
  if (it.lease === "stale") agent(`<!-- agent:lease step=Working run=sim expires=${expires(-60 * MINUTE)} -->`);
  if (kind === "pr") {
    const sha = it.readySha ?? it.head;
    if ((it.readySha !== undefined || (it.labels ?? []).includes("agent:ready-for-review")) && !has(/agent:handoff kind=ready/)) {
      agent(`Ready for review. <!-- agent:handoff kind=ready sha=${sha} -->`, iso(it.readyAt ? Date.parse(it.readyAt) : ctx.now - 10 * MINUTE));
    }
    if ((it.openFindings ?? 0) > 0 && !has(/agent:handoff kind=review/)) agent(`Review findings. <!-- agent:handoff kind=review sha=${it.head} open=${it.openFindings} -->`);
    for (let i = 1; i <= (it.shepherdAttempts ?? 0); i++) agent(`<!-- agent:attempt step=shepherding run=sim-${i} -->`);
  }
  return out;
}

/** Every comment on an item, oldest first: login, association, body, createdAt, id and url. */
export function commentsOf(ctx, kind, it) {
  const base = Date.parse(createdAt(it));
  const stored = (it.comments ?? []).map((c) => ({
    login: c.author === "agent" ? ctx.user : c.author === "human" || c.author === undefined ? "someone" : c.author,
    association: c.trusted ? "OWNER" : "NONE",
    body: bodyOf(c),
    at: c.createdAt,
  }));
  return [...derivedComments(ctx, kind, it), ...stored].map((c, i) => {
    const id = (it.number * 1000) + i + 1;
    return { ...c, createdAt: c.at ?? iso(base + (i + 1) * MINUTE), id, url: `https://github.com/${ctx.nameWithOwner}/${kind === "pr" ? "pull" : "issues"}/${it.number}#issuecomment-${id}` };
  });
}

// ---- items as `gh --json` shows them ---------------------------------------------------------------------

const person = (login) => ({ id: `U_${login}`, is_bot: false, login, name: "" });
const labelsOf = (ctx, it) => (it.labels ?? []).map((n) => ({ id: `LA_${n}`, name: n, description: ctx.labels.get(n)?.description ?? "", color: "ededed" }));
const stateOf = (it) => ({ open: "OPEN", closed: "CLOSED", merged: "MERGED" })[it.state ?? "open"];
const itemUrl = (ctx, kind, it) => `https://github.com/${ctx.nameWithOwner}/${kind === "pr" ? "pull" : "issues"}/${it.number}`;
const lastTouch = (ctx, kind, it) => commentsOf(ctx, kind, it).reduce((m, c) => (c.createdAt > m ? c.createdAt : m), createdAt(it));

// Fields that every world has an honest empty answer for.
const EMPTY = { assignees: [], projectCards: [], projectItems: [], reactionGroups: [], milestone: null };

/** The branch a PR is on. A scenario can name one with `branch`. Otherwise it is `feat/<closed issue>-<slug>`. */
export const branchOf = (pr) => pr.branch ?? `feat/${pr.closes?.[0] ?? pr.number}-pr-${pr.number}`;

const CHECK_STATE = { pass: "SUCCESS", fail: "FAILURE", pending: "IN_PROGRESS", cancel: "CANCELLED", skipping: "SKIPPED" };

/** A PR's checks as `gh pr checks --json` shows them. */
export function checksOf(ctx, pr) {
  return (pr.checks ?? []).map((bucket, i) => ({
    name: `check-${i + 1}`, state: CHECK_STATE[bucket], bucket, workflow: "ci", event: "pull_request", description: "",
    startedAt: createdAt(pr), completedAt: bucket === "pending" ? "0001-01-01T00:00:00Z" : createdAt(pr),
    link: `https://github.com/${ctx.nameWithOwner}/actions/runs/${runId(pr, i)}/job/${runId(pr, i) + 1}`,
  }));
}
export const runId = (pr, i) => 1_000_000 + pr.number * 100 + i;

const build = {
  issue: (ctx, it) => ({
    ...EMPTY,
    id: `I_${it.number}`, number: it.number, title: it.title ?? `Issue ${it.number}`, body: it.body ?? "", url: itemUrl(ctx, "issue", it),
    state: stateOf(it), closed: it.state === "closed", stateReason: it.state === "closed" ? (it.closeReason === "not planned" ? "NOT_PLANNED" : "COMPLETED") : "",
    createdAt: createdAt(it), updatedAt: lastTouch(ctx, "issue", it), closedAt: it.state === "closed" ? (it.closedAt ?? lastTouch(ctx, "issue", it)) : null,
    author: person(it.author ?? "reporter"), labels: labelsOf(ctx, it),
    comments: commentsOf(ctx, "issue", it).map((c) => comment(c)),
  }),
  pr: (ctx, it) => {
    const checks = checksOf(ctx, it);
    const merge = it.mergeState ?? (it.draft ? "DRAFT" : "CLEAN");
    return {
      ...EMPTY,
      id: `PR_${it.number}`, number: it.number, title: it.title ?? `Pull request ${it.number}`, body: it.body ?? "", url: itemUrl(ctx, "pr", it),
      state: stateOf(it), closed: it.state !== "open", isDraft: Boolean(it.draft), mergedAt: it.state === "merged" ? (it.mergedAt ?? lastTouch(ctx, "pr", it)) : null,
      createdAt: createdAt(it), updatedAt: lastTouch(ctx, "pr", it), closedAt: it.state === "open" ? null : (it.closedAt ?? lastTouch(ctx, "pr", it)),
      author: person(it.author ?? ctx.user), labels: labelsOf(ctx, it),
      comments: commentsOf(ctx, "pr", it).map((c) => comment(c)),
      headRefName: branchOf(it), headRefOid: String(it.head ?? ""), baseRefName: it.base ?? ctx.defaultBranch,
      isCrossRepository: Boolean(it.fork), mergeStateStatus: merge,
      mergeable: merge === "DIRTY" ? "CONFLICTING" : merge === "UNKNOWN" ? "UNKNOWN" : "MERGEABLE",
      files: (it.files ?? []).map((path) => ({ path, additions: 0, deletions: 0 })), changedFiles: (it.files ?? []).length, additions: 0, deletions: 0,
      closingIssuesReferences: (it.closes ?? []).map((n) => ({ number: n, url: `https://github.com/${ctx.nameWithOwner}/issues/${n}`, repository: { name: ctx.name, owner: { login: ctx.owner } } })),
      reviewRequests: [], reviewDecision: "",
      statusCheckRollup: checks.map((c) => ({ __typename: "CheckRun", name: c.name, workflowName: c.workflow, status: c.bucket === "pending" ? "IN_PROGRESS" : "COMPLETED", conclusion: c.bucket === "pending" ? "" : c.state, detailsUrl: c.link, startedAt: c.startedAt, completedAt: c.completedAt })),
    };
  },
};
const comment = (c) => ({ id: `IC_${c.id}`, author: { login: c.login }, authorAssociation: c.association, body: c.body, createdAt: c.createdAt, url: c.url, includesCreatedEdit: false, isMinimized: false, minimizedReason: "", reactionGroups: [], viewerDidAuthor: false });

/** The fields of a kind that the simulator can fill. A field `gh` has and this lacks is `unsupported`. */
export const MODELLED = {
  issue: Object.keys(build.issue({ nameWithOwner: "o/r", user: "u", now: 0, labels: new Map(), world: {} }, { number: 1 })),
  pr: Object.keys(build.pr({ nameWithOwner: "o/r", user: "u", now: 0, labels: new Map(), world: {}, defaultBranch: "main", owner: "o", name: "r" }, { number: 1 })),
};

/** An issue or a PR as `gh` shows it, with every modelled field. */
export const view = (ctx, kind, it) => build[kind](ctx, it);

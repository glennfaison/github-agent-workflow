#!/usr/bin/env node
/**
 * The one implementation of the workflow's date math, run ids, comment shapes and marker
 * parsing. Three kinds of caller use it:
 *
 *   - lib.sh runs the CLI below (`node helpers.mjs <command> ...`) for dates, run ids and the
 *     lease and failure comments, so the shell and this file cannot disagree about them.
 *   - A runner with no shell does not execute this file. It reads it as the reference for the same
 *     operations and does them with GitHub tools (search_issues, issue_read, add_issue_comment).
 *   - tests/ runs the parsing functions and lib.sh against the same fixtures.
 *
 * CLI:
 *   run-id [RUNNER]                       20261015T134700Z-grok
 *   utc-plus DURATION                     now plus a duration, as UTC ISO-8601 (Z)
 *   utc-epoch TIMESTAMP                   Unix seconds
 *   lease-body STEP RUN EXPIRES [renew]   the lease comment
 *   failure-body STEP RUN REASON          the failure comment
 */
import { fileURLToPath } from 'node:url';

/** @typedef {'Exploring'|'Triaging'|'Implementing'|'Shepherding'|'Reviewing'} Step */
export const STEPS = ['Exploring', 'Triaging', 'Implementing', 'Shepherding', 'Reviewing'];

/** Step names that older runs wrote into markers. A failure under the old name still counts. */
export const LEGACY_STEP_NAMES = { Triaging: 'Grooming' };

/** Comment authors whose markers count, whatever else is true. */
export const TRUSTED_ASSOCIATIONS = ['OWNER', 'MEMBER', 'COLLABORATOR'];

// ---- run ids and dates --------------------------------------------------------------------

/**
 * Deterministic RUN_ID: UTC YYYYMMDDTHHMMSSZ, "-", then the runner name made safe.
 * Example: 20261015T134700Z-grok
 * @param {string} [runner='unknown']
 * @param {Date} [now=new Date()]
 */
export function makeRunId(runner = 'unknown', now = new Date()) {
  const stamp = now.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '');
  const safe = String(runner).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
  return `${stamp}-${safe}`;
}

const LONG_UNITS = /^(\d+)\s*(second|minute|hour|day|week|month|year)s?$/i;
const SHORT_UNITS = /^(\d+)\s*([smhdw])$/i;
const SHORT_NAMES = { s: 'second', m: 'minute', h: 'hour', d: 'day', w: 'week' };
const ISO = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i;

/**
 * Parse a duration into [{ n, unit }]. Accepted, each optionally signed with + or -:
 *   "1 hour", "3 hours", "14 days"    long form
 *   "1h", "30m", "2d", "1w", "45s"    short form (m is minutes)
 *   "PT1H", "P1D", "PT30M", "P2W"     ISO 8601
 * @param {string} raw
 * @returns {{ sign: 1|-1, parts: { n: number, unit: string }[] }}
 */
export function parseDuration(raw) {
  let expr = String(raw).trim();
  let sign = 1;
  if (expr.startsWith('+')) expr = expr.slice(1).trim();
  else if (expr.startsWith('-')) { sign = -1; expr = expr.slice(1).trim(); }

  let m = expr.match(LONG_UNITS);
  if (m) return { sign, parts: [{ n: parseInt(m[1], 10), unit: m[2].toLowerCase() }] };
  m = expr.match(SHORT_UNITS);
  if (m) return { sign, parts: [{ n: parseInt(m[1], 10), unit: SHORT_NAMES[m[2].toLowerCase()] }] };
  m = expr.match(ISO);
  if (m && m.slice(1).some(Boolean)) {
    const names = ['year', 'month', 'week', 'day', 'hour', 'minute', 'second'];
    const parts = names.map((unit, i) => ({ n: m[i + 1] ? parseInt(m[i + 1], 10) : 0, unit })).filter((p) => p.n);
    return { sign, parts };
  }
  throw new Error(`unsupported duration: ${raw}`);
}

/**
 * Add a signed duration to `now` and return UTC ISO-8601 ending in Z.
 * @param {string} duration
 * @param {Date} [now=new Date()]
 */
export function utcPlus(duration, now = new Date()) {
  const { sign, parts } = parseDuration(duration);
  const out = new Date(now.getTime());
  for (const { n, unit } of parts) {
    const v = n * sign;
    switch (unit) {
      case 'second': out.setUTCSeconds(out.getUTCSeconds() + v); break;
      case 'minute': out.setUTCMinutes(out.getUTCMinutes() + v); break;
      case 'hour': out.setUTCHours(out.getUTCHours() + v); break;
      case 'day': out.setUTCDate(out.getUTCDate() + v); break;
      case 'week': out.setUTCDate(out.getUTCDate() + v * 7); break;
      case 'month': out.setUTCMonth(out.getUTCMonth() + v); break;
      case 'year': out.setUTCFullYear(out.getUTCFullYear() + v); break;
    }
  }
  return out.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Unix epoch seconds for an ISO / RFC 3339 timestamp. A timestamp with no zone is read as UTC. */
export function utcEpoch(iso) {
  const s = String(iso).trim();
  const d = new Date(/Z$|[+-]\d{2}:\d{2}$/.test(s) ? s : `${s}Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`bad timestamp: ${iso}`);
  return Math.floor(d.getTime() / 1000);
}

// ---- comment shapes -----------------------------------------------------------------------

/** The lease comment. `kind` is "claim" or "renew". */
export function leaseComment(step, runId, expiresIso, kind = 'claim') {
  const marker = `<!-- agent:lease step=${step} run=${runId} expires=${expiresIso} -->`;
  const verb = kind === 'renew' ? 'Lease renewed by' : 'Claimed by';
  return { body: `${verb} ${step} run ${runId} until ${expiresIso}.\n${marker}`, marker };
}

/** The failure comment. A run that fails on a claimed item posts one before it releases. */
export function failureComment(step, runId, reason) {
  const marker = `<!-- agent:failure step=${step} run=${runId} -->`;
  return { body: `${step} run ${runId} failed: ${reason}\n${marker}`, marker };
}

/** Header and prose skeleton of a run-log comment (see references/log.md). */
export function formatLogComment({
  step, runId, runner, outcome, problemsCount = 0, items = '', problems = '', deferred = '', automation = '',
}) {
  const yaml = [
    '```yaml',
    `step: ${step}`,
    `run: ${runId}`,
    `runner: ${runner}`,
    `outcome: ${JSON.stringify(outcome)}`,
    `problems_count: ${problemsCount}`,
    '```',
  ].join('\n');
  const lines = [yaml, `**Step:** ${step}  **Run:** ${runId}  **Runner:** ${runner}`, `**Outcome:** ${outcome}`];
  if (items) lines.push(`**Items:** ${items}`);
  if (problems) lines.push(`**Problems:** ${problems}`);
  if (automation) lines.push(`**Automation suggestions:** ${automation}`);
  if (deferred) lines.push('**Deferred candidates:**', deferred);
  return lines.join('\n');
}

/** Title for a new agent:log issue. */
export function logIssueTitle(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `Agent log ${now.getUTCFullYear()}-${p(now.getUTCMonth() + 1)}-${p(now.getUTCDate())}`;
}

/** Title for a step's difficulty issue. */
export function difficultyIssueTitle(step) {
  return `Agent difficulties: ${step}`;
}

// ---- trust --------------------------------------------------------------------------------

/**
 * Whether a comment, issue or PR body may be believed when it carries a marker.
 * Trusted: the repository's OWNER, MEMBER or COLLABORATOR accounts, the account the agent runs
 * as, and any login listed in `trustedAuthors`. Anyone else can post a comment on a public issue,
 * so a marker from them is ignored, never counted.
 *
 * Accepts the REST shape ({ author_association, user: { login } }) and the `gh --json` shape
 * ({ authorAssociation, author: { login } }).
 *
 * @param {object} c
 * @param {{ selfLogin?: string, trustedAuthors?: string[] }} [trust]
 */
export function isTrusted(c, { selfLogin = '', trustedAuthors = [] } = {}) {
  const assoc = c?.author_association ?? c?.authorAssociation ?? '';
  const login = c?.user?.login ?? c?.author?.login ?? '';
  if (TRUSTED_ASSOCIATIONS.includes(assoc)) return true;
  return login !== '' && [selfLogin, ...trustedAuthors].filter(Boolean).includes(login);
}

// ---- reading markers ----------------------------------------------------------------------

/** Every agent marker from trusted comments, in order, as the exact `<!-- agent:... -->` text. */
export function markersOf(comments, trust) {
  const out = [];
  for (const c of comments) {
    if (!isTrusted(c, trust)) continue;
    out.push(...(String(c.body ?? '').match(/<!-- agent:[^>]*-->/g) ?? []));
  }
  return out;
}

/** The newest trusted lease on an item: its expiry and whether it is still live. Null if none. */
export function leaseState(comments, trust, now = new Date()) {
  let last = null;
  for (const c of comments) {
    if (!isTrusted(c, trust)) continue;
    const m = String(c.body ?? '').match(/<!-- agent:lease [^>]*expires=([0-9TZ:-]+)/);
    if (m) last = m[1];
  }
  if (!last) return null;
  return { expires: last, live: Math.floor(now.getTime() / 1000) < utcEpoch(last) };
}

export const reviewRounds = (markers) => markers.filter((m) => m.includes('agent:handoff kind=review')).length;

/** Fix attempts since the last handoff of any kind. */
export function shepherdAttempts(markers) {
  let c = 0;
  for (const m of markers) {
    if (m.includes('agent:handoff')) c = 0;
    if (m.includes('agent:attempt step=shepherding')) c += 1;
  }
  return c;
}

/** Failed runs of `step` since the last escalation. Failures under a step's old name count too. */
export function failures(markers, step) {
  const names = [step, LEGACY_STEP_NAMES[step]].filter(Boolean);
  let c = 0;
  for (const m of markers) {
    if (m.includes('agent:escalate')) c = 0;
    if (names.some((n) => m.includes(`agent:failure step=${n} `))) c += 1;
  }
  return c;
}

/** Review findings still open on a PR. */
export function openFindings(markers) {
  let open = 0;
  for (const m of markers) {
    if (m.includes('agent:handoff kind=review')) open = Number(m.match(/open=(\d+)/)?.[1] ?? 1);
    if (m.includes('agent:handoff kind=ready')) open = 0;
    if (m.includes('agent:attempt step=shepherding')) open = 0;
  }
  return open;
}

/** The head SHA the newest `kind=ready` handoff recorded, or ''. */
export function readySha(markers) {
  const ready = markers.filter((m) => m.includes('agent:handoff kind=ready'));
  return ready.length ? (ready[ready.length - 1].match(/sha=([0-9a-f]*)/g)?.pop()?.slice(4) ?? '') : '';
}

/**
 * No-shell checklist: what each lib.sh helper does, in terms of GitHub tools. Every comment you read
 * goes through isTrusted first.
 */
export const NO_SHELL_OPS = {
  makeRunId: 'RUN_ID = makeRunId(runner).',
  log_issue: 'search_issues label:agent:log state:open; if none within 14 days, issue_write with logIssueTitle and label agent:log.',
  log_run: 'add_issue_comment on the log issue with formatLogComment. If Problems is not empty, also comment on difficulty_issue(step).',
  difficulty_issue: 'search_issues label:agent:difficulty with the exact title difficultyIssueTitle(step); create it if missing.',
  read_logs: 'List recent agent:log issues, read comments newer than the lookback, skip idle "nothing eligible" entries with no Problems.',
  claim: 'Add the lease label, then add_issue_comment with leaseComment(..., "claim").',
  renew: 'add_issue_comment with leaseComment(..., "renew").',
  release: 'Remove the lease label.',
  lease_live: 'leaseState on the issue comments; skip the item if live.',
  fail_item: 'add_issue_comment with failureComment.',
  markers: 'markersOf on the comments.',
};

// ---- CLI ----------------------------------------------------------------------------------

function cli(argv) {
  const [cmd, ...a] = argv;
  switch (cmd) {
    case 'run-id': return makeRunId(a[0] || 'unknown');
    case 'utc-plus': return utcPlus(a[0] ?? '');
    case 'utc-epoch': return String(utcEpoch(a[0] ?? ''));
    case 'lease-body': return leaseComment(a[0], a[1], a[2], a[3] === 'renew' ? 'renew' : 'claim').body;
    case 'failure-body': return failureComment(a[0], a[1], a[2] ?? '').body;
    default: throw new Error(`usage: helpers.mjs run-id|utc-plus|utc-epoch|lease-body|failure-body ...`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.stdout.write(`${cli(process.argv.slice(2))}\n`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

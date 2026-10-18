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
 *   utc-plus DURATION [FROM]              FROM (default: now) plus a duration, as UTC ISO-8601 (Z)
 *   utc-epoch TIMESTAMP                   Unix seconds
 *   lease-body STEP RUN EXPIRES [renew]   the lease comment
 *   failure-body STEP RUN REASON          the failure comment
 *   log-window DAYS                       DAYS as a whole number of days, or 14 if it is not one
 *   log-title                             title for a new run-log issue
 *   log-body STARTED ROTATES [AT STEP RUN]  body of a run-log issue
 *   log-current DAYS   (JSON on stdin)    number of the log issue to append to, or nothing
 *   log-stamp          (entry on stdin)   the entry with an `at:` time, and real line breaks
 *   log-has-entry FILE (JSON lines on stdin)  yes|no: is this run's entry already posted
 *   log-touch FILE DAYS (issue JSON on stdin) the log issue body with "Last entry" brought up to date
 *   log-meta           (issue JSON on stdin)  started, rotates_after and last_entry, one per line
 *   log-read CUTOFF    (issue JSON on stdin)  the entries newer than CUTOFF, idle ones left out
 */
import { readFileSync } from 'node:fs';
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
  const out = new Date(now.getTime());
  const { sign, parts } = parseDuration(duration);
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

/**
 * Header and prose skeleton of a run-log comment (see references/log.md).
 * `at` is when the run wrote the entry. Every non-idle entry carries **Problems** (the run's
 * difficulties) and **Things to improve**, each `none` when empty, so difficulties live in the
 * log and never in a separate issue. An idle entry ("nothing eligible", nothing else to say)
 * stays one line.
 */
export function formatLogComment({
  step, runId, runner, outcome, problemsCount = 0, items = '', problems = '', improve = '',
  automation = '', deferred = '', at = new Date(),
}) {
  const stamp = toIso(at);
  const yaml = [
    '```yaml',
    `step: ${step}`,
    `run: ${runId}`,
    `runner: ${runner}`,
    `at: ${stamp}`,
    `outcome: ${JSON.stringify(outcome)}`,
    `problems_count: ${problemsCount}`,
    '```',
  ].join('\n');
  const better = [improve, automation].filter(Boolean).join('\n');
  const idle = /^nothing eligible\b/i.test(String(outcome).trim()) && !items && !problems && !better && !deferred;
  const lines = [yaml, `**Step:** ${step}  **Run:** ${runId}  **Runner:** ${runner}`, `**Outcome:** ${outcome}`];
  if (items) lines.push(`**Items:** ${items}`);
  if (!idle) {
    lines.push(`**Problems:** ${problems || 'none'}`);
    lines.push(`**Things to improve:** ${better || 'none'}`);
  }
  if (deferred) lines.push('**Deferred candidates:**', deferred);
  return lines.join('\n');
}

/** Title for a new agent:log issue: the day its window starts. */
export function logIssueTitle(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `Agent log ${now.getUTCFullYear()}-${p(now.getUTCMonth() + 1)}-${p(now.getUTCDate())}`;
}

// ---- the run-log issue ----------------------------------------------------------------------
// One issue is appended to until its window ends, then the next run starts a new one. The issue
// body says when the window started and ends and when the last entry was written, so a reader
// can tell how fresh the log is without opening a comment.

export const DEFAULT_LOG_WINDOW_DAYS = 14;

/** A window length in whole days. Anything that is not a positive whole number is the default. */
export function logWindowDays(raw) {
  const s = String(raw ?? '').trim();
  const n = /^\d+$/.test(s) ? Number.parseInt(s, 10) : NaN;
  return Number.isInteger(n) && n >= 1 ? n : DEFAULT_LOG_WINDOW_DAYS;
}

/** Any Date or ISO string as UTC ISO-8601 ending in Z, without milliseconds. */
export function toIso(when = new Date()) {
  const d = when instanceof Date ? when : new Date(when);
  if (Number.isNaN(d.getTime())) throw new Error(`bad timestamp: ${when}`);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Body of a run-log issue. `lastEntry` is `{ at, step, runId }` once an entry has been written.
 * @param {{ startedIso: string, rotatesIso: string, lastEntry?: { at: string, step: string, runId: string } | null }} p
 */
export function logIssueBody({ startedIso, rotatesIso, lastEntry = null }) {
  const last = lastEntry ? `${lastEntry.at} (${lastEntry.step}, run ${lastEntry.runId})` : 'none yet';
  return [
    'Append-only run log: one comment per run, newest last. Excluded from every workflow step.',
    '',
    `- **Started:** ${startedIso}`,
    `- **Rotates after:** ${rotatesIso}`,
    `- **Last entry:** ${last}`,
    '',
    'Each entry says what the run did (**Outcome**, **Items**), what made it hard (**Problems**) and what should change (**Things to improve**). Difficulties are logged here, never in a separate issue.',
  ].join('\n');
}

/** Read the three fields back out of a log issue body. Each is an ISO time or null. */
export function parseLogIssueBody(body) {
  const field = (name) => {
    const v = String(body ?? '').match(new RegExp(`\\*\\*${name}:\\*\\*\\s*(\\d{4}-\\d{2}-\\d{2}T[0-9:.]+Z)`))?.[1];
    return v && !Number.isNaN(Date.parse(v)) ? v : null;
  };
  return { started: field('Started'), rotatesAfter: field('Rotates after'), lastEntry: field('Last entry') };
}

/**
 * Which open agent:log issue the next entry belongs to: the lowest-numbered one whose window is
 * still open, or null when a new one is due. A window ends at the issue's own "Rotates after"
 * time; an older issue without one ends `windowDays` after it was created. If two runs raced and
 * made two, the lowest number wins, so every later run agrees.
 * @param {{ number: number, createdAt: string, body?: string }[]} issues
 */
export function currentLogIssue(issues, windowDays = DEFAULT_LOG_WINDOW_DAYS, now = new Date()) {
  const days = logWindowDays(windowDays);
  const open = [];
  for (const i of issues ?? []) {
    const ends = parseLogIssueBody(i.body).rotatesAfter ?? utcPlus(`${days} days`, new Date(i.createdAt));
    if (Date.parse(ends) > now.getTime()) open.push(i.number);
  }
  return open.length ? Math.min(...open) : null;
}

/** `{ step, run }` of a log entry, read from its YAML header, else from the prose line. */
export function logEntryKey(body) {
  const t = String(body ?? '');
  const pick = (yamlKey, prose) => (t.match(new RegExp(`^${yamlKey}:\\s*(\\S+)`, 'm'))?.[1]
    ?? t.match(new RegExp(`\\*\\*${prose}:\\*\\*\\s*(\\S+)`))?.[1] ?? '');
  return { step: pick('step', 'Step'), run: pick('run', 'Run') };
}

/** The time an entry says it was written, or null. */
export function logEntryAt(body) {
  const t = String(body ?? '');
  return t.match(/^at:\s*(\S+)/m)?.[1] ?? t.match(/\*\*At:\*\*\s*(\S+)/)?.[1] ?? null;
}

/** Whether a run has already written its entry for a step: one entry per run and step. */
export function hasLogEntry(commentBodies, entryBody) {
  const key = logEntryKey(entryBody);
  if (!key.step || !key.run) return false;
  return commentBodies.some((b) => {
    const k = logEntryKey(b);
    return k.step === key.step && k.run === key.run;
  });
}

/**
 * Make an entry safe to post: real line breaks where a runner wrote the two characters `\n`
 * (every line of the entry ran together that way once), and an `at:` time if it has none.
 */
export function stampLogEntry(body, now = new Date()) {
  let text = String(body ?? '');
  if (!text.includes('\n') && text.includes('\\n')) text = text.replace(/\\n/g, '\n');
  text = text.replace(/^\s+/, '');
  if (logEntryAt(text)) return text;
  const at = toIso(now);
  const fence = text.match(/^```ya?ml\n([\s\S]*?)\n```/);
  if (!fence) return `**At:** ${at}\n${text}`;
  const yaml = fence[1].split('\n');
  const after = yaml.findIndex((l) => /^runner:/.test(l));
  yaml.splice(after === -1 ? yaml.length : after + 1, 0, `at: ${at}`);
  return text.replace(fence[0], `\`\`\`yaml\n${yaml.join('\n')}\n\`\`\``);
}

/**
 * The log issue's body after an entry was added: "Last entry" now names that entry. An issue
 * written before the body carried dates is filled in from its creation time.
 * @param {{ body?: string, createdAt: string }} issue
 */
export function touchLogIssueBody(issue, entryBody, windowDays = DEFAULT_LOG_WINDOW_DAYS) {
  const meta = parseLogIssueBody(issue.body);
  const startedIso = meta.started ?? toIso(issue.createdAt);
  const rotatesIso = meta.rotatesAfter ?? utcPlus(`${logWindowDays(windowDays)} days`, new Date(startedIso));
  const key = logEntryKey(entryBody);
  const at = logEntryAt(entryBody) ?? toIso(new Date());
  return logIssueBody({ startedIso, rotatesIso, lastEntry: { at, step: key.step || 'unknown', runId: key.run || 'unknown' } });
}

/**
 * An entry that only says "nothing eligible": no items, no problems, nothing to improve.
 * `Problems: none` and `Things to improve: none` count as empty.
 */
export function isIdleEntry(body) {
  const t = String(body ?? '');
  const outcome = t.match(/\*\*Outcome:\*\*\s*([^\n]*)/)?.[1] ?? t.match(/^outcome:\s*"?([^"\n]*)/m)?.[1] ?? '';
  if (!/^nothing eligible\b/i.test(outcome.trim())) return false;
  const filled = (label) => {
    const m = t.match(new RegExp(`\\*\\*${label}:\\*\\*([\\s\\S]*?)(?=\\n\\*\\*[A-Z]|$)`));
    return !!m && !/^(none\.?)?$/i.test(m[1].trim());
  };
  const count = Number(t.match(/^problems_count:\s*(\d+)/m)?.[1] ?? 0);
  return count === 0 && !filled('Problems') && !filled('Things to improve') && !filled('Automation suggestions');
}

/** The comments newer than `cutoffIso`, oldest first, with idle entries left out. */
export function readableLogEntries(comments, cutoffIso) {
  return (comments ?? [])
    .filter((c) => String(c.createdAt ?? '') > cutoffIso && !isIdleEntry(c.body))
    .map((c) => c.body);
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
  log_issue: 'list_issues (not search_issues: search is a slow, approximate index and will not show an issue made a minute ago) with labels ["agent:log"], state OPEN, orderBy CREATED_AT, direction ASC. currentLogIssue picks the one to append to. None: issue_write create with logIssueTitle, label agent:log and logIssueBody. Then list again: if a lower-numbered one now exists, close yours as not_planned (duplicate_of it) and use that.',
  log_run: 'issue_read get_comments on the log issue and stop if hasLogEntry says this run and step are already there. Otherwise add_issue_comment with stampLogEntry(formatLogComment(...)), then issue_write update on the log issue with touchLogIssueBody as the new body. Real line breaks, never the two characters backslash-n. There is no separate difficulty issue.',
  read_logs: 'list_issues for agent:log (state all, newest first), read each one\'s comments newer than the lookback, skip readableLogEntries-idle ones (nothing eligible, Problems none).',
  claim: 'Add the lease label, then add_issue_comment with leaseComment(..., "claim").',
  renew: 'add_issue_comment with leaseComment(..., "renew").',
  release: 'Remove the lease label.',
  clear_stale_lease: 'If leaseState is not live, remove agent:triage and agent:in-progress labels (call during eligibility/selection).',
  lease_live: 'leaseState on the issue comments; skip the item if live.',
  fail_item: 'add_issue_comment with failureComment.',
  markers: 'markersOf on the comments.',
};

// ---- CLI ----------------------------------------------------------------------------------

const stdin = () => readFileSync(0, 'utf8');

function cli(argv) {
  const [cmd, ...a] = argv;
  switch (cmd) {
    case 'run-id': return makeRunId(a[0] || 'unknown');
    case 'utc-plus': return utcPlus(a[0] ?? '', a[1] ? new Date(a[1]) : undefined);
    case 'utc-epoch': return String(utcEpoch(a[0] ?? ''));
    case 'lease-body': return leaseComment(a[0], a[1], a[2], a[3] === 'renew' ? 'renew' : 'claim').body;
    case 'failure-body': return failureComment(a[0], a[1], a[2] ?? '').body;
    case 'log-window': return String(logWindowDays(a[0]));
    case 'log-title': return logIssueTitle();
    case 'log-body': return logIssueBody({
      startedIso: a[0], rotatesIso: a[1], lastEntry: a[2] ? { at: a[2], step: a[3] ?? 'unknown', runId: a[4] ?? 'unknown' } : null,
    });
    case 'log-current': return String(currentLogIssue(JSON.parse(stdin() || '[]'), a[0]) ?? '');
    case 'log-stamp': return stampLogEntry(stdin());
    case 'log-has-entry': {
      const bodies = stdin().split('\n').filter(Boolean).map((l) => JSON.parse(l));
      return hasLogEntry(bodies, readFileSync(a[0], 'utf8')) ? 'yes' : 'no';
    }
    case 'log-touch': return touchLogIssueBody(JSON.parse(stdin() || '{}'), readFileSync(a[0], 'utf8'), a[1]);
    case 'log-meta': {
      const issue = JSON.parse(stdin() || '{}');
      const meta = parseLogIssueBody(issue.body);
      return [
        `started=${meta.started ?? ''}`,
        `rotates_after=${meta.rotatesAfter ?? ''}`,
        `last_entry=${meta.lastEntry ?? ''}`,
      ].join('\n');
    }
    case 'log-read': return readableLogEntries(JSON.parse(stdin() || '{}').comments, a[0]).join('\n---\n');
    default:
      throw new Error(`unknown command: ${cmd}`);
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

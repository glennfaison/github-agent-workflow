/**
 * Pure-JS helpers for the GitHub agent workflow when no shell / no gh / no local clone.
 *
 * Use these as reference implementations and copy-paste formulas. A no-shell runner
 * does not execute this file; it mirrors the same operations with GitHub MCP /
 * connector tools (search_issues, issue_read, issue_write, add_issue_comment, etc.).
 *
 * Shell runners continue to source lib.sh, which already uses Node only for date math.
 *
 * Deterministic RUN_ID and log header formats are defined here so every runner produces
 * the same shape.
 */

/** @typedef {'Exploring'|'Grooming'|'Implementing'|'Shepherding'|'Reviewing'} Step */

/**
 * Build a deterministic RUN_ID.
 * Format: UTC YYYYMMDDTHHMMSSZ + "-" + runner name (sanitized).
 * Example: 20261015T134700Z-grok
 *
 * @param {string} [runner='unknown']
 * @param {Date} [now=new Date()]
 * @returns {string}
 */
export function makeRunId(runner = 'unknown', now = new Date()) {
  const iso = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const stamp = iso.replace(/[-:]/g, '');
  const safe = String(runner).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
  return `${stamp}-${safe}`;
}

/**
 * Add a signed duration to "now" and return an ISO-8601 UTC string ending in Z.
 * Supported units: second(s), minute(s), hour(s), day(s), week(s), month(s), year(s).
 * Examples: "+1 hour", "-14 days", "3 hours"
 *
 * @param {string} duration
 * @param {Date} [now=new Date()]
 * @returns {string}
 */
export function utcPlus(duration, now = new Date()) {
  const raw = String(duration).trim();
  let sign = 1;
  let expr = raw;
  if (expr.startsWith('+')) expr = expr.slice(1).trim();
  else if (expr.startsWith('-')) {
    sign = -1;
    expr = expr.slice(1).trim();
  }
  const m = expr.match(/^(\d+)\s*(second|minute|hour|day|week|month|year)s?$/i);
  if (!m) throw new Error(`unsupported duration: ${raw}`);
  const value = parseInt(m[1], 10) * sign;
  const unit = m[2].toLowerCase();
  const out = new Date(now.getTime());
  switch (unit) {
    case 'second': out.setUTCSeconds(out.getUTCSeconds() + value); break;
    case 'minute': out.setUTCMinutes(out.getUTCMinutes() + value); break;
    case 'hour': out.setUTCHours(out.getUTCHours() + value); break;
    case 'day': out.setUTCDate(out.getUTCDate() + value); break;
    case 'week': out.setUTCDate(out.getUTCDate() + value * 7); break;
    case 'month': out.setUTCMonth(out.getUTCMonth() + value); break;
    case 'year': out.setUTCFullYear(out.getUTCFullYear() + value); break;
  }
  return out.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Parse an ISO / RFC3339 timestamp to Unix epoch seconds.
 * @param {string} iso
 * @returns {number}
 */
export function utcEpoch(iso) {
  const s = String(iso).trim();
  const d = new Date(/Z$|[+-]\d{2}:\d{2}$/.test(s) ? s : s + 'Z');
  if (Number.isNaN(d.getTime())) throw new Error(`bad timestamp: ${iso}`);
  return Math.floor(d.getTime() / 1000);
}

/**
 * Lease marker HTML comment body fragment.
 * @param {Step|string} step
 * @param {string} runId
 * @param {string} expiresIso
 * @param {'claim'|'renew'} [kind='claim']
 */
export function leaseComment(step, runId, expiresIso, kind = 'claim') {
  const marker = `<!-- agent:lease step=${step} run=${runId} expires=${expiresIso} -->`;
  const verb = kind === 'renew' ? 'Lease renewed by' : 'Claimed by';
  return {
    body: `${verb} ${step} run ${runId} until ${expiresIso}.\n${marker}`,
    marker,
  };
}

/**
 * Failure marker comment.
 * @param {Step|string} step
 * @param {string} runId
 * @param {string} reason
 */
export function failureComment(step, runId, reason) {
  return {
    body: `${step} run ${runId} failed: ${reason}\n<!-- agent:failure step=${step} run=${runId} -->`,
    marker: `<!-- agent:failure step=${step} run=${runId} -->`,
  };
}

/**
 * Parse the most recent lease expiry from comment bodies.
 * @param {string[]} commentBodies
 * @param {Date} [now=new Date()]
 */
export function parseLease(commentBodies, now = new Date()) {
  let last = null;
  for (const body of commentBodies) {
    const m = String(body).match(/<!--\s*agent:lease\s+[^>]*expires=([0-9TZ:-]+)/);
    if (m) last = m[1];
  }
  if (!last) return null;
  const live = utcEpoch(last) > Math.floor(now.getTime() / 1000);
  return { expires: last, live };
}

/**
 * Count agent:failure markers for a step on an item.
 * @param {string[]} commentBodies
 * @param {Step|string} [step]
 */
export function countFailures(commentBodies, step) {
  let n = 0;
  for (const body of commentBodies) {
    const m = String(body).match(/<!--\s*agent:failure\s+step=([^\s>]+)/);
    if (!m) continue;
    if (step && m[1] !== step) continue;
    n += 1;
  }
  return n;
}

/**
 * Build the required YAML header + prose skeleton for a run-log comment.
 * @param {object} opts
 */
export function formatLogComment({
  step,
  runId,
  runner,
  outcome,
  problemsCount = 0,
  items = '',
  problems = '',
  deferred = '',
  automation = '',
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

  const lines = [
    yaml,
    `**Step:** ${step}  **Run:** ${runId}  **Runner:** ${runner}`,
    `**Outcome:** ${outcome}`,
  ];
  if (items) lines.push(`**Items:** ${items}`);
  if (problems) lines.push(`**Problems:** ${problems}`);
  if (automation) lines.push(`**Automation suggestions:** ${automation}`);
  if (deferred) {
    lines.push('**Deferred candidates:**');
    lines.push(deferred);
  }
  return lines.join('\n');
}

/** Title for a new agent:log issue (covers ~2 weeks). */
export function logIssueTitle(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `Agent log ${y}-${m}-${d}`;
}

/** Title for a step difficulty issue. */
export function difficultyIssueTitle(step) {
  return `Agent difficulties: ${step}`;
}

/**
 * No-shell checklist: operations the agent must perform with GitHub tools
 * instead of sourcing lib.sh.
 */
export const NO_SHELL_OPS = {
  makeRunId: 'Set RUN_ID = UTC YYYYMMDDTHHMMSSZ + "-" + runner (see makeRunId).',
  log_issue: 'search_issues label:agent:log state:open; if none within 14 days, issue_write title from logIssueTitle, label agent:log.',
  log_run: 'add_issue_comment on the log issue with formatLogComment body. If Problems non-empty, also comment on difficulty_issue(step).',
  difficulty_issue: 'search_issues label:agent:difficulty title exact "Agent difficulties: <Step>"; create if missing.',
  read_logs: 'List recent agent:log issues, read comments newer than lookback, skip idle "nothing eligible" with no Problems. Prefer YAML header fields.',
  claim: 'Add lease label, add_issue_comment with leaseComment(..., "claim").',
  renew: 'add_issue_comment with leaseComment(..., "renew").',
  release: 'Remove the lease label.',
  lease_live: 'parseLease on issue comments; skip item if live.',
  fail_item: 'add_issue_comment with failureComment; countFailures toward max_item_failures.',
  markers: 'Scan comment bodies for <!-- agent:* --> markers.',
};

// CLI smoke test when run directly: node helpers.mjs
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isMain || process.argv[1]?.endsWith('helpers.mjs')) {
  const id = makeRunId('grok');
  const exp = utcPlus('+1 hour');
  const body = formatLogComment({
    step: 'Exploring',
    runId: id,
    runner: 'grok',
    outcome: '0 filed, 0 commented, 0 dropped',
    problemsCount: 1,
    problems: 'degraded: no shell helpers available; used pure-JS path',
  });
  console.log(id);
  console.log(exp);
  console.log(body);
}

// Tests for scripts/helpers.mjs. Run with: node --test tests/
// The marker fixtures are shared with tests/lib.test.sh, so the shell library and the JS reference
// have to agree on every case.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const helpersPath = join(here, '..', 'skills', 'meta', 'agent-workflow-protocol', 'scripts', 'helpers.mjs');
const h = await import(helpersPath);
const fixtures = JSON.parse(readFileSync(join(here, 'fixtures', 'markers.json'), 'utf8'));

const asComment = (c) => ({
  body: c.body,
  author_association: c.author_association ?? 'OWNER',
  user: { login: c.login ?? 'maintainer' },
});

for (const f of fixtures) {
  test(f.name, () => {
    const comments = f.comments.map(asComment);
    const trust = { selfLogin: 'agent-bot', trustedAuthors: f.trusted_authors ?? [] };
    const markers = h.markersOf(comments, trust);
    const e = f.expect;
    if ('lease_live' in e) assert.equal(h.leaseState(comments, trust)?.live ?? false, e.lease_live);
    if ('review_rounds' in e) assert.equal(h.reviewRounds(markers), e.review_rounds);
    if ('open_findings' in e) assert.equal(h.openFindings(markers), e.open_findings);
    if ('ready_sha' in e) assert.equal(h.readySha(markers), e.ready_sha);
    if ('shepherd_attempts' in e) assert.equal(h.shepherdAttempts(markers), e.shepherd_attempts);
    for (const [step, n] of Object.entries(e.failures ?? {})) assert.equal(h.failures(markers, step), n, step);
  });
}

test('isTrusted reads both the REST and the gh --json shapes', () => {
  assert.equal(h.isTrusted({ authorAssociation: 'COLLABORATOR', author: { login: 'x' } }), true);
  assert.equal(h.isTrusted({ author_association: 'CONTRIBUTOR', user: { login: 'x' } }), false);
  assert.equal(h.isTrusted({ author_association: 'NONE', user: { login: 'me' } }, { selfLogin: 'me' }), true);
  assert.equal(h.isTrusted({}, { selfLogin: '' }), false, 'an empty login never matches an empty self login');
});

test('durations: long, short and ISO forms agree', () => {
  const now = new Date('2026-10-15T12:00:00Z');
  for (const d of ['1 hour', '+1 hour', '1h', 'PT1H']) assert.equal(h.utcPlus(d, now), '2026-10-15T13:00:00Z', d);
  for (const d of ['30 minutes', '30m', 'PT30M']) assert.equal(h.utcPlus(d, now), '2026-10-15T12:30:00Z', d);
  for (const d of ['2 days', '2d', 'P2D']) assert.equal(h.utcPlus(d, now), '2026-10-17T12:00:00Z', d);
  assert.equal(h.utcPlus('-14 days', now), '2026-10-01T12:00:00Z');
  assert.equal(h.utcPlus('P1DT12H', now), '2026-10-17T00:00:00Z');
  assert.throws(() => h.utcPlus('soon', now), /unsupported duration/);
  assert.throws(() => h.utcPlus('P', now), /unsupported duration/);
});

test('run id: UTC stamp, a dash, the runner made safe', () => {
  const now = new Date('2026-10-15T13:47:00Z');
  assert.equal(h.makeRunId('grok', now), '20261015T134700Z-grok');
  assert.equal(h.makeRunId('my runner/1', now), '20261015T134700Z-my-runner-1');
  assert.equal(h.makeRunId('', now), '20261015T134700Z-unknown');
});

test('comment shapes end with their marker', () => {
  assert.equal(
    h.leaseComment('Triaging', 'r1', '2099-01-01T00:00:00Z').body,
    'Claimed by Triaging run r1 until 2099-01-01T00:00:00Z.\n<!-- agent:lease step=Triaging run=r1 expires=2099-01-01T00:00:00Z -->',
  );
  assert.match(h.leaseComment('Triaging', 'r1', '2099-01-01T00:00:00Z', 'renew').body, /^Lease renewed by/);
  assert.match(h.failureComment('Reviewing', 'r2', 'boom').body, /failed: boom\n<!-- agent:failure step=Reviewing run=r2 -->$/);
});

test('the CLI is what lib.sh calls', () => {
  const run = (...a) => execFileSync('node', [helpersPath, ...a], { encoding: 'utf8' }).trim();
  assert.match(run('run-id', 'grok'), /^\d{8}T\d{6}Z-grok$/);
  assert.match(run('utc-plus', '1 hour'), /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  assert.equal(run('utc-epoch', '2020-01-01T00:00:00Z'), '1577836800');
  assert.throws(() => run('utc-plus', 'soon'));
});

// ---- run log ----------------------------------------------------------------------------------
const day = (d) => new Date(`2026-10-${String(d).padStart(2, '0')}T12:00:00Z`);

test('logWindowDays: whole days, otherwise two weeks', () => {
  assert.deepEqual(['14', '3', ' 7 ', 5].map(h.logWindowDays), [14, 3, 7, 5]);
  assert.deepEqual(['0', '-2', '1.5', 'two weeks', '', undefined].map(h.logWindowDays), Array(6).fill(14));
});

test('log issue body round-trips its dates and names the last entry', () => {
  const body = h.logIssueBody({ startedIso: '2026-10-16T04:25:01Z', rotatesIso: '2026-10-30T04:25:01Z',
    lastEntry: { at: '2026-10-17T18:33:40Z', step: 'Triaging', runId: 'R1' } });
  assert.deepEqual(h.parseLogIssueBody(body), { started: '2026-10-16T04:25:01Z', rotatesAfter: '2026-10-30T04:25:01Z', lastEntry: '2026-10-17T18:33:40Z' });
  assert.match(body, /Last entry:\*\* 2026-10-17T18:33:40Z \(Triaging, run R1\)/);
  assert.equal(h.parseLogIssueBody(h.logIssueBody({ startedIso: 'a', rotatesIso: 'b' })).lastEntry, null);
});

test('currentLogIssue: the lowest open window, else null', () => {
  const legacy = (number, createdAt) => ({ number, createdAt, body: 'Append-only run log. Covers roughly two weeks.' });
  assert.equal(h.currentLogIssue([legacy(359, '2026-10-16T10:00:00Z'), legacy(357, '2026-10-16T04:00:00Z')], 14, day(18)), 357);
  assert.equal(h.currentLogIssue([legacy(300, '2026-09-01T00:00:00Z')], 14, day(18)), null);
  assert.equal(h.currentLogIssue([], 14, day(18)), null);
  assert.equal(h.currentLogIssue([legacy(357, '2026-10-16T04:00:00Z')], 14, day(31)), null, 'past two weeks');
  assert.equal(h.currentLogIssue([legacy(357, '2026-10-16T04:00:00Z')], 30, day(31)), 357, 'a longer window keeps it');
  const own = { number: 5, createdAt: '2026-10-01T00:00:00Z', body: h.logIssueBody({ startedIso: '2026-10-01T00:00:00Z', rotatesIso: '2026-11-01T00:00:00Z' }) };
  assert.equal(h.currentLogIssue([own], 14, day(18)), 5, 'the issue own Rotates after wins');
});

test('stampLogEntry adds at:, keeps an existing one, and repairs literal \\n', () => {
  const now = new Date('2026-10-17T18:00:00Z');
  const noAt = '```yaml\nstep: A\nrun: R\nrunner: k\noutcome: "x"\nproblems_count: 0\n```\n**Outcome:** x';
  assert.match(h.stampLogEntry(noAt, now), /runner: k\nat: 2026-10-17T18:00:00Z\noutcome/);
  const full = h.formatLogComment({ step: 'A', runId: 'R', runner: 'k', outcome: 'x', at: now });
  assert.equal(h.stampLogEntry(full, new Date()), full);
  const escaped = '\\n\\n**Step:** B  **Run:** R2  **Runner:** k\\n**Outcome:** y\\n';
  const fixed = h.stampLogEntry(escaped, now);
  assert.match(fixed, /^\*\*At:\*\* 2026-10-17T18:00:00Z\n\*\*Step:\*\* B/);
  assert.ok(!fixed.includes('\\n'));
});

test('hasLogEntry: one entry per run and step', () => {
  const e = (step, run) => h.formatLogComment({ step, runId: run, runner: 'k', outcome: 'x' });
  assert.equal(h.hasLogEntry([e('Triaging', 'R1')], e('Triaging', 'R1')), true);
  assert.equal(h.hasLogEntry([e('Triaging', 'R1')], e('Triaging', 'R2')), false);
  assert.equal(h.hasLogEntry([e('Triaging', 'R1')], e('Reviewing', 'R1')), false);
  assert.equal(h.hasLogEntry([e('Triaging', 'R1')], 'no header at all'), false);
});

test('formatLogComment: at:, and both Problems and Things to improve unless idle', () => {
  const at = new Date('2026-10-17T18:00:00Z');
  const work = h.formatLogComment({ step: 'Triaging', runId: 'R', runner: 'k', outcome: '1 triaged', at });
  assert.match(work, /^at: 2026-10-17T18:00:00Z$/m);
  assert.match(work, /\*\*Problems:\*\* none\n\*\*Things to improve:\*\* none/);
  const idle = h.formatLogComment({ step: 'Triaging', runId: 'R', runner: 'k', outcome: 'nothing eligible', at });
  assert.ok(!idle.includes('Problems') && !idle.includes('Things to improve'));
  assert.match(h.formatLogComment({ step: 'A', runId: 'R', runner: 'k', outcome: 'x', automation: 'script it', at }), /Things to improve:\*\* script it/);
});

test('isIdleEntry and readableLogEntries', () => {
  const idle = h.formatLogComment({ step: 'Triaging', runId: 'R', runner: 'k', outcome: 'nothing eligible' });
  assert.equal(h.isIdleEntry(idle), true);
  assert.equal(h.isIdleEntry('**Outcome:** nothing eligible\n**Problems:** none\n**Things to improve:** none'), true);
  assert.equal(h.isIdleEntry('**Outcome:** nothing eligible\n**Problems:** failed: #4 x'), false);
  assert.equal(h.isIdleEntry('**Outcome:** nothing eligible\n**Things to improve:** script it'), false);
  assert.equal(h.isIdleEntry('**Outcome:** 1 merged'), false);
  const got = h.readableLogEntries([
    { body: idle, createdAt: '2026-10-17T00:00:00Z' },
    { body: '**Outcome:** 1 merged', createdAt: '2026-10-17T00:00:00Z' },
    { body: '**Outcome:** 1 merged (old)', createdAt: '2026-01-01T00:00:00Z' },
  ], '2026-10-01T00:00:00Z');
  assert.deepEqual(got, ['**Outcome:** 1 merged']);
});

test('touchLogIssueBody fills in a legacy body and names the entry', () => {
  const entry = h.formatLogComment({ step: 'Triaging', runId: 'R9', runner: 'k', outcome: 'x', at: new Date('2026-10-17T18:00:00Z') });
  const body = h.touchLogIssueBody({ body: 'old', createdAt: '2026-10-16T04:25:01Z' }, entry, 14);
  assert.deepEqual(h.parseLogIssueBody(body), { started: '2026-10-16T04:25:01Z', rotatesAfter: '2026-10-30T04:25:01Z', lastEntry: '2026-10-17T18:00:00Z' });
  assert.match(body, /\(Triaging, run R9\)/);
});

test('isCompliantBranchName matches the prs_for_issue branch heuristic', () => {
  assert.equal(h.isCompliantBranchName('feature/24-refuse-noncompliant-branch-names', 24), true);
  assert.equal(h.isCompliantBranchName('bugfix/12-login-timeout', 12), true);
  assert.equal(h.isCompliantBranchName('debt/3-cleanup', 3), true);
  assert.equal(h.isCompliantBranchName('feature/24-x', 24), true);
  assert.equal(h.isCompliantBranchName('Feature/24-x', 24), false, 'type must be lowercase');
  assert.equal(h.isCompliantBranchName('feature/25-x', 24), false, 'wrong issue number');
  assert.equal(h.isCompliantBranchName('feature/24', 24), false, 'missing slug');
  assert.equal(h.isCompliantBranchName('feature/24-', 24), false, 'trailing hyphen only');
  assert.equal(h.isCompliantBranchName('24-feature-x', 24), false, 'no type prefix');
  assert.equal(h.isCompliantBranchName('feature/N-topic', 24), false);
  assert.equal(h.isCompliantBranchName('', 24), false);
  assert.equal(h.branchNamePattern(7).source, '^[a-z]+/7-[a-z0-9]+(?:-[a-z0-9]+)*$');
});

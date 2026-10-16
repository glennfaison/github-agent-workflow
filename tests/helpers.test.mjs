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

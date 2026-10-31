// Tests for scripts/lint-files.mjs. Run with: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'lint-files.mjs');
const dir = mkdtempSync(join(tmpdir(), 'lint-'));

function lint(name, content) {
  const file = join(dir, name);
  writeFileSync(file, content);
  const r = spawnSync('node', [script, file], { encoding: 'utf8' });
  return { ok: r.status === 0, out: r.stdout + r.stderr };
}

const cases = [
  ['valid json', 'a.json', '{"a": 1}\n', true],
  ['invalid json', 'b.json', '{bad', false],
  ['valid yaml', 'a.yml', 'a:\n  - b\n', true],
  ['invalid yaml', 'b.yml', 'a: [b\n', false],
  ['valid node syntax', 'a.mjs', 'export const a = 1;\n', true],
  ['invalid node syntax', 'b.mjs', 'export const = ;\n', false],
  ['valid shell syntax', 'a.sh', '#!/usr/bin/env bash\necho hi\n', true],
  ['invalid shell syntax', 'b.sh', 'if then\n', false],
  ['markdown without front matter', 'a.md', '# Title\n\nSome: text\n', true],
  ['valid front matter', 'b.md', '---\nname: x\ndescription: "Note: quoted"\n---\nBody\n', true],
  ['unquoted ": " in front matter', 'c.md', '---\nname: x\ndescription: Note: not quoted\n---\nBody\n', false],
  ['merge conflict marker', 'd.md', 'a\n<<<<<<< HEAD\nb\n', false],
  ['unknown file types are ignored', 'e.txt', 'anything goes\n', true],
];

for (const [name, file, content, ok] of cases) {
  test(name, () => {
    const r = lint(file, content);
    assert.equal(r.ok, ok, r.out);
  });
}

test('a path that no longer exists (a deleted file) is skipped', () => {
  const r = spawnSync('node', [script, join(dir, 'gone.json')], { encoding: 'utf8' });
  assert.equal(r.status, 0);
});

test.after(() => rmSync(dir, { recursive: true, force: true }));

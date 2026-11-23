import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFixtures } from '../examples/fixtures.mjs';

test('visuals use both real themes, multiple formats and an explicit synthetic failure', async () => {
  const fixtures = await buildFixtures();
  assert.ok(fixtures.some(f => f.themeName === 'jetbrains-dark-transparent'));
  assert.ok(fixtures.some(f => f.themeName === 'darcula-transparent'));
  for (const language of ['python', 'javascript', 'typescript', 'yaml', 'json', 'java', 'bash']) {
    assert.ok(fixtures.some(f => f.language === language), 'Missing language: ' + language);
  }
  for (const kind of ['markdown-known', 'markdown-unknown', 'markdown-streaming']) {
    assert.ok(fixtures.some(f => f.kind === kind), 'Missing card state: ' + kind);
  }
  assert.ok(fixtures.some(f => f.kind === 'failure' && f.ansi.includes('✗ Failed')));
  for (const fixture of fixtures) {
    for (const [color] of fixture.ansi.matchAll(/\x1b\[48;[0-9;]+m/g)) {
      assert.equal(color, '\x1b[48;2;37;38;42m', 'Only neutral gray code cards may have a fill');
    }
    assert.ok(!/\/Users\/|\/var\/folders\/|knyazevboba|adobe/i.test(fixture.ansi));
  }
  const before = fixtures.find(f => f.kind === 'before');
  const after = fixtures.find(f => f.kind === 'after');
  assert.equal(before.source, after.source, 'Comparison must use exactly the same executed text');
  assert.ok(!before.ansi.includes('\x1b[38;2;207;142;109mfrom'));
  assert.ok(after.ansi.includes('\x1b[38;2;207;142;109mfrom'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHarness } from './harness.mjs';

test('a compact setting saved under the previous package name carries over and is saved under the new name', async () => {
  const h = await createHarness({ seed: { 'pi-jetbrains-transparent.json': JSON.stringify({ compactTools: true }) } });
  try {
    const notices = [];
    await h.extension.commands.get('command-colors').handler('', { ui: { notify: text => notices.push(text) } });
    assert.match(notices.join('\n'), /Compact tool rows: on/);
    await h.extension.commands.get('command-colors').handler('compact off', { ui: { notify() {} } });
    const saved = JSON.parse(await readFile(join(h.dir, 'pi-darkroom.json'), 'utf8'));
    assert.equal(saved.compactTools, false);
  } finally { await h.close(); }
});

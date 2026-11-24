import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stripVTControlCharacters as strip } from 'node:util';
import { createHarness } from './harness.mjs';

let h;
before(async () => { h = await createHarness(); });
after(async () => h.close());

const output = Array.from({ length: 12 }, (_, i) => 'line ' + (i + 1)).join('\n');
const result = { content: [{ type: 'text', text: output }], details: {} };
function bashResult(overrides = {}, options = {}) {
  const native = h.sdk.createBashToolDefinition(h.dir);
  const wrapped = h.resolve('bash', native);
  const args = { command: 'printf demo' };
  return strip(wrapped.renderResult(result, { expanded: false, isPartial: false, ...options }, h.theme(),
    h.context(args, overrides)).render(100).join('\n'));
}
async function setCompact(value) {
  const notices = [];
  await h.extension.commands.get('command-colors').handler('compact ' + value, { ui: { notify: t => notices.push(t) } });
  return notices.join('\n');
}

test('compact rows are off by default: native output preview is shown', async () => {
  const text = bashResult();
  assert.ok(text.includes('line 12'));
});

test('compact on: a successful collapsed result is one summary line with an expand hint', async () => {
  assert.match(await setCompact('on'), /compact/i);
  const text = bashResult();
  assert.ok(!text.includes('line 12'));
  assert.match(text, /✓ 12 lines/);
  assert.match(text, /ctrl\+o/);
  const saved = JSON.parse(await readFile(join(h.dir, 'pi-darkroom.json'), 'utf8'));
  assert.equal(saved.compactTools, true);
});

test('compact on still shows expanded output, failures and running output in full', async () => {
  await setCompact('on');
  assert.ok(bashResult({}, { expanded: true }).includes('line 12'));
  assert.ok(bashResult({ isError: true }).includes('line 12'));
  assert.ok(bashResult({ isPartial: true }, { isPartial: true }).includes('line 12'));
});

test('compact off restores native previews and persists', async () => {
  await setCompact('off');
  assert.ok(bashResult().includes('line 12'));
  const saved = JSON.parse(await readFile(join(h.dir, 'pi-darkroom.json'), 'utf8'));
  assert.equal(saved.compactTools, false);
});


test('compact rows omit the expand hint when no expand key is configured', async () => {
  await setCompact('on');
  const text = bashResult({ keyText: () => '', keyHint: (_id, description) => ' ' + description });
  assert.match(text, /✓ 12 lines/);
  assert.doesNotMatch(text, /\(\s*to expand\)/);
  await setCompact('off');
});

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stripVTControlCharacters as strip } from 'node:util';
import { createHarness } from './harness.mjs';

const ORANGE = '\x1b[38;2;207;142;109m';
const CARD = '48;2;37;38;42';
const ADDED = '48;2;39;56;44';
const REMOVED = '48;2;62;40;42';
let h;
before(async () => { h = await createHarness(); });
after(async () => h.close());

async function editRow(file, content, edits, width = 100) {
  const path = join(h.dir, file);
  await writeFile(path, content);
  const definition = h.sdk.createEditToolDefinition(h.dir);
  const wrapped = h.resolve('edit', definition);
  const args = { path, edits };
  const theme = h.theme();
  let ready;
  const settled = new Promise(resolve => { ready = resolve; });
  const state = {};
  const first = wrapped.renderCall(args, theme, h.context(args, { state, invalidate: () => ready() }));
  await settled;
  const row = wrapped.renderCall(args, theme, h.context(args, { state, lastComponent: first }));
  return { wrapped, args, state, row, lines: row.render(width) };
}

test('edit previews highlight code by file language inside a card with tinted +/- lines', async () => {
  const { lines } = await editRow('demo.py', 'def greet(name):\n    return "hi"\n',
    [{ oldText: '    return "hi"', newText: '    return "hello, " + name' }]);
  const text = lines.join('\n');
  assert.ok(text.includes(ORANGE + 'def'), 'context keyword must use syntax color');
  assert.ok(text.includes(ORANGE + 'return'), 'changed keyword must use syntax color');
  assert.ok(text.includes(CARD), 'diff must sit in the gray code card');
  assert.ok(lines.some(l => l.includes(ADDED) && strip(l).includes('"hello, "')), 'added line tinted green');
  assert.ok(lines.some(l => l.includes(REMOVED) && strip(l).includes('"hi"')), 'removed line tinted red');
  const plain = strip(text);
  assert.ok(plain.includes('edit') && plain.includes('demo.py'), 'header keeps tool name and path');
  for (const fragment of ['def greet(name):', 'return "hi"', 'return "hello, " + name']) assert.ok(plain.includes(fragment));
});

test('single-line changes emphasize the changed segment more strongly than the rest of the line', async () => {
  const { lines } = await editRow('demo.js', 'const total = price * 2;\n',
    [{ oldText: 'price * 2', newText: 'price * quantity' }]);
  const added = lines.find(l => strip(l).includes('quantity'));
  assert.ok(added.includes('48;2;52;82;60'), 'changed words get strong added tint');
  assert.ok(added.includes(ADDED), 'unchanged words keep normal added tint');
});

test('unknown file types keep +/- tints and the card without guessed syntax colors', async () => {
  const { lines } = await editRow('notes.unknown-ext', 'return value one\n',
    [{ oldText: 'one', newText: 'two' }]);
  const text = lines.join('\n');
  assert.ok(text.includes(ADDED) && text.includes(REMOVED));
  assert.ok(!text.includes(ORANGE + 'return'));
});

test('diff cards fit narrow and wide terminals without losing content', async () => {
  const long = 'x = "' + 'a'.repeat(160) + '"\n';
  const { row } = await editRow('wide.py', long, [{ oldText: 'x =', newText: 'value =' }]);
  for (const width of [20, 40, 80, 140]) {
    for (const line of row.render(width)) assert.ok(h.tui.visibleWidth(line) <= width, `width ${width}`);
  }
  assert.ok(strip(row.render(400).join('\n')).includes('value = "' + 'a'.repeat(160)));
});

test('a failed preview keeps the native error text instead of an empty card', async () => {
  const { lines } = await editRow('missing.py', 'a = 1\n', [{ oldText: 'not present', newText: 'b' }]);
  const text = lines.join('\n');
  assert.ok(!text.includes(ADDED) && !text.includes(REMOVED));
  assert.ok(strip(text).length > 0);
});

test('the result row does not repeat the diff or draw an empty card', async () => {
  const { wrapped, args, state } = await editRow('dup.py', 'a = 1\n', [{ oldText: 'a = 1', newText: 'a = 2' }]);
  const diff = state.callComponent.preview.diff;
  const result = { content: [{ type: 'text', text: 'Edited' }], details: { diff } };
  const out = wrapped.renderResult(result, { expanded: false, isPartial: false }, h.theme(), h.context(args, { state }));
  const lines = out.render(80);
  assert.ok(!lines.join('').includes(CARD), 'no empty gray card under the diff');
});

test('light themes use light added/removed tints', async () => {
  const path = join(h.dir, 'light.py');
  await writeFile(path, 'a = 1\n');
  const definition = h.sdk.createEditToolDefinition(h.dir);
  const wrapped = h.resolve('edit', definition);
  const args = { path, edits: [{ oldText: 'a = 1', newText: 'a = 2' }] };
  const theme = h.theme('preview-light');
  let ready; const settled = new Promise(r => { ready = r; }); const state = {};
  const first = wrapped.renderCall(args, theme, h.context(args, { state, invalidate: () => ready() }));
  await settled;
  const text = wrapped.renderCall(args, theme, h.context(args, { state, lastComponent: first })).render(80).join('\n');
  assert.ok(text.includes('48;2;226;243;230') && text.includes('48;2;250;228;228'));
});


test('edit cards honor the output padding setting and keep header frames from other themes', async () => {
  const path = join(h.dir, 'pad.py');
  await writeFile(path, 'a = 1\n');
  const wrapped = h.resolve('edit', h.sdk.createEditToolDefinition(h.dir));
  const args = { path, edits: [{ oldText: 'a = 1', newText: 'a = 2' }] };
  const theme = h.theme();
  let ready; const settled = new Promise(r => { ready = r; }); const state = {};
  const first = wrapped.renderCall(args, theme, h.context(args, { state, outputPad: 2, invalidate: () => ready() }));
  await settled;
  const lines = wrapped.renderCall(args, theme, h.context(args, { state, outputPad: 2, lastComponent: first })).render(60);
  for (const line of lines) assert.ok(h.tui.visibleWidth(line) <= 60);
  const card = lines.find(line => line.includes(ADDED));
  assert.ok(strip(card).startsWith('  '), 'card is inset by the output padding');
});

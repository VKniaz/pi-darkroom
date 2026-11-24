import test from 'node:test';
import assert from 'node:assert/strict';
import { codeBlocks, pickCodeBlock } from '../copy-code.mjs';

const assistant = text => ({ type: 'message', message: { role: 'assistant', content: [{ type: 'text', text }] } });
const user = text => ({ type: 'message', message: { role: 'user', content: [{ type: 'text', text }] } });

test('extracts exact fenced code without fences, indentation padding or trailing newline', () => {
  const blocks = codeBlocks('Intro\n\n```bash\nnpm test\ngit status\n```\n\nMore\n\n~~~text\nHey all!\n  keep this indent\n~~~');
  assert.deepEqual(blocks, [
    { language: 'bash', code: 'npm test\ngit status' },
    { language: 'text', code: 'Hey all!\n  keep this indent' },
  ]);
});

test('longer fences can contain shorter ones, and up to three spaces of fence indent are removed', () => {
  const blocks = codeBlocks('````md\n```js\nx\n```\n````\n   ```py\n   print(1)\n     y\n   ```');
  assert.deepEqual(blocks, [
    { language: 'md', code: '```js\nx\n```' },
    { language: 'py', code: 'print(1)\n  y' },
  ]);
});

test('an unclosed final block is still copyable', () => {
  assert.deepEqual(codeBlocks('```js\nconst a = 1;'), [{ language: 'js', code: 'const a = 1;' }]);
});

test('picks the Nth most recent block across assistant messages and ignores user messages', () => {
  const entries = [
    assistant('```a\nfirst\n```'),
    user('```u\nnot mine\n```'),
    assistant('```b\nsecond\n```\n\n```c\nthird\n```'),
  ];
  assert.equal(pickCodeBlock(entries, 1).code, 'third');
  assert.equal(pickCodeBlock(entries, 2).code, 'second');
  assert.equal(pickCodeBlock(entries, 3).code, 'first');
  assert.equal(pickCodeBlock(entries, 4), undefined);
});

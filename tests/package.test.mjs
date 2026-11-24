import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

function localImports(file) {
  const source = readFileSync(join(root, file), 'utf8');
  return [...source.matchAll(/from\s+'(\.[^']+)'/g)].map(match => normalize(join(dirname(file), match[1])));
}

test('every module the extension loads is shipped in the npm package', () => {
  const entry = packageJson.pi.extensions[0].replace(/^\.\//, '');
  const seen = new Set();
  const pending = [entry];
  while (pending.length) {
    const file = pending.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    pending.push(...localImports(file));
  }
  const missing = [...seen].filter(file => !packageJson.files.includes(file));
  assert.deepEqual(missing, [], 'add these to package.json "files" or the published extension cannot load');
});

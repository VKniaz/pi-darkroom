import test from 'node:test';
import assert from 'node:assert/strict';
import { stripVTControlCharacters as strip } from 'node:util';
import { tintCliLines } from '../cli-words.mjs';

const orange = '\x1b[38;2;207;142;109m';
const green = '\x1b[38;2;106;171;115m';
const gray = '\x1b[38;2;122;126;133m';
const reset = '\x1b[39m';
const paint = word => orange + word + reset;
const options = { paint, ignoredForegrounds: [green, gray] };

test('colors common CLI executables at command positions', () => {
  const lines = ['npm test', 'gh pr view', 'git status', 'docker ps', 'kubectl get pods'];
  const result = tintCliLines(lines, options);
  for (let i = 0; i < lines.length; i++) {
    assert.ok(result[i].startsWith(orange + lines[i].split(' ')[0]));
    assert.equal(strip(result[i]), lines[i]);
  }
});

test('colors pipeline/control commands but not a command name used as an argument', () => {
  const result = tintCliLines(['git config gh && npm test | jq .', 'if gh pr view; then git status; fi'], options);
  assert.ok(result[0].includes(orange + 'git'));
  assert.ok(result[0].includes(orange + 'npm'));
  assert.ok(result[0].includes(orange + 'jq'));
  assert.ok(!result[0].includes(orange + 'gh'));
  assert.ok(result[1].includes(orange + 'gh'));
  assert.ok(result[1].includes(orange + 'git'));
});

test('keeps native string/comment spans and opaque heredoc data intact', () => {
  const lines = ['printf ' + green + '"git; npm test"' + reset, gray + '# do gh pr view' + reset, green + 'git status' + reset];
  const result = tintCliLines(lines, options);
  assert.ok(result[0].includes(orange + 'printf'));
  assert.ok(!result[0].includes(orange + 'npm'));
  assert.equal(result[1], lines[1]);
  assert.equal(result[2], lines[2]);
});

test('handles environment prefixes without expanding variables', () => {
  const result = tintCliLines(['PI_OFFLINE=1 npm test', 'MODE="demo" gh pr list'], options);
  assert.ok(result[0].includes(orange + 'npm'));
  assert.ok(result[1].includes(orange + 'gh'));
  assert.equal(strip(result[0]), 'PI_OFFLINE=1 npm test');
});

test('does not reinterpret a continued argument line as a new command', () => {
  const result = tintCliLines(['git config \\', '  gh'], options);
  assert.ok(result[0].includes(orange + 'git'));
  assert.ok(!result[1].includes(orange + 'gh'));
});

test('preserves frozen host arrays, Unicode, ANSI styles and visible source', () => {
  const lines = Object.freeze(['  git status # héllo 🌍', 'printf "file/npm.js"']);
  const result = tintCliLines(lines, options);
  assert.deepEqual(result.map(strip), [...lines]);
  assert.equal(lines[0], '  git status # héllo 🌍');
});


test('escaped separators do not turn following arguments into executable names', () => {
  const result = tintCliLines(['printf \\; git', 'printf \\| npm'], options);
  assert.ok(!result[0].includes(orange + 'git'));
  assert.ok(!result[1].includes(orange + 'npm'));
});

test('simple command wrappers retain executable styling for the command they invoke', () => {
  const result = tintCliLines(['sudo npm test', 'command gh pr list', 'env MODE=demo git status'], options);
  for (const [index, word] of ['npm', 'gh', 'git'].entries()) assert.ok(result[index].includes(orange + word));
});


test('heredoc contents and terminators are not mistaken for executable names', () => {
  const lines = ["cat <<'TEXT'", 'git status', 'TEXT', 'npm test'];
  const result = tintCliLines(lines, options);
  assert.ok(result[0].includes(orange + 'cat'));
  assert.equal(result[1], 'git status');
  assert.equal(result[2], 'TEXT');
  assert.ok(result[3].includes(orange + 'npm'));
});


test('command substitutions style executables without coloring their arguments or case labels', () => {
  const result = tintCliLines(['branch=$(git rev-parse HEAD)', 'path=$(pwd)', 'npm)'], options);
  assert.ok(result[0].includes(orange + 'git'));
  assert.ok(!result[0].includes(orange + 'rev-parse'));
  assert.ok(result[1].includes(orange + 'pwd'));
  assert.equal(result[2], 'npm)');
});

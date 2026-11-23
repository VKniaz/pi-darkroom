import test from 'node:test';
import assert from 'node:assert/strict';
import { highlightCommand } from '../highlight.mjs';

const paint = (code, language) => code.split('\n').map(line => `${language}:${line}`);

test('colors only the Python body while preserving the shell opener, delimiter and following commands', () => {
  const command = "python3 - <<'PY'\nfrom pathlib import Path\nprint('hello')\nPY\nprintf 'done\\n'";
  assert.deepEqual(highlightCommand(command, paint), [
    "bash:python3 - <<'PY'", 'python:from pathlib import Path', "python:print('hello')", 'bash:PY', "bash:printf 'done\\n'",
  ]);
});

test('handles repeated blocks and standalone versioned/path-qualified/uv Python interpreters', () => {
  const command = '/usr/bin/python3.12 - <<ONE\nx = 3\nONE\nuv run python - <<"TWO"\ny = 4\nTWO';
  assert.deepEqual(highlightCommand(command, paint), [
    'bash:/usr/bin/python3.12 - <<ONE', 'python:x = 3', 'bash:ONE',
    'bash:uv run python - <<"TWO"', 'python:y = 4', 'bash:TWO',
  ]);
});

test('colors Node.js heredocs as JavaScript for both module and commonjs input', () => {
  for (const opener of ["node --input-type=module <<'JS'", 'node --input-type commonjs - <<JS', 'nodejs <<JS']) {
    assert.deepEqual(highlightCommand(opener + '\nconst name = "hello";\nJS', paint), [
      'bash:' + opener, 'javascript:const name = "hello";', 'bash:JS',
    ]);
  }
});

test('does not treat stdin data for a named script or -c/-e program as source code', () => {
  for (const command of ['node script.mjs <<DATA\nnot code\nDATA', 'python3 -c "print(1)" <<DATA\nnot code\nDATA']) {
    assert.deepEqual(highlightCommand(command, paint), command.split('\n').map(line => 'bash:' + line));
  }
});

test('does not mutate cached arrays returned by the host highlighter', () => {
  const shell = Object.freeze(['opener', 'body', 'closer']);
  const result = highlightCommand('python3 - <<PY\nx = 1\nPY', (_code, lang) => lang === 'bash' ? shell : ['Python body']);
  assert.deepEqual(result, ['opener', 'Python body', 'closer']);
  assert.deepEqual(shell, ['opener', 'body', 'closer']);
});

test('skips non-Python heredocs as opaque even when their text looks like another Python opener', () => {
  const command = "cat <<'TEXT'\npython3 - <<'PY'\nprint('literal text')\nPY\nTEXT";
  assert.deepEqual(highlightCommand(command, paint), [
    "bash:cat <<'TEXT'", "bash:python3 - <<'PY'", "bash:print('literal text')", 'bash:PY', 'bash:TEXT',
  ]);
});

test('requires an exact terminator, except for tabs with the <<- operator', () => {
  const command = "python3 - <<-'PY'\n\tvalue = 1\n\tPYsuffix\n\tPY\necho end";
  assert.deepEqual(highlightCommand(command, paint), [
    "bash:python3 - <<-'PY'", 'python:\tvalue = 1', 'python:\tPYsuffix', 'bash:\tPY', 'bash:echo end',
  ]);
  assert.deepEqual(highlightCommand('python3 - <<PY\nx = 1\n PY', paint), [
    'bash:python3 - <<PY', 'bash:x = 1', 'bash: PY',
  ]);
});

test('leaves unclosed and multiple-redirection heredocs Bash-highlighted rather than guessing', () => {
  for (const command of ["python3 - <<'PY'\nfrom pathlib import Path", "python3 - <<PY <<OTHER\nprint('x')\nPY\nOTHER"]) {
    assert.deepEqual(highlightCommand(command, paint), command.split('\n').map(line => 'bash:' + line));
  }
});

test('ignores a commented-out opener and retains CRLF, empty lines and a trailing newline', () => {
  const command = '# python3 - <<FAKE\r\npython3 - <<PY\r\n\r\nname = "héllo 🌍"\r\nPY\r\n';
  assert.deepEqual(highlightCommand(command, paint), [
    'bash:# python3 - <<FAKE\r', 'bash:python3 - <<PY\r', 'python:\r',
    'python:name = "héllo 🌍"\r', 'bash:PY\r', 'bash:',
  ]);
});


test('highlights a remote stdin shell script and its nested Python instead of one opaque SSH string', () => {
  const command = "ssh mini 'bash -s' <<'REMOTE'\nprintf ready\npython3 - <<'PY'\nfrom pathlib import Path\nPY\nREMOTE";
  assert.deepEqual(highlightCommand(command, paint), [
    "bash:ssh mini 'bash -s' <<'REMOTE'", 'bash:printf ready', "bash:python3 - <<'PY'",
    'python:from pathlib import Path', 'bash:PY', 'bash:REMOTE',
  ]);
});

test('highlights direct shell stdin bodies and nested Node.js modules', () => {
  const command = "bash -s <<BASH\nnode --input-type=module <<JS\nexport const name = 'hello';\nJS\nBASH";
  assert.deepEqual(highlightCommand(command, paint), [
    'bash:bash -s <<BASH', 'bash:node --input-type=module <<JS',
    "javascript:export const name = 'hello';", 'bash:JS', 'bash:BASH',
  ]);
});

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { loadPiSdk } from '../scripts/pi-sdk.mjs';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripVTControlCharacters as strip } from 'node:util';

process.env.COLORTERM = 'truecolor';
process.env.TERM = 'xterm-256color';

const dir = await mkdtemp(join(tmpdir(), 'pi-command-colors-test-'));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = dir;
after(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await rm(dir, { recursive: true, force: true });
});
const { sdk, tui, nativeThemePath } = await loadPiSdk();
const { visibleWidth, Container, Text } = tui;
const extensionPath = fileURLToPath(new URL('../index.ts', import.meta.url));
await mkdir(join(dir, 'themes'));
const source = JSON.parse(await readFile(nativeThemePath, 'utf8'));
for (const [name, keyword] of [['preview-orange', '#CF8E6D'], ['preview-blue', '#1122AA']]) {
  await writeFile(join(dir, 'themes', name + '.json'), JSON.stringify({
    ...source, name, colors: {
      ...source.colors, syntaxKeyword: keyword, syntaxString: '#6AAB73',
      userMessageBg: '', customMessageBg: '', toolPendingBg: '', toolSuccessBg: '', toolErrorBg: '',
    },
  }));
}
const light = JSON.parse(await readFile(nativeThemePath.replace('dark.json', 'light.json'), 'utf8'));
await writeFile(join(dir, 'themes', 'preview-light.json'), JSON.stringify({ ...light, name: 'preview-light' }));
const loader = new sdk.DefaultResourceLoader({
  cwd: dir, agentDir: dir, noExtensions: true, noSkills: true, noPromptTemplates: true,
  additionalExtensionPaths: [extensionPath],
});
await loader.reload({ resolveProjectTrust: async () => false });
assert.deepEqual(loader.getExtensions().errors, []);
const extension = loader.getExtensions().extensions.find(e => e.path === extensionPath);
const native = sdk.createBashToolDefinition(dir);
const command = "python3 - <<'PY'\nfrom pathlib import Path\nprint('hello')\nPY";
const themes = loader.getThemes().themes;
let activeUiTheme;
for (const handler of extension.handlers.get('session_start') ?? []) {
  await handler({ reason: 'startup' }, { mode: 'tui', ui: { get theme() { return activeUiTheme; } } });
}

function theme(name = 'preview-orange') {
  sdk.initTheme(name, false);
  activeUiTheme = themes.find(t => t.name === name);
  return activeUiTheme;
}
function context(args, complete = true, lastComponent) {
  return {
    args, toolCallId: 'color-test', invalidate() {}, lastComponent, state: {}, cwd: dir,
    executionStarted: false, argsComplete: complete, isPartial: true, expanded: false,
    showImages: false, isError: false, durationMs: undefined, outputPad: 0,
    keyText: () => 'ctrl+e', keyHint: () => 'ctrl+e to expand',
  };
}
function renderer() {
  const resolver = extension.toolRenderers?.[0];
  assert.equal(typeof resolver, 'function', 'A display-only renderer must be registered');
  return resolver('bash', () => native);
}
const rendered = (component, width = 300) => component.render(width).join('\n');
const GRAY_CARD = '\x1b[48;2;37;38;42m';
const nativeText = (component, width = 300) => strip(rendered(component, width)).split('\n').map(line => line.trimEnd()).join('\n');
const cardText = (component, width = 300) => strip(rendered(component, width)).split('\n').slice(1, -1).map(line => line.slice(1).trimEnd()).join('\n');

test('adds display-only rendering and an activation check without tools or execution hooks', () => {
  assert.equal(extension.tools.size, 0);
  assert.deepEqual([...extension.handlers.keys()], ['session_start']);
  assert.ok(extension.commands.has('command-colors'));
  const wrapped = renderer();
  assert.equal(wrapped.renderShell, native.renderShell);
  const sample = { content: [{ type: 'text', text: 'one\ntwo' }], details: {} };
  const args = { command: 'printf demo' };
  assert.equal(rendered(wrapped.renderResult(sample, { expanded: false, isPartial: false }, theme(), context(args))),
    rendered(native.renderResult(sample, { expanded: false, isPartial: false }, theme(), context(args))));
});

test('completed Bash commands and embedded Python receive real syntax colors without changing input', () => {
  const args = Object.freeze({ command, timeout: 10 });
  const row = renderer().renderCall(args, theme(), context(args));
  const output = rendered(row);
  assert.ok(output.includes('\x1b[38;2;207;142;109mfrom'), 'Python from must be orange, not a Bash string');
  assert.ok(output.includes('38;2;106;171;115'), 'Python strings must use the active theme');
  assert.equal(cardText(row),
    "$ python3 - <<'PY'\nfrom pathlib import Path\nprint('hello')\nPY (timeout 10s)");
  assert.equal(args.command, command);
  assert.equal(args.timeout, 10);
});

test('completed Node.js module heredocs get JavaScript colors rather than Bash string colors', () => {
  const args = { command: "node --input-type=module <<'JS'\nimport fs from 'node:fs';\nJS" };
  const output = rendered(renderer().renderCall(args, theme(), context(args)));
  assert.ok(output.includes('\x1b[38;2;207;142;109mimport'));
  assert.ok(strip(output).includes("import fs from 'node:fs';"));
});

for (const [extensionName, content] of [
  ['mjs', 'export const name = "hello";\n'], ['js', 'const name = "hello";\n'],
  ['ts', 'const name: string = "hello";\n'], ['py', 'name = "hello"\n'], ['json', '{"name": "hello"}\n'],
  ['yaml', 'name: "hello"\n'], ['yml', 'name: "hello"\n'],
  ['java', 'public class Example {\n  String name = "hello";\n}\n'],
]) {
  test(`preserves native filename-based highlighting for .${extensionName} file previews`, () => {
    const resolver = extension.toolRenderers[0];
    const activeTheme = theme();
    const args = { path: 'example.' + extensionName, content };
    const write = sdk.createWriteToolDefinition(dir);
    const resolved = resolver('write', () => write);
    assert.equal(resolved.renderResult, write.renderResult);
    assert.ok(rendered(resolved.renderCall(args, activeTheme, context(args))).includes('38;2;106;171;115'));
    const read = sdk.createReadToolDefinition(dir);
    const resolvedRead = resolver('read', () => read);
    const result = { content: [{ type: 'text', text: content }], details: {} };
    const row = resolvedRead.renderResult(result, { expanded: true, isPartial: false }, activeTheme, context(args));
    assert.ok(rendered(row).includes('38;2;106;171;115'));
  });
}

test('partial arguments retain native source in a gray card until argsComplete enables syntax colors', () => {
  const args = { command };
  const activeTheme = theme();
  const wrapped = renderer();
  const ctx = context(args, false);
  const partial = wrapped.renderCall(args, activeTheme, ctx);
  assert.equal(cardText(partial), nativeText(native.renderCall(args, activeTheme, context(args, false)), 298));
  assert.ok(rendered(partial).includes(GRAY_CARD));
  assert.ok(!rendered(partial).includes('38;2;207;142;109'));
  const complete = wrapped.renderCall(args, activeTheme, { ...ctx, argsComplete: true, lastComponent: partial });
  assert.ok(rendered(complete).includes('\x1b[38;2;207;142;109mfrom'));
});

test('theme changes recolor the same row instead of retaining cached old colors', () => {
  const args = { command };
  const wrapped = renderer();
  const first = wrapped.renderCall(args, theme(), context(args));
  assert.ok(rendered(first).includes('\x1b[38;2;207;142;109mfrom'));
  const second = wrapped.renderCall(args, theme('preview-blue'), context(args, true, first));
  const output = rendered(second);
  assert.ok(output.includes('\x1b[38;2;17;34;170mfrom'));
  assert.ok(!output.includes('38;2;207;142;109'));
});

test('retains other tool call content and native results, leaving unresolved tools untouched', () => {
  const resolver = extension.toolRenderers?.[0];
  assert.equal(typeof resolver, 'function');
  const args = { command };
  const activeTheme = theme();
  const wrapped = resolver('read', () => native);
  assert.equal(rendered(wrapped.renderCall(args, activeTheme, context(args))),
    rendered(native.renderCall(args, activeTheme, context(args))));
  assert.equal(resolver('mcp__test__search', () => undefined), undefined);
});

test('failed calls have an explicit red text label while preserving command and timeout', () => {
  const args = { command, timeout: 10 };
  const activeTheme = theme();
  const wrapped = renderer();
  const failedContext = { ...context(args), isError: true, isPartial: false };
  const first = wrapped.renderCall(args, activeTheme, failedContext);
  const output = rendered(first);
  assert.ok(output.includes(activeTheme.getFgAnsi('error') + '✗ Failed'));
  assert.ok(strip(output).includes('from pathlib import Path'));
  assert.ok(strip(output).includes('(timeout 10s)'));
  const second = wrapped.renderCall(args, activeTheme, { ...failedContext, lastComponent: first });
  assert.ok(strip(rendered(second)).includes('✗ Failed'));
  const success = wrapped.renderCall(args, activeTheme, context(args, true, second));
  assert.ok(!strip(rendered(success)).includes('✗ Failed'));
});

test('failed native file-tool previews receive the same error label without hiding the file path', () => {
  const args = { path: 'example.mjs' };
  const nativeRead = sdk.createReadToolDefinition(dir);
  const wrapped = extension.toolRenderers[0]('read', () => nativeRead);
  const row = wrapped.renderCall(args, theme(), { ...context(args), isError: true });
  const output = strip(rendered(row));
  assert.ok(output.includes('✗ Failed'));
  assert.ok(output.includes('example.mjs'));
});

test('real failed tool rows keep red text indicators without emitting any panel background', () => {
  theme();
  const row = new sdk.ToolExecutionComponent('bash', 'failed-row', { command: 'printf demo' },
    { outputPad: 0 }, renderer(), { requestRender() {} }, dir);
  row.setArgsComplete();
  row.markExecutionStarted();
  row.updateResult({ content: [{ type: 'text', text: 'Synthetic failure preview (render only)' }],
    details: {}, isError: true, durationMs: 12 }, false);
  const output = rendered(row, 80);
  assert.ok(strip(output).includes('✗ Failed'));
  assert.ok(strip(output).includes('Synthetic failure preview (render only)'));
  for (const [color] of output.matchAll(/\x1b\[48;[0-9;]+m/g)) assert.equal(color, GRAY_CARD);
  const label = row.render(80).find(line => strip(line).includes('✗ Failed'));
  assert.ok(!label.includes('\x1b[48;'), 'The failure label itself stays on the transparent conversation background');
  for (const line of row.render(80)) assert.ok(visibleWidth(line) <= 80);
});

test('invalid, absent and empty command arguments retain native error/placeholder rendering', () => {
  const activeTheme = theme();
  const wrapped = renderer();
  for (const args of [{}, { command: 42 }, { command: '' }]) {
    assert.equal(rendered(wrapped.renderCall(args, activeTheme, context(args))),
      rendered(native.renderCall(args, activeTheme, context(args))));
  }
});

test('oversized commands remain fully visible in native/plain rendering', () => {
  const args = { command: 'for value in ' + 'x'.repeat(50_001) };
  const activeTheme = theme();
  const actual = rendered(renderer().renderCall(args, activeTheme, context(args)), 60_000);
  assert.equal(cardText(renderer().renderCall(args, activeTheme, context(args)), 60_000),
    nativeText(native.renderCall(args, activeTheme, context(args)), 59_998));
  assert.ok(strip(actual).includes('x'.repeat(50_001)));
});

test('native text layout fits narrow and wide terminals with Unicode and long lines', () => {
  const args = { command: 'printf "héllo 🌍 漢字"\n' + command + '\nprintf "' + 'x'.repeat(250) + '"' };
  const row = renderer().renderCall(args, theme(), context(args));
  for (const width of [12, 24, 80, 140]) {
    row.invalidate();
    for (const line of row.render(width)) {
      assert.ok(visibleWidth(line) <= width);
    }
  }
  assert.ok(strip(rendered(row, 400)).includes('héllo 🌍 漢字'));
});

test('leaves a different extension\'s non-Text command component untouched', () => {
  const component = new Container();
  component.addChild(new Text('custom command preview', 0, 0));
  const original = { renderCall: () => component };
  const wrapped = extension.toolRenderers[0]('bash', () => original);
  assert.equal(wrapped.renderCall({ command }, theme(), context({ command })), component);
  assert.ok(strip(rendered(component)).includes('custom command preview'));
});

test('a coloring failure retains the full native command preview', () => {
  const activeTheme = theme();
  const unavailableColors = new Proxy(activeTheme, {
    get(target, key) {
      if (key === 'colors') throw new Error('theme metadata unavailable');
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const args = { command };
  assert.equal(cardText(renderer().renderCall(args, unavailableColors, context(args))),
    nativeText(native.renderCall(args, unavailableColors, context(args)), 298));
});

test('rendering shell side effects does not execute them', async () => {
  const marker = join(dir, 'must-not-exist');
  const args = { command: `printf unwanted > '${marker}'` };
  assert.ok(strip(rendered(renderer().renderCall(args, theme(), context(args)))).includes('printf unwanted'));
  await assert.rejects(() => access(marker), { code: 'ENOENT' });
});


test('activation command reports that the display-only renderer is loaded', async () => {
  const command = extension.commands.get('command-colors');
  assert.ok(command);
  const notices = [];
  await command.handler('', { ui: { notify: text => notices.push(text) } });
  assert.ok(notices.some(text => text.includes('enabled')));
});


function markdownPreview(source, streaming = false, width = 80) {
  const registration = extension.markdownTransformer;
  assert.ok(registration, 'A display-only Markdown transformer must be registered');
  const component = new tui.Markdown(source, 0, 0, sdk.getMarkdownTheme(), undefined, {
    transform: (markdown, availableWidth) => registration.transformer(markdown, {
      messageType: 'assistant', isStreaming: streaming, availableWidth,
      messageId: undefined, timestamp: undefined,
    }),
  });
  return component.render(width);
}

test('recognized code has a gray card while surrounding Markdown prose stays transparent', () => {
  theme();
  const lines = markdownPreview('Narrative before.\n\n```java\npublic class Example {}\n```\n\nNarrative after.');
  const code = lines.find(line => strip(line).includes('public class Example'));
  assert.ok(code.includes(GRAY_CARD));
  assert.ok(code.includes('\x1b[38;2;207;142;109mpublic'));
  for (const phrase of ['Narrative before.', 'Narrative after.']) {
    const line = lines.find(line => strip(line).includes(phrase));
    assert.ok(line && !line.includes('\x1b[48;'));
  }
});

test('unknown Markdown code gets the same gray card with plain text instead of guessed syntax', () => {
  theme();
  const lines = markdownPreview('```unknown-demo-language\npublic class hello = "value"\n```');
  const code = lines.find(line => strip(line).includes('public class hello'));
  assert.ok(code.includes(GRAY_CARD));
  assert.ok(!code.includes('38;2;207;142;109'));
  assert.ok(!code.includes('38;2;106;171;115'));
});

test('streaming code retains its gray card and gains syntax coloring when complete', () => {
  theme();
  const partial = markdownPreview('```java\npublic class Example', true).join('\n');
  const complete = markdownPreview('```java\npublic class Example {}\n```').join('\n');
  assert.ok(partial.includes(GRAY_CARD));
  assert.ok(!partial.includes('\x1b[38;2;207;142;109mpublic'));
  assert.ok(complete.includes(GRAY_CARD));
  assert.ok(complete.includes('\x1b[38;2;207;142;109mpublic'));
});

test('inline code and narrative are not transformed into code cards', () => {
  theme();
  const source = 'Use `name` here, not a code block.';
  assert.equal(extension.markdownTransformer?.transformer(source, {
    messageType: 'assistant', isStreaming: false, availableWidth: 80,
  }), source);
});

test('Markdown cards preserve special characters and fit narrow/wide layouts', () => {
  theme();
  const source = '```mjs\nconst value = "héllo 🌍 <>&*`";\n```';
  for (const width of [12, 24, 80, 140]) {
    const lines = markdownPreview(source, false, width);
    for (const line of lines) assert.ok(visibleWidth(line) <= width);
  }
  assert.ok(strip(markdownPreview(source, false, 140).join('\n')).includes('héllo 🌍 <>&*`'));
});

test('unknown file source previews get a gray card without guessing a language', () => {
  const activeTheme = theme();
  const write = sdk.createWriteToolDefinition(dir);
  const wrapped = extension.toolRenderers[0]('write', () => write);
  const args = { path: 'example.unknown-demo', content: 'public class hello = "value"\n' };
  const output = rendered(wrapped.renderCall(args, activeTheme, context(args)));
  assert.ok(output.includes(GRAY_CARD));
  assert.ok(!output.includes('\x1b[38;2;207;142;109mpublic'));
  assert.ok(strip(output).includes('public class hello'));
});

test('ordinary runtime output stays native instead of being guessed as source code', () => {
  const activeTheme = theme();
  const wrapped = renderer();
  const args = { command: 'printf demo' };
  const result = { content: [{ type: 'text', text: 'public class is just a log line' }], details: {} };
  const row = wrapped.renderResult(result, { expanded: true, isPartial: false }, activeTheme, context(args));
  assert.ok(!rendered(row).includes(GRAY_CARD));
  assert.ok(strip(rendered(row)).includes('public class is just a log line'));
});


test('Markdown cards retain multiple blocks, indentation and tabs without overflowing', () => {
  theme();
  const source = 'Before.\n\n```py\nif True:\n\tprint("hello")\n```\n\nBetween.\n\n```custom\nkeep *literal* text\n```\n\nAfter.';
  for (const width of [12, 24, 80]) {
    const lines = markdownPreview(source, false, width);
    for (const line of lines) assert.ok(visibleWidth(line) <= width);
    const text = strip(lines.join('\n'));
    for (const phrase of ['Before.', 'Between.', 'After.']) assert.ok(text.includes(phrase));
  }
  assert.ok(strip(markdownPreview(source, false, 120).join('\n')).includes('keep *literal* text'));
});

test('file result cards can redraw and then return to an unboxed native error', () => {
  const activeTheme = theme();
  const read = sdk.createReadToolDefinition(dir);
  const wrapped = extension.toolRenderers[0]('read', () => read);
  const args = { path: 'example.js' };
  const result = { content: [{ type: 'text', text: 'const name = "hello";' }], details: {} };
  const first = wrapped.renderResult(result, { expanded: true, isPartial: false }, activeTheme, context(args));
  assert.ok(rendered(first).includes(GRAY_CARD));
  const second = wrapped.renderResult(result, { expanded: true, isPartial: false }, activeTheme, context(args, true, first));
  assert.ok(rendered(second).includes(GRAY_CARD));
  const error = wrapped.renderResult({ content: [{ type: 'text', text: 'No such file' }], details: {} },
    { expanded: true, isPartial: false }, activeTheme, { ...context(args, true, second), isError: true });
  assert.ok(!rendered(error).includes(GRAY_CARD));
  assert.ok(strip(rendered(error)).includes('No such file'));
});

test('very narrow Markdown layouts retain native output rather than corrupting source', () => {
  theme();
  const source = '```js\nx\n```';
  assert.equal(extension.markdownTransformer.transformer(source, {
    messageType: 'assistant', isStreaming: false, availableWidth: 3,
  }), source);
});


test('light themes use a light gray code card instead of unreadable dark fill', () => {
  const activeTheme = theme('preview-light');
  const args = { command: 'printf "hello"' };
  const output = rendered(renderer().renderCall(args, activeTheme, context(args)));
  assert.ok(output.includes('\x1b[48;2;243;244;246m'));
  assert.ok(!output.includes(GRAY_CARD));
  const markdown = markdownPreview('```text\nhello\n```').join('\n');
  assert.ok(markdown.includes('\x1b[48;2;243;244;246m'));
});


test('complex indented Markdown fences keep native rendering rather than gaining malformed padding', () => {
  theme();
  const source = '- Details:\n\n  ```java\n  public class Example {}\n  ```\n';
  assert.equal(extension.markdownTransformer.transformer(source, {
    messageType: 'assistant', isStreaming: false, availableWidth: 80,
  }), source);
});

test('self-framed file result renderers retain their own component without a second frame', () => {
  const component = new Container();
  component.addChild(new Text('custom file preview', 0, 0));
  const read = sdk.createReadToolDefinition(dir);
  const original = { ...read, renderShell: 'self', renderResult: () => component };
  const wrapped = extension.toolRenderers[0]('read', () => original);
  const args = { path: 'example.js' };
  const result = { content: [{ type: 'text', text: 'const x = 1;' }], details: {} };
  assert.equal(wrapped.renderResult(result, { expanded: true, isPartial: false }, theme(), context(args)), component);
});


test('Bash executable names including npm/git/gh and custom commands share the keyword color', () => {
  const args = { command: 'npm test\ngit status\ngh pr list\nmy-build-tool --help' };
  const output = rendered(renderer().renderCall(args, theme(), context(args)));
  for (const word of ['npm', 'git', 'gh', 'my-build-tool']) {
    assert.ok(output.includes('\x1b[38;2;207;142;109m' + word), word + ' must use the keyword color');
  }
  assert.equal(args.command, 'npm test\ngit status\ngh pr list\nmy-build-tool --help');
});

test('command-name colors do not leak into embedded Python variables or string arguments', () => {
  const args = { command: "python3 - <<'PY'\ngit = \"hello\"\nPY\nprintf '%s' git" };
  const output = rendered(renderer().renderCall(args, theme(), context(args)));
  assert.ok(output.includes('\x1b[38;2;207;142;109mprintf'));
  assert.ok(!output.includes('\x1b[38;2;207;142;109mgit'));
});

test('shell file read/write previews use the same executable-name colors', () => {
  const activeTheme = theme();
  const args = { path: 'example.sh', content: 'npm test\ngit status\ngh pr list\n' };
  const write = sdk.createWriteToolDefinition(dir);
  const wrappedWrite = extension.toolRenderers[0]('write', () => write);
  const read = sdk.createReadToolDefinition(dir);
  const wrappedRead = extension.toolRenderers[0]('read', () => read);
  const call = rendered(wrappedWrite.renderCall(args, activeTheme, context(args)));
  const result = rendered(wrappedRead.renderResult({ content: [{ type: 'text', text: args.content }], details: {} },
    { expanded: true, isPartial: false }, activeTheme, context(args)));
  for (const output of [call, result]) {
    for (const word of ['npm', 'git', 'gh']) assert.ok(output.includes('\x1b[38;2;207;142;109m' + word));
  }
});

test('Bash Markdown cards apply executable colors while unknown code remains plain', () => {
  theme();
  const known = markdownPreview('```bash\nnpm test\ngit status\ngh pr list\n```').join('\n');
  const unknown = markdownPreview('```unknown-demo\nnpm test\ngit status\n```').join('\n');
  for (const word of ['npm', 'git', 'gh']) assert.ok(known.includes('\x1b[38;2;207;142;109m' + word));
  assert.ok(!unknown.includes('\x1b[38;2;207;142;109mnpm'));
});


test('plain-text cards use brighter body text and orange UUID/timestamp accents', () => {
  theme();
  const id = '123e4567-e89b-42d3-a456-426614174000';
  const source = '```text\nSynthetic event ' + id + '\nStarted 2030-01-02T03:04:05.678Z\nRange 03:04:05.001–03:04:06.002\nHTTP 202; count 65\n```';
  const output = markdownPreview(source, false, 140).join('\n');
  assert.ok(output.includes('\x1b[38;2;230;232;237mSynthetic event '));
  assert.ok(output.includes('\x1b[38;2;207;142;109m' + id));
  assert.ok(output.includes('\x1b[38;2;207;142;109m2030-01-02T03:04:05.678Z'));
  assert.ok(output.includes('\x1b[38;2;207;142;109m03:04:05.001'));
  assert.ok(!output.includes('\x1b[38;2;207;142;109m202'));
  assert.ok(!output.includes('\x1b[38;2;207;142;109m65'));
  assert.ok(strip(output).includes('HTTP 202; count 65'));
});

test('structured text accents do not override strings in recognized programming languages', () => {
  theme();
  const id = '123e4567-e89b-42d3-a456-426614174000';
  const output = markdownPreview('```js\nconst id = "' + id + '";\n```', false, 140).join('\n');
  assert.ok(output.includes('38;2;106;171;115'));
  assert.ok(!output.includes('\x1b[38;2;207;142;109m' + id));
});

test('/copy-code reports when there is nothing to copy instead of touching the clipboard', async () => {
  const notices = [];
  await extension.commands.get('copy-code').handler('', {
    ui: { notify: (text, level) => notices.push([text, level]) },
    sessionManager: { getBranch: () => [] },
  });
  assert.match(notices[0][0], /no code block/i);
});

test('/copy-code rejects invalid positions', async () => {
  const notices = [];
  await extension.commands.get('copy-code').handler('zero', {
    ui: { notify: (text, level) => notices.push([text, level]) },
    sessionManager: { getBranch: () => [] },
  });
  assert.match(notices[0][0], /usage/i);
});

const cardBody = (component, width) => strip(rendered(component, width)).split('\n').slice(1, -1).map(line => line.slice(1).trimEnd());
const withoutSpaces = text => text.replace(/\s+/g, '');

test('wrapped command lines continue with a hanging indent instead of restarting at the card edge', () => {
  const command = 'herdr pane read "$HERDR_PANE_ID" --source recent --format ansi > /tmp/capture.ansi\n'
    + '  echo one two three four five six seven eight nine ten';
  const args = { command };
  const row = renderer().renderCall(args, theme(), context(args));
  const lines = cardBody(row, 40);
  const echo = lines.findIndex(line => line.startsWith('  echo'));
  assert.ok(lines[0].startsWith('$ herdr'));
  assert.ok(echo > 1, 'the first command should wrap before the echo line');
  for (const line of lines.slice(1, echo)) assert.match(line, /^ {2}\S/);
  assert.ok(echo < lines.length - 1, 'the echo line should wrap too');
  for (const line of lines.slice(echo + 1)) assert.match(line, /^ {4}\S/);
  assert.equal(withoutSpaces(lines.join('')), withoutSpaces('$ ' + command));
  for (const line of row.render(40)) assert.ok(visibleWidth(line) <= 40);
});

test('wrapped Markdown code lines continue with a hanging indent', () => {
  theme();
  const source = 'npm test && git status --short && gh pr list --limit 3 --state open';
  const lines = markdownPreview('```bash\n' + source + '\n```', false, 30).map(line => strip(line));
  const start = lines.findIndex(line => line.includes('npm test'));
  const end = lines.findIndex((line, index) => index > start && !line.trim());
  const body = lines.slice(start, end).map(line => line.trimEnd());
  const indent = body[0].length - body[0].trimStart().length;
  assert.ok(body.length > 1, 'the command should wrap at 30 columns');
  for (const line of body.slice(1)) assert.equal(line.length - line.trimStart().length, indent + 2);
  assert.equal(withoutSpaces(body.join('')), withoutSpaces(source));
});

import { mkdtemp, mkdir, copyFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadPiSdk } from '../scripts/pi-sdk.mjs';

const remoteShell = "ssh demo-host 'bash -s' <<'REMOTE'\nset -eu\n\npython3 - <<'PY'\nfrom pathlib import Path\n\nname = \"hello\"\nif name:\n    print(name)\nPY\nREMOTE";
const moduleScript = "npm test\ngit status\ngh pr list\n\nnode --input-type=module <<'JS'\nconst items = [\"one\", \"two\"];\n\nfor (const item of items) {\n  console.log(item);\n}\nJS";
const failureScript = "node --input-type=module <<'JS'\nthrow new Error(\"Demo failure\");\nJS";
const samples = [
  ['javascript', 'JavaScript · .mjs / .js', 'example.mjs', 'export function greet(name) {\n  const message = "Hello, " + name;\n  return message;\n}\n'],
  ['typescript', 'TypeScript · .ts', 'example.ts', 'type User = { name: string };\n\nexport function greet(user: User): string {\n  return "Hello, " + user.name;\n}\n'],
  ['python', 'Python · .py', 'example.py', '# Readable comments, keywords and strings\ndef greet(name, retries=3):\n    if retries > 0:\n        return "Hello, " + name\n    return None\n'],
  ['yaml', 'YAML · .yaml / .yml', 'example.yaml', '# Configuration preview\nservice:\n  name: "hello"\n  enabled: true\n  retries: 3\n'],
  ['java', 'Java · .java', 'Example.java', 'public class Example {\n    private final String name = "hello";\n\n    public String greet() {\n        return name;\n    }\n}\n'],
  ['json', 'JSON · .json', 'example.json', '{\n  "name": "hello",\n  "enabled": true,\n  "retries": 3\n}\n'],
  ['bash', 'Shell · .sh', 'example.sh', '# Consistent command colors\nnpm test\ngit status\ngh pr list\ndocker ps\n'],
];

export async function buildFixtures() {
  process.env.COLORTERM = 'truecolor';
  process.env.TERM = 'xterm-256color';
  const previous = process.env.PI_CODING_AGENT_DIR;
  const dir = await mkdtemp(join(tmpdir(), 'pi-visual-demo-'));
  process.env.PI_CODING_AGENT_DIR = dir;
  try {
    const { sdk, tui } = await loadPiSdk();
    const themeNames = ['darkroom-dark', 'darkroom-classic'];
    await mkdir(join(dir, 'themes'));
    for (const name of themeNames) await copyFile(resolve('themes', name + '.json'), join(dir, 'themes', name + '.json'));
    const extensionPath = resolve('index.ts');
    const loader = new sdk.DefaultResourceLoader({ cwd: dir, agentDir: dir, noExtensions: true,
      noSkills: true, noPromptTemplates: true, additionalExtensionPaths: [extensionPath] });
    await loader.reload({ resolveProjectTrust: async () => false });
    const loaded = loader.getExtensions();
    if (loaded.errors.length) throw new Error(JSON.stringify(loaded.errors));
    const resolver = loaded.extensions.find(e => e.path === extensionPath).toolRenderers[0];
    const fixtures = [];
    for (const themeName of themeNames) {
      sdk.initTheme(themeName, false);
      const activeTheme = loader.getThemes().themes.find(theme => theme.name === themeName);
      for (const handler of loaded.extensions.find(e => e.path === extensionPath).handlers.get('session_start') ?? []) {
        await handler({ reason: 'startup' }, { mode: 'tui', ui: { theme: activeTheme } });
      }
      const modern = themeName === 'darkroom-dark';
      const themeLabel = modern ? 'Darkroom Dark' : 'Darkroom Classic';
      const palette = { background: modern ? '#1e1f22' : '#2b2b2b', foreground: modern ? '#bcbec4' : '#a9b7c6' };
      function add(key, title, language, tool, args, kind = 'code', group = 'overview', cols = 62, native = false) {
        const definition = tool === 'bash' ? sdk.createBashToolDefinition(dir) : sdk.createWriteToolDefinition(dir);
        const renderers = native ? definition : resolver(tool, () => definition);
        const row = new sdk.ToolExecutionComponent(tool, key, Object.freeze(args), { outputPad: 0 }, renderers,
          { requestRender() {} }, dir);
        row.setArgsComplete();
        row.setExpanded(true);
        if (kind === 'failure') {
          row.markExecutionStarted();
          row.updateResult({ content: [{ type: 'text', text: 'Synthetic failure preview — no command executed.' }],
            details: {}, isError: true, durationMs: 0 }, false);
        }
        const lines = row.render(cols);
        fixtures.push({ key, title, language, themeName, themeLabel, palette, kind, group, cols,
          rows: Math.max(lines.length + 1, 5), source: args.command ?? args.content,
          ansi: lines.map(line => line + '\x1b[0m').join('\r\n') });
      }
      add('remote-shell', 'Remote shell + embedded Python', 'python', 'bash', { command: remoteShell });
      add('node-module', 'CLI commands + Node.js module', 'javascript', 'bash', { command: moduleScript });
      add('failure', 'Failure indicator · no red panel', 'bash', 'bash', { command: failureScript }, 'failure', 'overview', 126);
      if (modern) {
        const registration = loaded.extensions.find(e => e.path === extensionPath).markdownTransformer;
        const plainSource = '```text\nSynthetic event summary\n\nRequest ID: 123e4567-e89b-42d3-a456-426614174000\nStarted: 2030-01-02 at 03:04:05.678 UTC\nFinished: 2030-01-02T03:04:06.789Z\nWindow: 03:04:05.001–03:04:06.002\n\nHTTP status: 202\nItem count: 65\nNo real service, customer or incident data is included.\n```';
        const plainComponent = new tui.Markdown(plainSource, 0, 0, sdk.getMarkdownTheme(), undefined, {
          transform: (text, availableWidth) => registration.transformer(text, {
            messageType: 'assistant', isStreaming: false, availableWidth,
          }),
        });
        const plainLines = plainComponent.render(126);
        const diffFile = join(dir, 'greeting.py');
        await writeFile(diffFile, 'from dataclasses import dataclass\n\n\n@dataclass\nclass Greeting:\n    name: str\n    retries: int = 3\n\n    def render(self) -> str:\n        return "Hello " + self.name\n');
        const editArgs = Object.freeze({ path: diffFile, edits: [
          { oldText: '    retries: int = 3', newText: '    retries: int = 5\n    enabled: bool = True' },
          { oldText: '        return "Hello " + self.name', newText: '        return f"Hello, {self.name}!"' },
        ] });
        const editRenderer = resolver('edit', () => sdk.createEditToolDefinition(dir));
        const editState = {};
        let previewReady;
        const previewSettled = new Promise(resolve => { previewReady = resolve; });
        const editContext = extra => ({ args: editArgs, toolCallId: 'diff-demo', invalidate() { previewReady(); }, state: editState,
          cwd: dir, executionStarted: true, argsComplete: true, isPartial: false, expanded: false, showImages: false,
          isError: false, durationMs: undefined, outputPad: 1, keyText: () => 'ctrl+o', keyHint: (_id, text) => 'ctrl+o ' + text, ...extra });
        const nativeEdit = sdk.createEditToolDefinition(dir);
        const nativeState = {};
        let nativeReady;
        const nativeSettled = new Promise(resolve => { nativeReady = resolve; });
        const nativeContext = extra => ({ ...editContext(extra), state: nativeState, invalidate() { nativeReady(); } });
        const nativeFirst = nativeEdit.renderCall(editArgs, activeTheme, nativeContext({}));
        await nativeSettled;
        const nativeDiffLines = nativeEdit.renderCall(editArgs, activeTheme, nativeContext({ lastComponent: nativeFirst })).render(110)
          .map(line => line.replaceAll(dir + '/', ''));
        fixtures.push({ key: 'native-diff', title: 'Plain Pi · edit diff', language: 'python', themeName, themeLabel, palette,
          kind: 'native-diff', group: 'demo-diff-before', cols: 110, rows: nativeDiffLines.length + 1,
          source: '', ansi: nativeDiffLines.map(line => line + '\x1b[0m').join('\r\n') });
        const firstEdit = editRenderer.renderCall(editArgs, activeTheme, editContext({}));
        await previewSettled;
        const diffLines = editRenderer.renderCall(editArgs, activeTheme, editContext({ lastComponent: firstEdit })).render(126)
          .map(line => line.replaceAll(dir + '/', ''));
        const demoDiffLines = editRenderer.renderCall(editArgs, activeTheme, editContext({ lastComponent: firstEdit })).render(110)
          .map(line => line.replaceAll(dir + '/', ''));
        fixtures.push({ key: 'demo-diff', title: 'pi-darkroom · edit diff', language: 'python', themeName, themeLabel, palette,
          kind: 'demo-diff', group: 'demo-diff-after', cols: 110, rows: demoDiffLines.length + 1,
          source: '', ansi: demoDiffLines.map(line => line + '\x1b[0m').join('\r\n') });
        fixtures.push({ key: 'diff-card', title: 'Edit diff · syntax colors, tinted +/- lines, emphasized changes', language: 'python',
          themeName, themeLabel, palette, kind: 'diff', group: 'diffs', cols: 126, rows: diffLines.length + 1,
          source: editArgs.edits.map(edit => edit.newText).join('\n'), ansi: diffLines.map(line => line + '\x1b[0m').join('\r\n') });
        const commandHandler = loaded.extensions.find(e => e.path === extensionPath).commands.get('command-colors').handler;
        await commandHandler('compact on', { ui: { notify() {} } });
        const bashRenderer = resolver('bash', () => sdk.createBashToolDefinition(dir));
        const compactArgs = Object.freeze({ command: 'npm test' });
        const compactRow = new sdk.ToolExecutionComponent('bash', 'compact-demo', compactArgs, { outputPad: 0 }, bashRenderer,
          { requestRender() {} }, dir);
        compactRow.setArgsComplete();
        compactRow.markExecutionStarted();
        compactRow.updateResult({ content: [{ type: 'text', text: Array.from({ length: 48 }, (_, i) => `ok ${i + 1} - synthetic test`).join('\n') }],
          details: {}, isError: false, durationMs: 2300 }, false);
        const compactLines = compactRow.render(126);
        await commandHandler('compact off', { ui: { notify() {} } });
        fixtures.push({ key: 'compact-row', title: 'Optional compact rows · /command-colors compact on', language: 'bash',
          themeName, themeLabel, palette, kind: 'compact', group: 'diffs', cols: 126, rows: compactLines.length + 1,
          source: compactArgs.command, ansi: compactLines.map(line => line + '\x1b[0m').join('\r\n') });
        fixtures.push({ key: 'plain-metadata', title: 'Plain text · UUID and timestamp accents', language: 'text',
          themeName, themeLabel, palette, kind: 'plain-metadata', group: 'structured', cols: 126,
          rows: plainLines.length + 1, source: plainSource,
          ansi: plainLines.map(line => line + '\x1b[0m').join('\r\n') });
        const cards = [
          ['markdown-known', 'Recognized language · Java', '```java\npublic class Example {\n    String name = "hello";\n}\n```', false],
          ['markdown-unknown', 'Unknown language · plain code', '```custom-dsl\npublic class hello = "value"\nuse your_own_syntax here\n```', false],
          ['markdown-streaming', 'Still generating · stable code card', '```javascript\nexport function greet(name) {\n  const message = "Hello, " + name;', true],
          ['markdown-narrative', 'Conversation stays transparent', 'Normal conversation stays unboxed.\n\n```yaml\nservice:\n  name: "hello"\n  enabled: true\n```\n\nOnly the code gets a gray card.', false],
        ];
        for (const [kind, title, source, streaming] of cards) {
          const markdown = new tui.Markdown(source, 0, 0, sdk.getMarkdownTheme(), undefined, {
            transform: (text, availableWidth) => registration.transformer(text, {
              messageType: 'assistant', isStreaming: streaming, availableWidth,
            }),
          });
          const lines = markdown.render(62);
          fixtures.push({ key: kind, title, language: 'text', themeName, themeLabel, palette,
            kind, group: 'cards', cols: 62, rows: lines.length + 1, source,
            ansi: lines.map(line => line + '\x1b[0m').join('\r\n') });
        }
        for (const [language, title, path, content] of samples) add(path, title, language, 'write', { path, content }, 'code', 'languages');
        add('language-failure', 'Error state · foreground only', 'bash', 'bash', { command: 'printf "demo"' }, 'failure', 'languages');
        add('native-before', 'Native Pi preview', 'python', 'bash', { command: remoteShell }, 'before', 'comparison', 62, true);
        add('enhanced-after', 'With this plugin', 'python', 'bash', { command: remoteShell }, 'after', 'comparison');
      }
    }
    return fixtures;
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
}

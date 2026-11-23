import { mkdtemp, mkdir, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadPiSdk } from '../scripts/pi-sdk.mjs';

const remoteShell = "ssh demo-host 'bash -s' <<'REMOTE'\nset -eu\n\npython3 - <<'PY'\nfrom pathlib import Path\n\nname = \"hello\"\nif name:\n    print(name)\nPY\nREMOTE";
const moduleScript = "node --input-type=module <<'JS'\nconst items = [\"one\", \"two\"];\n\nfor (const item of items) {\n  console.log(item);\n}\nJS";
const failureScript = "node --input-type=module <<'JS'\nthrow new Error(\"Demo failure\");\nJS";
const samples = [
  ['javascript', 'JavaScript · .mjs / .js', 'example.mjs', 'export function greet(name) {\n  const message = "Hello, " + name;\n  return message;\n}\n'],
  ['typescript', 'TypeScript · .ts', 'example.ts', 'type User = { name: string };\n\nexport function greet(user: User): string {\n  return "Hello, " + user.name;\n}\n'],
  ['python', 'Python · .py', 'example.py', '# Readable comments, keywords and strings\ndef greet(name, retries=3):\n    if retries > 0:\n        return "Hello, " + name\n    return None\n'],
  ['yaml', 'YAML · .yaml / .yml', 'example.yaml', '# Configuration preview\nservice:\n  name: "hello"\n  enabled: true\n  retries: 3\n'],
  ['java', 'Java · .java', 'Example.java', 'public class Example {\n    private final String name = "hello";\n\n    public String greet() {\n        return name;\n    }\n}\n'],
  ['json', 'JSON · .json', 'example.json', '{\n  "name": "hello",\n  "enabled": true,\n  "retries": 3\n}\n'],
  ['bash', 'Shell · .sh', 'example.sh', '# Keep scripts readable\nfor name in one two; do\n  printf "Hello, %s\\n" "$name"\ndone\n'],
];

export async function buildFixtures() {
  process.env.COLORTERM = 'truecolor';
  process.env.TERM = 'xterm-256color';
  const previous = process.env.PI_CODING_AGENT_DIR;
  const dir = await mkdtemp(join(tmpdir(), 'pi-visual-demo-'));
  process.env.PI_CODING_AGENT_DIR = dir;
  try {
    const { sdk, tui } = await loadPiSdk();
    const themeNames = ['jetbrains-dark-transparent', 'darcula-transparent'];
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
      const modern = themeName.startsWith('jetbrains');
      const themeLabel = modern ? 'JetBrains Dark Transparent' : 'Darcula Transparent';
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
      add('node-module', 'Node.js module script', 'javascript', 'bash', { command: moduleScript });
      add('failure', 'Failure indicator · no red panel', 'bash', 'bash', { command: failureScript }, 'failure', 'overview', 126);
      if (modern) {
        const registration = loaded.extensions.find(e => e.path === extensionPath).markdownTransformer;
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

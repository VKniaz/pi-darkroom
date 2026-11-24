import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadPiSdk } from '../scripts/pi-sdk.mjs';

process.env.COLORTERM = 'truecolor';
process.env.TERM = 'xterm-256color';

export async function createHarness({ seed = {} } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'pi-darkroom-harness-'));
  for (const [name, content] of Object.entries(seed)) await writeFile(join(dir, name), content);
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  const { sdk, tui, nativeThemePath } = await loadPiSdk();
  await mkdir(join(dir, 'themes'));
  await mkdir(join(dir, 'themes-src'));
  for (const name of ['darkroom-dark']) {
    const json = await readFile(fileURLToPath(new URL(`../themes/${name}.json`, import.meta.url)), 'utf8');
    await writeFile(join(dir, 'themes', name + '.json'), json);
  }
  const light = JSON.parse(await readFile(nativeThemePath.replace('dark.json', 'light.json'), 'utf8'));
  await writeFile(join(dir, 'themes', 'preview-light.json'), JSON.stringify({ ...light, name: 'preview-light' }));
  const extensionPath = fileURLToPath(new URL('../index.ts', import.meta.url));
  const loader = new sdk.DefaultResourceLoader({
    cwd: dir, agentDir: dir, noExtensions: true, noSkills: true, noPromptTemplates: true,
    additionalExtensionPaths: [extensionPath],
  });
  await loader.reload({ resolveProjectTrust: async () => false });
  const loaded = loader.getExtensions();
  if (loaded.errors.length) throw new Error(JSON.stringify(loaded.errors));
  const extension = loaded.extensions.find(e => e.path === extensionPath);
  let active;
  for (const handler of extension.handlers.get('session_start') ?? []) {
    await handler({ reason: 'startup' }, { mode: 'tui', ui: { get theme() { return active; } } });
  }
  const themes = loader.getThemes().themes;
  return {
    dir, sdk, tui, extension,
    theme(name = 'darkroom-dark') {
      sdk.initTheme(name, false);
      active = themes.find(t => t.name === name);
      return active;
    },
    resolve(tool, definition) { return extension.toolRenderers[0](tool, () => definition); },
    context(args, overrides = {}) {
      return {
        args, toolCallId: 'harness', invalidate() {}, lastComponent: undefined, state: {}, cwd: dir,
        executionStarted: true, argsComplete: true, isPartial: false, expanded: false,
        showImages: false, isError: false, durationMs: 120, outputPad: 0,
        keyText: () => 'ctrl+o', keyHint: (_id, text) => 'ctrl+o ' + text, ...overrides,
      };
    },
    async close() {
      if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
      await rm(dir, { recursive: true, force: true });
    },
  };
}

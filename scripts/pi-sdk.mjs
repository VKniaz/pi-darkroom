import { readFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function loadPiSdk() {
  const entry = realpathSync(execFileSync('which', ['pi'], { encoding: 'utf8' }).trim());
  const sdkPath = join(dirname(entry), 'index.js');
  const sdk = await import(pathToFileURL(sdkPath).href);
  // Match InteractiveMode.init(): headless SDK imports alone omit deferred grammars such as YAML.
  const sharedPaths = new Set([...(await readFile(sdkPath, 'utf8')).matchAll(/\bfrom\s*["'](\.\/chunks\/[^"']+)["']/g)].map(match => match[1]));
  let ready = false;
  for (const path of sharedPaths) {
    const shared = await import(new URL(path, pathToFileURL(sdkPath)).href);
    if (typeof shared.loadAllHighlightLanguages !== 'function') continue;
    await shared.loadAllHighlightLanguages();
    ready = true;
    break;
  }
  if (!ready) throw new Error('Cannot initialize the installed Pi TUI syntax grammars');
  const tui = await import(pathToFileURL(createRequire(entry).resolve('@earendil-works/pi-tui')).href);
  return { sdk, tui, entry, sdkPath, nativeThemePath: join(dirname(entry), '../modes/interactive/theme/dark.json') };
}

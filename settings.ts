import { getAgentDir } from '@earendil-works/pi-coding-agent';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

export type PluginSettings = { compactTools: boolean };
const DEFAULTS: PluginSettings = { compactTools: false };
const file = () => join(getAgentDir(), 'pi-darkroom.json');
// Read once so users of the previous package name keep their choice; saving always writes the new file.
const previousFile = () => join(getAgentDir(), 'pi-jetbrains-transparent.json');

export function loadSettings(): PluginSettings {
  for (const path of [file(), previousFile()]) {
    try {
      const saved = JSON.parse(readFileSync(path, 'utf8'));
      return { compactTools: saved?.compactTools === true };
    } catch {
      // Missing or unreadable: try the next location, then use defaults.
    }
  }
  return { ...DEFAULTS };
}

export function saveSettings(settings: PluginSettings) {
  const pending = file() + '.pending';
  writeFileSync(pending, JSON.stringify(settings, null, 2) + '\n');
  renameSync(pending, file());
}

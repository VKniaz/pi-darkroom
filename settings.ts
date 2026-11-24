import { getAgentDir } from '@earendil-works/pi-coding-agent';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

export type PluginSettings = { compactTools: boolean };
const DEFAULTS: PluginSettings = { compactTools: false };
const file = () => join(getAgentDir(), 'pi-jetbrains-transparent.json');

export function loadSettings(): PluginSettings {
  try {
    const saved = JSON.parse(readFileSync(file(), 'utf8'));
    return { compactTools: saved?.compactTools === true };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings: PluginSettings) {
  const pending = file() + '.pending';
  writeFileSync(pending, JSON.stringify(settings, null, 2) + '\n');
  renameSync(pending, file());
}

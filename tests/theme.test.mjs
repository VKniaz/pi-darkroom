import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadPiSdk } from '../scripts/pi-sdk.mjs';

process.env.COLORTERM = 'truecolor';
const dir = await mkdtemp(join(tmpdir(), 'pi-darkroom-theme-'));
after(() => rm(dir, { recursive: true, force: true }));
const { sdk, tui } = await loadPiSdk();
await mkdir(join(dir, 'themes'));
for (const name of ['darkroom-dark', 'darkroom-classic']) {
  await copyFile(fileURLToPath(new URL(`../themes/${name}.json`, import.meta.url)), join(dir, 'themes', name + '.json'));
}
const loader = new sdk.DefaultResourceLoader({ cwd: dir, agentDir: dir, noExtensions: true, noSkills: true, noPromptTemplates: true });
await loader.reload({ resolveProjectTrust: async () => false });
const luminance = color => {
  const { r, g, b } = tui.colorToRgb(color);
  return [r, g, b].map(v => v / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
};

for (const [name, background] of [['darkroom-dark', '#1e1f22'], ['darkroom-classic', '#2b2b2b']]) {
  const theme = () => loader.getThemes().themes.find(t => t.name === name);

  test(`${name}: your messages reuse the existing link blue, distinct from reply text`, () => {
    assert.equal(theme().getFgAnsi('userMessageText'), theme().getFgAnsi('mdLink'));
    assert.notEqual(theme().getFgAnsi('userMessageText'), theme().getFgAnsi('text'));
  });

  test(`${name}: reasoning stays dimmer than replies and readable`, () => {
    const text = luminance(theme().colors.text), thinking = luminance(theme().colors.thinkingText);
    const bg = luminance(tui.parseColor(background));
    assert.ok(thinking < text * 0.6);
    assert.ok((thinking + 0.05) / (bg + 0.05) >= 3);
  });
}

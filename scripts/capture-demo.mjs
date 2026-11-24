import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, extname, sep, join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { buildFixtures } from '../examples/fixtures.mjs';

// Before/after demo GIF from native Pi components: same synthetic edit and command, plain Pi vs pi-darkroom.
const root = resolve('.');
const fixtures = (await buildFixtures()).filter(f => f.themeName === 'darkroom-dark');
const only = predicate => {
  const found = fixtures.filter(predicate);
  assert.equal(found.length, 1);
  return found[0];
};
const scene = (title, subtitle, predicate, cardTitle) => [title, subtitle, { ...only(predicate), title: cardTitle, cols: 110 }];
const scenes = [
  scene('Plain Pi', 'Edit diffs are colored only by +/−.', f => f.kind === 'native-diff', 'Plain Pi · edit diff'),
  scene('With pi-darkroom', 'Syntax colors, tinted lines and the changed part highlighted.', f => f.kind === 'demo-diff', 'pi-darkroom · edit diff'),
  scene('Plain Pi', 'Commands and embedded scripts render in one flat color.', f => f.kind === 'before', 'Plain Pi · command'),
  scene('With pi-darkroom', 'Command names, strings and embedded Python each get their own color.', f => f.kind === 'after', 'pi-darkroom · command'),
];

const mime = { '.html': 'text/html', '.css': 'text/css', '.mjs': 'application/javascript', '.js': 'application/javascript', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const file = pathname === '/' ? resolve(root, 'examples/gallery.html') : resolve(root, '.' + decodeURIComponent(pathname));
  if (!file.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
  try { res.setHeader('content-type', mime[extname(file)] ?? 'application/octet-stream'); res.end(await readFile(file)); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const frames = await mkdtemp(join(tmpdir(), 'pi-darkroom-demo-'));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--disable-background-networking'] });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
  await page.goto(origin);
  await page.waitForFunction(() => window.galleryReady === true);
  await page.addStyleTag({ content: 'footer{display:none} main{padding:30px 38px}' });
  for (const [index, [title, subtitle, fixture]] of scenes.entries()) {
    await page.evaluate(data => window.showFixtures(data), { title, subtitle, fixtures: [fixture] });
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.evaluate(() => window.refreshFixtures());
    await page.waitForFunction(() => window.paintCount === window.cardCount, undefined, { timeout: 2000 });
    await page.screenshot({ path: join(frames, `scene-${index}.png`), clip: { x: 0, y: 0, width: 1200, height: 900 } });
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  await new Promise(r => server.close(r));
}
await mkdir('docs/screenshots', { recursive: true });
const inputs = scenes.flatMap((_, i) => ['-loop', '1', '-t', '2.6', '-i', join(frames, `scene-${i}.png`)]);
const fades = scenes.slice(1).map((_, i) => {
  const from = i === 0 ? '[0]' : `[v${i}]`;
  return `${from}[${i + 1}]xfade=transition=fade:duration=0.45:offset=${(2.15 * (i + 1)).toFixed(2)}[v${i + 1}]`;
});
const last = `[v${scenes.length - 1}]`;
const filter = `${fades.join(';')};${last}fps=12,scale=900:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=sierra2_4a`;
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', filter, '-loop', '0', 'docs/screenshots/demo.gif']);
await rm(frames, { recursive: true, force: true });
console.log('PASS: demo.gif written from', scenes.length, 'native-component scenes; no page errors.');

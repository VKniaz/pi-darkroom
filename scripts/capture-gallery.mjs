import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';
import { buildFixtures } from '../examples/fixtures.mjs';

const root = resolve('.');
const fixtures = await buildFixtures();
const mime = { '.html': 'text/html', '.css': 'text/css', '.mjs': 'application/javascript', '.js': 'application/javascript', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const file = pathname === '/' ? resolve(root, 'examples/gallery.html') : resolve(root, '.' + decodeURIComponent(pathname));
  if (!file.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
  try { res.setHeader('content-type', mime[extname(file)] ?? 'application/octet-stream'); res.end(await readFile(file)); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--disable-background-networking'] });
const failures = [];
const manifest = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => failures.push(error.message));
  await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
  await page.goto(origin);
  await page.waitForFunction(() => window.galleryReady === true);
  const groups = [
    ['dark-overview.png', 'Darkroom Dark, without the noise.', 'Transparent conversation. Gray code cards. Syntax colors without noisy error panels.', fixtures.filter(f => f.group === 'overview' && f.themeName === 'darkroom-dark')],
    ['classic-overview.png', 'Darkroom Classic. Quiet code cards.', 'Warm keywords, green strings and readable code — with the native execution path untouched.', fixtures.filter(f => f.group === 'overview' && f.themeName === 'darkroom-classic')],
    ['language-gallery.png', 'One palette. Many languages.', 'Native filename-based highlighting, plus readable command and embedded-script previews.', fixtures.filter(f => f.group === 'languages')],
    ['code-cards.png', 'Code gets structure. Chat stays clear.', 'Recognized code is colored. Unknown code stays plain. Generating code keeps the same calm background.', fixtures.filter(f => f.group === 'cards')],
    ['diff-cards.png', 'Diffs you can actually read.', 'Language colors inside edits, tinted added/removed lines, emphasized changes — plus optional one-line tool rows.', fixtures.filter(f => f.group === 'diffs')],
    ['plain-text.png', 'Readable text. Important details stand out.', 'Brighter plain text with UUID and formatted timestamp accents. Synthetic data only.', fixtures.filter(f => f.group === 'structured')],
    ['before-after.png', 'Same command. Clearer preview.', 'The exact same synthetic SSH command, rendered with native Pi and with the plugin. Nothing executed.', fixtures.filter(f => f.group === 'comparison')],
  ];
  await mkdir('docs/screenshots', { recursive: true });
  for (const [file, title, subtitle, selected] of groups) {
    await page.evaluate(data => window.showFixtures(data), { title, subtitle, fixtures: selected });
    const contentHeight = await page.locator('main').evaluate(el => Math.ceil(el.getBoundingClientRect().height));
    // xterm pauses offscreen canvases; make every tile visible before requiring a real paint.
    await page.setViewportSize({ width: 1440, height: contentHeight });
    await page.evaluate(() => window.refreshFixtures());
    await page.waitForFunction(() => window.paintCount === window.cardCount, undefined, { timeout: 1000 });
    assert.equal(await page.locator('.xterm-screen').count(), selected.length);
    assert.ok(await page.evaluate(() => document.fonts.check('16px "JetBrains Mono"')));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const overflows = await page.locator('.term').evaluateAll(elements => elements.filter(el => el.scrollWidth > el.clientWidth + 1).length);
    assert.equal(overflows, 0, 'Terminal preview must not be horizontally clipped');
    await page.screenshot({ path: 'docs/screenshots/' + file, fullPage: true });
    const size = await page.evaluate(() => ({ width: innerWidth, height: document.documentElement.scrollHeight }));
    manifest.push({ file, ...size, themes: [...new Set(selected.map(f => f.themeName))], synthetic: true, renderer: 'Native Pi components in xterm.js', font: 'JetBrains Mono' });
    if (file === 'dark-overview.png') await page.locator('.card.failure').screenshot({ path: 'docs/screenshots/failure-state.png' });
  }
  assert.deepEqual(failures, []);
  await writeFile('docs/screenshots/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
  console.log('PASS: native component galleries captured, font loaded, no page errors or horizontal clipping.');
  console.log(manifest.map(item => `${item.file}: ${item.width}x${item.height}`).join('\n'));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}

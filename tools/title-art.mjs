// Renders the title screen's artwork (tools/title-art.html) to art/title-wide.jpg and
// art/title-tall.jpg. Needs Playwright with Chromium: node tools/title-art.mjs, or with
// PLAYWRIGHT=/path/to/playwright/index.mjs if it isn't installed in this project.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer(async (req, res) => {
  try {
    const path = join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!path.startsWith(root)) throw new Error('outside');
    res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream' });
    res.end(await readFile(path));
  } catch {
    res.writeHead(404);
    res.end();
  }
}).listen(0);
const port = server.address().port;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const [shot, w, h] of [['wide', 1920, 1080], ['tall', 1080, 1920]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on('pageerror', (e) => console.error(e.message));
  await page.goto(`http://localhost:${port}/tools/title-art.html?shot=${shot}&w=${w}&h=${h}`);
  await page.waitForFunction(() => window.done, null, { timeout: 300000 });
  await page.screenshot({ path: join(root, `art/title-${shot}.jpg`), type: 'jpeg', quality: 86 });
  console.log(`art/title-${shot}.jpg`);
  await page.close();
}
await browser.close();
server.close();

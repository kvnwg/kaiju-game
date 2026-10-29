// Renders the store covers (tools/cover-art.html) to store/covers/: 1920x1080, 800x1200 and
// 800x800, the sizes CrazyGames asks for, plus the preview videos' opening frames (1920x1080 and
// 1080x1620) to store/video/. Needs Playwright with Chromium: node tools/cover-art.mjs, or with
// PLAYWRIGHT=/path/to/playwright/index.mjs if it isn't installed in this project.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
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
await mkdir(join(root, 'store/covers'), { recursive: true });
await mkdir(join(root, 'store/video'), { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const jobs = [
  ['wide', 1920, 1080, 'store/covers/cover-1920x1080.png'],
  ['tall', 800, 1200, 'store/covers/cover-800x1200.png'],
  ['square', 800, 800, 'store/covers/cover-800x800.png'],
  ['wide', 1920, 1080, 'store/video/cover-1920x1080.png'],
  ['tall', 1080, 1620, 'store/video/cover-1080x1620.png'],
];
for (const [shot, w, h, out] of jobs) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on('pageerror', (e) => console.error(e.message));
  await page.goto(`http://localhost:${port}/tools/cover-art.html?shot=${shot}&w=${w}&h=${h}`);
  await page.waitForFunction(() => window.done, null, { timeout: 300000 });
  await page.screenshot({ path: join(root, out) });
  console.log(out);
  await page.close();
}
await browser.close();
server.close();

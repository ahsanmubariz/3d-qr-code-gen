import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
};

const server = http.createServer((req, res) => {
  let reqPath = req.url?.split('?')[0] || '/';
  if (reqPath === '/') reqPath = '/test/runner.html';
  const filePath = path.join(rootDir, reqPath);
  if (!fs.existsSync(filePath)) { res.writeHead(404); return res.end('Not Found'); }
  const ext = path.extname(filePath);
  res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
  fs.createReadStream(filePath).pipe(res);
});

async function run() {
  await new Promise(r => server.listen(9002, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 800, height: 800 } });
  
  page.on('console', msg => console.log('BROWSER LOG:', msg.type(), msg.text()));
  page.on('pageerror', err => console.error('BROWSER ERROR:', err));

  await page.goto('http://localhost:9002/test/runner.html?url=https%3A%2F%2Fgithub.com&season=spring');
  await page.waitForTimeout(1000);

  const rect = await page.evaluate(() => {
    const el = document.querySelector('qr-tree');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const canvas = el.shadowRoot?.querySelector('canvas');
    return {
      elWidth: r.width,
      elHeight: r.height,
      canvasWidth: canvas?.width,
      canvasHeight: canvas?.height,
      hasShadow: !!el.shadowRoot,
    };
  });
  console.log('DOM Rect & Canvas:', rect);

  await page.screenshot({ path: path.join(__dirname, 'page-debug.png') });
  console.log('Saved page-debug.png');

  await browser.close();
  server.close();
}
run().catch(console.error);

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import jsQR from 'jsqr';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

// 1. Simple static file server for root directory
const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.ts': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
};

const server = http.createServer((req, res) => {
  let reqPath = req.url?.split('?')[0] || '/';
  if (reqPath === '/') reqPath = '/test/runner.html';
  const filePath = path.join(rootDir, reqPath);

  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }

  const ext = path.extname(filePath);
  const contentType = mimeTypes[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType });
  fs.createReadStream(filePath).pipe(res);
});

async function run() {
  await new Promise((resolve) => server.listen(8999, resolve));
  console.log('Test server listening on http://localhost:8999');

  const chromePath = fs.existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined;
  const browser = await chromium.launch({
    executablePath: chromePath,
    args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 800, height: 800 } });

  const testCases = [
    { url: 'https://github.com', season: 'core-blue' },
    { url: 'https://tree.icqr.com', season: 'hitech-violet' },
    { url: 'https://example.com/test?a=123', season: 'legacy-purple' },
    { url: 'https://delightful-tree.example.org', season: 'soft-purple' },
  ];

  let passed = 0;
  for (const tc of testCases) {
    console.log(`\nTesting URL: ${tc.url} (${tc.season})...`);
    await page.goto(`http://localhost:8999/test/runner.html?url=${encodeURIComponent(tc.url)}&season=${tc.season}`);

    // Wait for the qr-tree component and render
    await page.waitForFunction(() => {
      const el = document.querySelector('qr-tree');
      return el && el.shadowRoot && el.shadowRoot.querySelector('canvas');
    });

    // Wait 500ms for stable frame
    await page.waitForTimeout(600);

    // Extract pixels via el.toPNG()
    const imgData = await page.evaluate(async () => {
      const el = document.querySelector('qr-tree');
      const dataUrl = el.toPNG();
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      const cvs = document.createElement('canvas');
      cvs.width = img.width;
      cvs.height = img.height;
      const ctx = cvs.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const idata = ctx.getImageData(0, 0, img.width, img.height);
      return {
        data: Array.from(idata.data),
        width: idata.width,
        height: idata.height,
      };
    });

    const uint8 = new Uint8ClampedArray(imgData.data);
    const code = jsQR(uint8, imgData.width, imgData.height);

    if (code && code.data === tc.url) {
      console.log(`✅ Scanned successfully! Decoded payload: "${code.data}"`);
      passed++;
    } else {
      console.error(`❌ Scan failed for ${tc.url}. Decoded: ${code ? `"${code.data}"` : 'null'}`);
      const rawUrl = await page.evaluate(() => document.querySelector('qr-tree').toPNG());
      const base64Data = rawUrl.replace(/^data:image\/png;base64,/, '');
      fs.writeFileSync(path.join(rootDir, 'test', 'failed_case.png'), base64Data, 'base64');
      console.log('Saved failed image to test/failed_case.png');
    }
  }

  await browser.close();
  server.close();

  if (passed === testCases.length) {
    console.log(`\n🎉 All ${passed}/${testCases.length} scan tests passed! The 3D QR tree is fully scannable.`);
    process.exit(0);
  } else {
    console.error(`\n❌ Tests failed: ${passed}/${testCases.length} passed.`);
    process.exit(1);
  }
}

run().catch((err) => {
  console.error(err);
  server.close();
  process.exit(1);
});

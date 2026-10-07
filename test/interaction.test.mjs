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
  '.ts': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
};

const server = http.createServer((req, res) => {
  let reqPath = req.url?.split('?')[0] || '/';
  if (reqPath === '/') reqPath = '/index.html';
  if (reqPath.endsWith('src/index.ts')) reqPath = '/dist/qr-tree.js';
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
  await new Promise((resolve) => server.listen(9001, resolve));
  console.log('Interaction test server listening on http://localhost:9001');

  const chromePath = fs.existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined;
  const browser = await chromium.launch({
    executablePath: chromePath,
    args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  await page.goto('http://localhost:9001/index.html');

  // 1. Verify buttons are NOT visible
  const buttonsHidden = await page.evaluate(() => {
    const demoButtons = Array.from(document.querySelectorAll('button')).filter((b) => {
      const text = b.textContent?.toLowerCase() || '';
      return text.includes('spin') || text.includes('qr') || text.includes('toggle');
    });
    const qrEl = document.querySelector('qr-tree');
    const toggleBtn = qrEl?.shadowRoot?.querySelector('button.toggle');
    const toggleStyle = toggleBtn ? window.getComputedStyle(toggleBtn).display : 'none';

    return {
      demoButtonsCount: demoButtons.length,
      shadowToggleHidden: toggleStyle === 'none',
    };
  });

  console.log('UI Buttons check:', buttonsHidden);
  if (buttonsHidden.demoButtonsCount > 0 || !buttonsHidden.shadowToggleHidden) {
    throw new Error('Buttons that should be hidden are visible!');
  }
  console.log('✅ "I see QR" and "Spin Tree" buttons are completely hidden.');

  await page.waitForSelector('qr-tree');
  await page.waitForTimeout(500);

  // 2. Test click on the tree canvas
  const canvasBox = await page.evaluate(() => {
    const el = document.querySelector('qr-tree');
    const canvas = el.shadowRoot.querySelector('canvas');
    const rect = canvas.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });

  console.log('Clicking on tree canvas...');
  await page.mouse.click(canvasBox.x, canvasBox.y);
  await page.waitForTimeout(800);

  const afterClick = await page.evaluate(() => {
    const el = document.querySelector('qr-tree');
    return {
      hasShowQr: el.hasAttribute('show-qr'),
      hasAutorotate: el.hasAttribute('autorotate'),
    };
  });
  console.log('After click state:', afterClick);
  if (!afterClick.hasShowQr || afterClick.hasAutorotate) {
    throw new Error('Click did not transition to QR mode and stop spinning!');
  }
  console.log('✅ Clicking tree toggled to QR code mode and stopped spinning.');

  // Click again to return to 3D tree mode
  console.log('Clicking again on tree canvas...');
  await page.mouse.click(canvasBox.x, canvasBox.y);
  await page.waitForTimeout(800);

  const afterSecondClick = await page.evaluate(() => {
    const el = document.querySelector('qr-tree');
    return {
      hasShowQr: el.hasAttribute('show-qr'),
    };
  });
  console.log('After 2nd click state:', afterSecondClick);
  if (afterSecondClick.hasShowQr) {
    throw new Error('Second click did not return to 3D mode!');
  }
  console.log('✅ Clicking tree again returned to 3D tree mode.');

  // 3. Test dragging viewfinder to top view:
  // OrbitControls: pulling canvas down tilts camera into top view (polar angle decreases)
  console.log('Dragging viewfinder towards top view...');
  // Record the perspective camera's view direction + eased transition progress every frame,
  // to catch camera jumps (big turn in a frame where the transition barely advanced)
  await page.evaluate(() => {
    const scene = document.querySelector('qr-tree').scene;
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    window.__dirs = [];
    const rec = () => {
      const e = scene.persp.matrixWorld.elements;
      window.__dirs.push([-e[8], -e[9], -e[10], ease(scene.qrT)]);
      if (window.__dirs.length < 1000) requestAnimationFrame(rec);
    };
    requestAnimationFrame(rec);
  });
  await page.mouse.move(canvasBox.x, canvasBox.y - 80);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x, canvasBox.y + 160, { steps: 25 });
  await page.mouse.up();
  await page.waitForTimeout(1500);

  const maxJump = await page.evaluate(() => {
    let max = 0;
    for (let i = 1; i < window.__dirs.length; i++) {
      const [a, b] = [window.__dirs[i - 1], window.__dirs[i]];
      const dot = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / Math.hypot(a[0], a[1], a[2]) / Math.hypot(b[0], b[1], b[2]);
      // A full transition turns the camera ~1 rad, so allow ~1.2 rad per unit of eased progress
      const allowed = 1.2 * Math.abs(b[3] - a[3]);
      max = Math.max(max, Math.acos(Math.min(1, dot)) - allowed);
    }
    return max;
  });
  console.log('Max unexplained per-frame camera turn (rad):', maxJump.toFixed(3));
  if (maxJump > 0.1) {
    throw new Error(`Camera jumped ${maxJump.toFixed(3)} rad in a single frame during drag-to-QR!`);
  }

  const afterDragTop = await page.evaluate(() => {
    const el = document.querySelector('qr-tree');
    return {
      hasShowQr: el.hasAttribute('show-qr'),
    };
  });
  console.log('After drag to top view state:', afterDragTop);
  if (!afterDragTop.hasShowQr) {
    throw new Error('Dragging to top view did not automatically switch to QR mode!');
  }
  console.log('✅ Dragging viewfinder to top view automatically entered QR mode.');

  // 4. Test dragging viewfinder back down to side view:
  // Dragging in QR mode immediately returns to 3D tree
  console.log('Dragging viewfinder to return to 3D side view...');
  await page.mouse.move(canvasBox.x, canvasBox.y + 80);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x, canvasBox.y - 60, { steps: 15 });
  await page.mouse.up();
  await page.waitForTimeout(600);

  const afterDragDown = await page.evaluate(() => {
    const el = document.querySelector('qr-tree');
    return {
      hasShowQr: el.hasAttribute('show-qr'),
    };
  });
  console.log('After drag down state:', afterDragDown);
  if (afterDragDown.hasShowQr) {
    throw new Error('Dragging back down did not return to 3D tree mode!');
  }
  console.log('Testing Download HTML button...');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#download-html-btn'),
  ]);
  const downloadPath = await download.path();
  const downloadedContent = fs.readFileSync(downloadPath, 'utf-8');
  console.log('Downloaded HTML filename:', download.suggestedFilename());
  if (!download.suggestedFilename().endsWith('.html') || !downloadedContent.includes('<qr-tree')) {
    throw new Error('Downloaded HTML does not contain expected standalone qr-tree markup!');
  }
  console.log('✅ Download HTML button downloads valid plain HTML.');

  // 5. Verify opening the downloaded file directly via file:// URL without any CORS errors
  console.log('Testing opening downloaded file via file:/// URL...');
  const filePage = await browser.newPage({ viewport: { width: 800, height: 800 } });
  const pageErrors = [];
  filePage.on('pageerror', (err) => pageErrors.push(err.message));
  filePage.on('console', (msg) => {
    if (msg.type() === 'error') pageErrors.push(msg.text());
  });

  // Save to an explicit .html file in /tmp so browser recognizes the extension
  const testHtmlPath = path.join(rootDir, 'test', 'downloaded_test.html');
  fs.writeFileSync(testHtmlPath, downloadedContent, 'utf-8');

  await filePage.goto(`file://${testHtmlPath}`);
  await filePage.waitForFunction(() => {
    const el = document.querySelector('qr-tree');
    return el && el.shadowRoot && el.shadowRoot.querySelector('canvas');
  });
  await filePage.waitForTimeout(500);

  console.log('file:/// page errors:', pageErrors);
  if (pageErrors.some((e) => e.includes('CORS') || e.includes('blocked') || e.includes('Failed to load'))) {
    throw new Error(`file:/// load encountered CORS or script errors: ${pageErrors.join('; ')}`);
  }
  console.log('✅ Downloaded HTML loaded completely cleanly via file:/// with ZERO CORS or network errors!');

  await filePage.close();
  await browser.close();
  server.close();
  console.log('\n🎉 ALL INTERACTION TESTS PASSED PERFECTLY!');
}

run().catch((err) => {
  console.error('❌ Interaction test failed:', err);
  server.close();
  process.exit(1);
});

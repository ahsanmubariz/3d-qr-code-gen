# 🌲 QR Tree (`<qr-tree>`)

An embeddable 3D procedural tree that doubles as a scannable QR code, inspired by [tree.icqr.com](https://tree.icqr.com/).

Built with **Three.js (WebGL)** and wrapped as a **Custom Element (Web Component)**, so it drops into any website or frontend stack (plain HTML, React, Vue, Next.js, Astro, WordPress, …). The bundle is a single self-contained ES module (`dist/qr-tree.js`) with no runtime dependencies.

---

## 🕹️ Interaction

| Gesture | 3D tree view | QR view |
|---------|--------------|---------|
| Click / tap | Switch to QR view | Switch to 3D tree |
| Drag down (a little or a lot) | Tilt up over the tree → QR view | Back to 3D tree |
| Drag sideways | Orbit around the tree | Back to 3D tree |
| Camera ends up over the tree | Switches to QR view | — |

The transition is a smooth dolly-zoom from the current camera angle into a flat, top-down orthographic view that phone cameras can scan.

---

## 🚀 Quick Start

### 1. Plain HTML / static website

```html
<!-- Load the script once (or self-host dist/qr-tree.js, see "Deploy to Cloudflare Pages") -->
<script type="module" src="https://3d-qr-gen.pages.dev/dist/qr-tree.js"></script>

<qr-tree data="https://your-website.com" scheme="core-blue" autorotate></qr-tree>
```

The demo site ([3d-qr-gen.pages.dev](https://3d-qr-gen.pages.dev/)) has an **Embed on your website** panel that generates this snippet for your URL and colour scheme, with a copy button.

The element is square by default (`aspect-ratio: 1 / 1`); size it with CSS `width`.

### 2. React / Next.js

Copy `dist/qr-tree.js` into your project (e.g. `src/vendor/qr-tree.js`) and import it on the client:

```tsx
import { useEffect } from 'react';

export default function QrTree() {
  useEffect(() => {
    import('./vendor/qr-tree.js'); // registers <qr-tree> (browser only)
  }, []);

  return (
    <div style={{ width: 400 }}>
      {/* @ts-ignore custom element */}
      <qr-tree data="https://your-website.com" scheme="hitech-violet" autorotate />
    </div>
  );
}
```

### 3. Vue 3

```vue
<script setup>
import './vendor/qr-tree.js';
</script>

<template>
  <qr-tree data="https://your-website.com" scheme="legacy-purple" autorotate />
</template>
```

(Tell Vue it's a custom element: `compilerOptions.isCustomElement = (tag) => tag === 'qr-tree'`.)

---

## ⚙️ Attributes

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `data` | `string` | current origin | URL or text encoded in the QR code (up to QR version 6, 41×41 modules). |
| `scheme` | `'core-blue' \| 'hitech-violet' \| 'legacy-purple' \| 'soft-purple'` | `'core-blue'` | Brand colour scheme. `season` is accepted as an alias. |
| `color` | `#hex` | — | Custom leaf colour override (e.g. `#8a2be2`); generates harmonious foliage. |
| `background` | `#hex` | `#f6f1e7` | Background colour, to match the surrounding page. |
| `ecc` | `'L' \| 'M' \| 'Q' \| 'H'` | `'M'` | QR error-correction level (M ≈ 15% recovery, recommended). |
| `autorotate` | `boolean` | off | Slowly orbits the camera in 3D view (stops when switching to QR). |
| `show-qr` | `boolean` | off | Shows the top-down scannable QR view; reflects the current mode. |
| `no-orbit` | `boolean` | off | Disables drag-to-orbit. |

Respects `prefers-reduced-motion` (no sway, no animated transitions).

---

## 🧩 JavaScript API & Events

```js
const tree = document.querySelector('qr-tree');

tree.toggleQr();
tree.showQr(true);                    // true = QR view, false = 3D tree
tree.showQr(true, { instant: true }); // skip the transition
console.log(tree.qrMode);             // boolean

const pngDataUrl = tree.toPNG();      // snapshot of the current view (use QR view for a scannable image)

tree.addEventListener('qr-ready', (e) => console.log('Encoded:', e.detail.data));
tree.addEventListener('qr-mode-change', (e) => console.log('QR mode:', e.detail.qr));
tree.addEventListener('qr-error', (e) => console.error(e.detail.message));
```

---

## 🔬 How It Works

1. **Voxel grid alignment:** the ground platform is a grid where each cell maps 1:1 to a QR module.
2. **Top-down canopy projection:** leaf voxels are stacked only above dark modules inside the canopy radius. Seen straight from above with an orthographic camera, leaves form the dark modules and the pale ground forms the light ones.
3. **Finder-pattern fringe:** dark modules outside the canopy (including the corner finder squares) sprout grass, defining the scan targets.
4. **Error correction:** Reed–Solomon error correction (level M by default) tolerates leaf jitter and branch volume.
5. **WebGL everywhere:** Three.js WebGL runs on all modern desktop and mobile browsers.

---

## 🧪 Development

```bash
npm install          # install dependencies
npm run dev          # demo at http://localhost:5173 (with "Download HTML" export)
npm run build        # library bundle → dist/qr-tree.js
npm run build:site   # static demo site → site/ (for Cloudflare Pages or any static host)
npm test             # build, then Playwright: QR scan verification (jsQR) + gesture/interaction tests
```

The demo's **Download HTML** button produces a single standalone `.html` file with the bundle inlined, which works offline and from `file:///`.

---

## ☁️ Deploy to Cloudflare Pages

`npm run build:site` outputs a static site in `site/`: the demo page plus `dist/qr-tree.js`, so the hosted site also serves the embeddable script at `https://<project>.pages.dev/dist/qr-tree.js`.

- **Direct upload:** `npx wrangler pages deploy site`, or drag the `site` folder into *Workers & Pages → Create → Pages → Upload assets*.
- **Git integration:** build command `npm run build:site`, output directory `site`, and set the environment variable `NODE_VERSION=22` (Vite 8 needs Node ≥ 20.19).

---

## 📄 License

ISC

import { QrTreeScene } from './scene';
import { SEASONS, THEMES, isValidColor, type Season } from './themes';
import type { Ecc } from './qr';

const ECCS: Ecc[] = ['L', 'M', 'Q', 'H'];

const STYLE = /* css */ `
:host {
  display: block;
  position: relative;
  width: 100%;
  aspect-ratio: 1 / 1;
  overflow: hidden;
  contain: content;
  -webkit-tap-highlight-color: transparent;
}
:host([hidden]) { display: none; }
canvas { display: block; width: 100%; height: 100%; outline: none; cursor: grab; }
canvas:active { cursor: grabbing; }
.toggle { display: none !important; }
.message {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  text-align: center;
  font: 500 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
  color: #5b5446;
  background: #f6f1e7;
}
.message[hidden] { display: none; }
@media (prefers-reduced-motion: reduce) { .toggle { transition: none; } }
`;

const EYE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>`;
const TREE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22v-7"/><path d="M12 15a6 6 0 1 0-4.9-9.5A5 5 0 0 0 7 15h10a5 5 0 0 0-.1-9.5"/></svg>`;

/**
 * `<qr-tree data="https://example.com" season="spring"></qr-tree>`
 *
 * Attributes: data, season (spring|summer|autumn), color (#hex leaf colour),
 * background (#hex), ecc (L|M|Q|H, default M), autorotate, show-qr,
 * no-controls (hide the toggle button), no-orbit (disable drag to rotate).
 *
 * Events: `qr-ready`, `qr-error` ({ message }), `qr-mode-change` ({ qr }).
 */
export class QrTreeElement extends HTMLElement {
  static observedAttributes = ['data', 'season', 'scheme', 'color', 'background', 'ecc', 'autorotate', 'show-qr', 'no-orbit'];

  private scene: QrTreeScene | null = null;
  private canvas: HTMLCanvasElement;
  private button: HTMLButtonElement;
  private message: HTMLDivElement;
  private resizeObs: ResizeObserver | null = null;
  private intersectObs: IntersectionObserver | null = null;
  private motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  private onMotionChange = () => this.scene?.setReducedMotion(this.motionQuery.matches);

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${STYLE}</style>
      <canvas part="canvas" role="img"></canvas>
      <button class="toggle" part="toggle" type="button" aria-pressed="false"></button>
      <div class="message" part="message" role="alert" hidden></div>`;
    this.canvas = root.querySelector('canvas')!;
    this.button = root.querySelector('button')!;
    this.message = root.querySelector('.message')!;
    this.button.addEventListener('click', () => this.toggleQr());
    this.renderButton(false);
  }

  // ---------------------------------------------------------------- lifecycle

  connectedCallback() {
    if (this.scene) return;
    try {
      this.scene = new QrTreeScene(this.canvas, {
        season: this.season,
        color: this.leafColor,
        background: this.getAttribute('background') ?? undefined,
        autorotate: this.hasAttribute('autorotate'),
        orbit: !this.hasAttribute('no-orbit'),
        ecc: this.ecc,
        reducedMotion: this.motionQuery.matches,
      });
    } catch {
      this.showMessage('3D graphics (WebGL) are not available in this browser.');
      return;
    }
    this.scene.onToggleRequested = () => this.toggleQr();
    this.scene.onTopViewReached = () => this.showQr(true);
    this.scene.onSideViewReached = () => this.showQr(false);
    this.scene.onQrModeSettled = (qr) => {
      this.renderButton(qr);
      if (qr) {
        if (!this.hasAttribute('show-qr')) this.setAttribute('show-qr', '');
      } else {
        if (this.hasAttribute('show-qr')) this.removeAttribute('show-qr');
      }
      this.dispatchEvent(new CustomEvent('qr-mode-change', { detail: { qr }, bubbles: true, composed: true }));
    };
    this.applyData();
    if (this.hasAttribute('show-qr')) this.scene.setQrMode(true, true);

    this.resizeObs = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      this.scene?.resize(width, height);
    });
    this.resizeObs.observe(this);
    this.intersectObs = new IntersectionObserver(([entry]) => this.scene?.setActive(entry.isIntersecting));
    this.intersectObs.observe(this);
    this.motionQuery.addEventListener('change', this.onMotionChange);
  }

  disconnectedCallback() {
    this.resizeObs?.disconnect();
    this.intersectObs?.disconnect();
    this.motionQuery.removeEventListener('change', this.onMotionChange);
    this.scene?.dispose();
    this.scene = null;
  }

  attributeChangedCallback(name: string, oldValue: string | null, value: string | null) {
    const scene = this.scene;
    if (!scene || oldValue === value) return;
    switch (name) {
      case 'data':
        this.applyData();
        break;
      case 'season':
      case 'scheme':
      case 'color':
        scene.setTheme(this.season, this.leafColor);
        break;
      case 'background':
        if (value && isValidColor(value)) scene.setBackground(value);
        break;
      case 'ecc':
        try {
          scene.setEcc(this.ecc);
          this.clearMessage();
        } catch (e) {
          this.fail((e as Error).message);
        }
        break;
      case 'autorotate':
        scene.setAutorotate(value !== null);
        break;
      case 'no-orbit':
        scene.setOrbit(value === null);
        break;
      case 'show-qr':
        scene.setQrMode(value !== null);
        break;
    }
    scene.renderFrame();
  }

  // ---------------------------------------------------------------- public API

  get qrMode(): boolean {
    return this.scene?.qrMode ?? false;
  }

  /** Switch between the 3D tree and the flat, scannable QR view. */
  showQr(on = true, options: { instant?: boolean } = {}) {
    if (!this.scene) return;
    if (on) {
      if (this.hasAttribute('autorotate')) {
        this.removeAttribute('autorotate');
      }
      this.setAttribute('show-qr', '');
    } else {
      this.removeAttribute('show-qr');
    }
    this.renderButton(on);
    this.scene.setQrMode(on, options.instant);
  }

  toggleQr() {
    this.showQr(!this.qrMode);
  }

  /** PNG data URL of the current view (switch to QR view first for a scannable image). */
  toPNG(): string | null {
    return this.scene?.toPNG() ?? null;
  }

  /** Renders a frame immediately (handy right after changing attributes). */
  render() {
    this.scene?.renderFrame();
  }

  // ---------------------------------------------------------------- internals

  private get season(): Season {
    const s = (this.getAttribute('scheme') || this.getAttribute('season')) as Season | null;
    return s && (SEASONS.includes(s) || s in THEMES) ? s : 'core-blue';
  }

  private get leafColor(): string | null {
    const c = this.getAttribute('color');
    return c && isValidColor(c) ? c : null;
  }

  private get ecc(): Ecc {
    const e = (this.getAttribute('ecc') ?? 'M').toUpperCase() as Ecc;
    return ECCS.includes(e) ? e : 'M';
  }

  private applyData() {
    const data = this.getAttribute('data') || window.location.origin;
    try {
      this.scene!.setData(data);
      this.canvas.setAttribute('aria-label', `QR code tree linking to ${data}`);
      this.clearMessage();
      this.dispatchEvent(new CustomEvent('qr-ready', { detail: { data }, bubbles: true, composed: true }));
    } catch (e) {
      this.fail((e as Error).message);
    }
  }

  private fail(message: string) {
    this.showMessage(message);
    this.dispatchEvent(new CustomEvent('qr-error', { detail: { message }, bubbles: true, composed: true }));
  }

  private showMessage(text: string) {
    this.message.textContent = text; // textContent: never inject user input as HTML
    this.message.hidden = false;
    this.button.hidden = true;
  }

  private clearMessage() {
    this.message.hidden = true;
    this.button.hidden = false;
  }

  private renderButton(qr: boolean) {
    this.button.innerHTML = qr ? `${TREE}<span>Show tree</span>` : `${EYE}<span>I see QR</span>`;
    this.button.setAttribute('aria-pressed', String(qr));
  }
}

export function defineQrTree(tag = 'qr-tree') {
  if (!customElements.get(tag)) customElements.define(tag, class extends QrTreeElement {});
}

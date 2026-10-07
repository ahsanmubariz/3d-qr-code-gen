import { defineQrTree } from './qr-tree-element';

export { QrTreeElement, defineQrTree } from './qr-tree-element';
export { QrTreeScene, type SceneOptions } from './scene';
export { encode, validateUrl, MAX_MODULES, QrTooLongError, type Ecc, type Matrix } from './qr';
export { SEASONS, type Season } from './themes';

// Auto-register <qr-tree> when loaded via <script type="module">.
defineQrTree();

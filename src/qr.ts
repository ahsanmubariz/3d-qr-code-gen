import QRCode from 'qrcode';

/** Row-major module matrix: `matrix[row][col] === true` means a dark module. */
export type Matrix = boolean[][];
export type Ecc = 'L' | 'M' | 'Q' | 'H';

/**
 * Largest grid we render (QR version 6). Bigger grids make each leaf voxel too
 * small to read as a tree — same limit the reference implementation uses.
 */
export const MAX_MODULES = 41;
export const MAX_URL_LENGTH = 2000;

export class QrTooLongError extends Error {
  constructor() {
    super('This text is too long for a tree QR. Please shorten it (e.g. with a URL shortener).');
    this.name = 'QrTooLongError';
  }
}

export function encode(text: string, ecc: Ecc = 'M'): Matrix {
  if (!text) throw new Error('Nothing to encode.');
  if (text.length > MAX_URL_LENGTH) throw new QrTooLongError();
  let modules: QRCode.BitMatrix;
  try {
    ({ modules } = QRCode.create(text, { errorCorrectionLevel: ecc }));
  } catch {
    throw new QrTooLongError();
  }
  if (modules.size > MAX_MODULES) throw new QrTooLongError();
  const matrix: Matrix = [];
  for (let r = 0; r < modules.size; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < modules.size; c++) row.push(modules.get(r, c) === 1);
    matrix.push(row);
  }
  return matrix;
}

export type UrlCheck = { ok: true; url: string } | { ok: false; error: string };

/** Validates user input for the generator UI. Only http(s), no embedded credentials. */
export function validateUrl(input: string): UrlCheck {
  const raw = input.trim();
  if (!raw) return { ok: false, error: 'Please enter a URL.' };
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, error: 'Please enter a valid URL.' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: 'Only http and https URLs are supported.' };
  }
  if (url.username || url.password) {
    return { ok: false, error: 'URLs with credentials are not allowed.' };
  }
  if (!url.hostname.includes('.') && url.hostname !== 'localhost') {
    return { ok: false, error: 'Please enter a complete URL with a valid domain.' };
  }
  // Keep exactly what the user typed (plus scheme) so the QR stays as short as possible.
  const value = withScheme;
  try {
    encode(value);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  return { ok: true, url: value };
}

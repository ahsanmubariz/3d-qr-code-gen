import type { Matrix } from './qr';
import type { Rng } from './random';

/**
 * Voxel layout — the core trick (ported from the reference):
 *  - one ground tile per QR module (light → pale stone, dark → grass / moss)
 *  - leaf voxels are stacked ONLY above dark modules inside the canopy radius,
 *    so a straight top-down view of the canopy reproduces the QR exactly.
 *
 * Units: 1 = one QR module. Ground top is y = 0. Module (row, col) sits at
 * x = col - (n-1)/2, z = row - (n-1)/2.
 */

/** Reference block height relative to module width, used to port their formulas. */
const REF_UNIT = 0.0245;
const CANOPY_RADIUS_RATIO = 0.46;
/** Light tiles around the code (satisfies standard 4-module quiet zone). */
export const BORDER = 4;

export type TileKind = 'light' | 'grass' | 'moss';

export interface TreeParams {
  trunkHeight: number;
  trunkRadius: number;
  trunkLean: number;
  mainBranches: number;
  branchSpread: number;
  branchLengthScale: number;
  maxDepth: number;
}

export interface LeafVoxel {
  x: number;
  y: number;
  z: number;
  /** 0..1 position within its column (0 bottom, 1 top) — used for shading. */
  h: number;
  seed: number;
}

export interface World {
  n: number;
  scale: number;
  canopyRadius: number;
  canopyBase: number;
  canopyTop: number;
  params: TreeParams;
  tiles: { x: number; z: number; kind: TileKind; seed: number }[];
  leaves: LeafVoxel[];
  grass: { x: number; z: number; seed: number }[];
  petals: { x: number; z: number; seed: number }[];
}

function treeParams(m: Matrix, rng: Rng): TreeParams {
  const n = m.length;
  let dark = 0;
  let edges = 0;
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) {
      if (m[r][c]) dark++;
      if (c > 0 && m[r][c] !== m[r][c - 1]) edges++;
      if (r > 0 && m[r][c] !== m[r - 1][c]) edges++;
    }
  const density = dark / (n * n);
  const edgeRatio = edges / (2 * n * (n - 1));
  const s = n / 29;
  return {
    trunkHeight: ((0.26 + 0.08 * density) * s) / REF_UNIT,
    trunkRadius: ((0.024 + 0.008 * density) * s) / REF_UNIT,
    trunkLean: ((0.04 + 0.03 * rng(density, edgeRatio)) * s) / REF_UNIT,
    mainBranches: 4 + Math.floor(4 * density),
    branchSpread: 0.5 + 0.5 * edgeRatio,
    branchLengthScale: 0.55 + 0.25 * density,
    maxDepth: edgeRatio > 0.28 ? 5 : 4,
  };
}

export function buildWorld(m: Matrix, rng: Rng): World {
  const n = m.length;
  const s = n / 29;
  const half = (n - 1) / 2;
  const R = CANOPY_RADIUS_RATIO * n;
  const canopyBase = Math.round(12 * s);
  const params = treeParams(m, rng);

  const tiles: World['tiles'] = [];
  const grass: World['grass'] = [];
  const petals: World['petals'] = [];
  const columns = new Map<string, { lo: number; hi: number }>();

  // Border ring of light tiles.
  for (let r = -BORDER; r < n + BORDER; r++)
    for (let c = -BORDER; c < n + BORDER; c++) {
      if (r >= 0 && r < n && c >= 0 && c < n) continue;
      tiles.push({ x: c - half, z: r - half, kind: 'light', seed: rng(c, r, 1) });
    }

  let canopyTop = canopyBase;
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) {
      const x = c - half;
      const z = r - half;
      const d = Math.hypot(x, z);
      const seed = rng(c, r, 1);
      if (!m[r][c]) {
        tiles.push({ x, z, kind: 'light', seed });
        continue;
      }
      if (d >= R) {
        tiles.push({ x, z, kind: 'grass', seed });
        grass.push({ x, z, seed });
        continue;
      }
      tiles.push({ x, z, kind: 'moss', seed });
      petals.push({ x, z, seed });

      const f = 1 - d / R;
      const count = Math.max(4, Math.round(18 * s * (0.25 + 0.75 * f * f)));
      const lift = Math.floor(4.5 * f * s);
      const extra = Math.floor(6 * rng(c, r, 500) * s);
      let lo = canopyBase + lift;
      const hi = lo + count + extra; // exclusive
      if (d < 1.5) lo = canopyBase; // fill under the crown near the trunk
      columns.set(`${c},${r}`, { lo, hi });
      canopyTop = Math.max(canopyTop, hi);
    }

  // Emit only voxels with at least one exposed face — interior ones are never seen.
  const filled = (c: number, r: number, y: number) => {
    const col = columns.get(`${c},${r}`);
    return !!col && y >= col.lo && y < col.hi;
  };
  const leaves: LeafVoxel[] = [];
  for (const [key, { lo, hi }] of columns) {
    const [c, r] = key.split(',').map(Number);
    for (let y = lo; y < hi; y++) {
      const exposed =
        y === lo ||
        y === hi - 1 ||
        !filled(c + 1, r, y) ||
        !filled(c - 1, r, y) ||
        !filled(c, r + 1, y) ||
        !filled(c, r - 1, y);
      if (!exposed) continue;
      leaves.push({ x: c - half, y: y + 0.5, z: r - half, h: (y - lo) / Math.max(1, hi - lo - 1), seed: rng(c, r, y) });
    }
  }

  return { n, scale: s, canopyRadius: R, canopyBase, canopyTop, params, tiles, leaves, grass, petals };
}

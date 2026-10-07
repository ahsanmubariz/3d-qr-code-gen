import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Rng } from './random';
import type { World } from './world';

/**
 * Procedural trunk + recursive branches (L-system style), driven by QR stats.
 * Branches stay inside the canopy radius so they're hidden by leaves from above.
 */

interface Segment {
  a: THREE.Vector3;
  b: THREE.Vector3;
  ra: number;
  rb: number;
  radial: number;
}

const MAX_SEGMENTS = 420;

export function buildBranchGeometry(world: World, rng: Rng): THREE.BufferGeometry {
  const { trunkHeight: H, trunkRadius: rT, trunkLean: lean, mainBranches, branchSpread, branchLengthScale, maxDepth } =
    world.params;
  const R = world.canopyRadius;
  const yMin = H * 0.5;
  const yMax = world.canopyTop - 1.5;
  const segs: Segment[] = [];

  const trunkAt = (t: number) =>
    new THREE.Vector3(
      lean * t * t + 0.3 * lean * Math.sin(t * Math.PI * 1.5),
      H * t,
      0.5 * lean * Math.sin(t * Math.PI * 0.8),
    );
  const trunkR = (t: number) => rT * (1 - 0.55 * t) * (1 + 0.08 * Math.sin(t * Math.PI * 0.8));

  // Trunk.
  const TRUNK_STEPS = 10;
  for (let i = 0; i < TRUNK_STEPS; i++) {
    const t0 = i / TRUNK_STEPS;
    const t1 = (i + 1) / TRUNK_STEPS;
    segs.push({ a: trunkAt(t0), b: trunkAt(t1), ra: trunkR(t0), rb: trunkR(t1), radial: 10 });
  }

  // Root flare.
  const ROOTS = 5;
  for (let i = 0; i < ROOTS; i++) {
    const yaw = (i / ROOTS) * Math.PI * 2 + rng(i, 3, 3) * 0.8;
    const len = rT * (1.8 + rng(i, 4, 4));
    const a = new THREE.Vector3(0, rT * 0.9, 0);
    const b = new THREE.Vector3(Math.cos(yaw) * len, 0.02, Math.sin(yaw) * len);
    segs.push({ a, b, ra: rT * 0.55, rb: rT * 0.12, radial: 6 });
  }

  const clampToCanopy = (p: THREE.Vector3) => {
    const d = Math.hypot(p.x, p.z);
    if (d > 0.9 * R) {
      p.x *= (0.9 * R) / d;
      p.z *= (0.9 * R) / d;
    }
    p.y = Math.min(Math.max(p.y, yMin), yMax);
    return p;
  };

  let id = 0;
  const grow = (start: THREE.Vector3, yaw: number, pitch: number, len: number, radius: number, depth: number) => {
    if (segs.length >= MAX_SEGMENTS) return;
    const k = id++;
    const dir = new THREE.Vector3(Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch), Math.cos(pitch) * Math.sin(yaw));
    const end = clampToCanopy(start.clone().addScaledVector(dir, len));
    const endR = radius * 0.62;
    segs.push({ a: start, b: end, ra: radius, rb: endR, radial: depth <= 1 ? 8 : 5 });
    if (depth >= maxDepth || endR < 0.05) return;
    const children = 1 + Math.floor(2 * rng(k, depth, 11));
    for (let j = 0; j < children; j++) {
      grow(
        end,
        yaw + 2.2 * branchSpread * (rng(k, j, 21) - 0.5),
        Math.min(1.3, Math.max(0.1, pitch + 0.6 * (rng(k, j, 31) - 0.4))),
        len * (0.62 + 0.15 * rng(k, j, 41)),
        endR,
        depth + 1,
      );
    }
  };

  for (let i = 0; i < mainBranches; i++) {
    const t0 = 0.5 + 0.45 * rng(i, 1, 1);
    const yaw = (i / mainBranches) * Math.PI * 2 + 0.9 * (rng(i, 2, 2) - 0.5);
    const pitch = 0.35 + 0.5 * rng(i, 5, 5);
    const len = R * (0.35 + 0.25 * rng(i, 6, 6)) * branchLengthScale;
    grow(trunkAt(t0), yaw, pitch, len, trunkR(t0) * 0.6, 1);
  }

  // Build one merged mesh: tapered open cylinders + spheres at the joints.
  const up = new THREE.Vector3(0, 1, 0);
  const parts: THREE.BufferGeometry[] = [];
  const q = new THREE.Quaternion();
  const mtx = new THREE.Matrix4();
  for (const s of segs) {
    const v = s.b.clone().sub(s.a);
    const len = v.length();
    if (len < 1e-3) continue;
    q.setFromUnitVectors(up, v.normalize());
    const cyl = new THREE.CylinderGeometry(s.rb, s.ra, len, s.radial, 1, true);
    mtx.compose(s.a.clone().lerp(s.b, 0.5), q, new THREE.Vector3(1, 1, 1));
    cyl.applyMatrix4(mtx);
    parts.push(cyl);
    const joint = new THREE.SphereGeometry(s.rb, Math.max(5, s.radial), 4);
    joint.translate(s.b.x, s.b.y, s.b.z);
    parts.push(joint);
  }
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return merged;
}

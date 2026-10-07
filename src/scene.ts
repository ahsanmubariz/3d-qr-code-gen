import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { encode, type Ecc } from './qr';
import { makeRng, type Rng } from './random';
import { BORDER, buildWorld, type World } from './world';
import { buildBranchGeometry } from './tree';
import { THEMES, customLeaves, type Season, type Theme } from './themes';

export interface SceneOptions {
  season?: Season;
  color?: string | null;
  background?: string;
  autorotate?: boolean;
  orbit?: boolean;
  ecc?: Ecc;
  reducedMotion?: boolean;
}

const QR_TRANSITION_SECONDS = 0.9;
const ISO_FOV = 30;
const QR_FOV = 1.5;
const ISO_POLAR = THREE.MathUtils.degToRad(57);
const ISO_AZIMUTH = Math.PI / 4;
/** Pointer travel (px) below which a press counts as a tap. */
const TAP_SLOP = 12;
/** Downward pointer drag (px) in 3D mode that tilts up into QR mode. */
const LIFT_DRAG_PX = 30;
/** Camera polar angle (rad, ~40°) below which it's considered over the tree → QR mode. */
const OVER_TREE_POLAR = 0.7;

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerp = THREE.MathUtils.lerp;

interface CamState {
  target: THREE.Vector3;
  polar: number;
  azimuth: number;
  frameH: number;
  fov: number;
}

export class QrTreeScene {
  readonly canvas: HTMLCanvasElement;
  onQrModeSettled?: (on: boolean) => void;
  onTopViewReached?: () => void;
  onSideViewReached?: () => void;
  onToggleRequested?: () => void;

  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private persp = new THREE.PerspectiveCamera(ISO_FOV, 1, 0.1, 1000);
  private ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 2000);
  private controls: OrbitControls;
  private timer = new THREE.Timer();
  private group = new THREE.Group();
  private hemi = new THREE.HemisphereLight('#fff8ec', '#b9a88c', 1.7);
  private sun = new THREE.DirectionalLight('#fff1dc', 2.6);
  private uniforms = {
    uTime: { value: 0 },
    uSway: { value: 1 },
    uSwayBase: { value: 10 },
    uQr: { value: 0 },
    uBgCol: { value: new THREE.Color('#f6f1e7') },
    uDarkCol: { value: new THREE.Color(0.02, 0.02, 0.02) },
  };

  private mats = {
    lightTile: new THREE.MeshStandardMaterial({ roughness: 0.95 }),
    darkTile: new THREE.MeshStandardMaterial({ roughness: 0.95 }),
    slab: new THREE.MeshStandardMaterial({ color: '#e0d6c4', roughness: 1 }),
    leaf: new THREE.MeshStandardMaterial({ roughness: 0.8, flatShading: true }),
    grass: new THREE.MeshStandardMaterial({ roughness: 0.9, vertexColors: true }),
    petal: new THREE.MeshStandardMaterial({ roughness: 0.9, side: THREE.DoubleSide }),
    bark: new THREE.MeshStandardMaterial({ roughness: 0.9, transparent: true }),
  };

  private branchMesh: THREE.Mesh | null = null;
  private slabMesh: THREE.Mesh | null = null;
  private grassMesh: THREE.InstancedMesh | null = null;
  private petalMesh: THREE.InstancedMesh | null = null;

  private world: World | null = null;
  private rng: Rng = makeRng('');
  private data = '';
  private opts: Required<Omit<SceneOptions, 'color'>> & { color: string | null };

  private qrT = 0;
  private qrTarget = 0;
  private isoState: CamState | null = null;
  private active = false;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, options: SceneOptions = {}) {
    this.canvas = canvas;
    this.opts = {
      season: options.season ?? 'core-blue',
      color: options.color ?? null,
      background: options.background ?? '#f6f1e7',
      autorotate: options.autorotate ?? false,
      orbit: options.orbit ?? true,
      ecc: options.ecc ?? 'M',
      reducedMotion: options.reducedMotion ?? false,
    };

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene.background = new THREE.Color(this.opts.background);
    this.scene.add(this.hemi, this.sun, this.sun.target, this.group);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;

    this.uniforms.uBgCol.value.set(this.opts.background);
    this.patchQrColor(this.mats.lightTile, 'light');
    this.patchQrColor(this.mats.darkTile, 'dark');
    this.patchSway(this.mats.leaf, 'leaf');
    this.patchSway(this.mats.grass, 'grass');

    this.controls = new OrbitControls(this.persp, canvas);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minPolarAngle = 0.02;
    this.controls.maxPolarAngle = THREE.MathUtils.degToRad(84);
    this.controls.autoRotateSpeed = 0.6;
    this.applyControlOptions();
    this.timer.connect(document);

    this.setupInteractions();
  }

  /** Sets up click-to-toggle and viewfinder drag tracking */
  private setupInteractions() {
    let downPos = { x: 0, y: 0 };
    let downTime = 0;
    let isDown = false;
    let moved = false; // pointer travelled past TAP_SLOP: this gesture is a drag, not a tap
    let dragOriginMode: -1 | 0 | 1 = 0; // -1 = gesture already switched modes once

    const toQr = () => {
      dragOriginMode = -1;
      if (this.onTopViewReached) {
        this.onTopViewReached();
      } else {
        this.setAutorotate(false);
        this.setQrMode(true);
      }
    };
    const toTree = () => {
      dragOriginMode = -1;
      if (this.onSideViewReached) this.onSideViewReached();
      else this.setQrMode(false);
    };

    this.canvas.addEventListener('pointerdown', (e) => {
      if (isDown) return; // second finger of a pinch: keep the original gesture
      downPos = { x: e.clientX, y: e.clientY };
      downTime = performance.now();
      isDown = true;
      moved = false;
      dragOriginMode = this.qrTarget === 1 ? 1 : 0;
    });

    this.canvas.addEventListener('pointermove', (e) => {
      if (!isDown) return;
      const dx = e.clientX - downPos.x;
      const dy = e.clientY - downPos.y;
      if (Math.hypot(dx, dy) > TAP_SLOP) moved = true;
      if (!moved) return;
      // QR mode: any drag returns to the 3D tree
      if (dragOriginMode === 1) toTree();
      // 3D mode: pulling down (tilting the camera up over the tree) a bit switches to QR
      else if (dragOriginMode === 0 && dy > LIFT_DRAG_PX && dy > Math.abs(dx)) toQr();
    });

    this.canvas.addEventListener('pointerup', () => {
      if (!isDown) return;
      isDown = false;
      if (!moved && performance.now() - downTime < 500) {
        if (this.onToggleRequested) this.onToggleRequested();
        else this.setQrMode(this.qrTarget === 0);
      }
    });

    const cancel = () => {
      isDown = false;
    };
    window.addEventListener('pointerup', cancel);
    this.canvas.addEventListener('pointercancel', cancel);

    // 3D mode: a drag (or its release momentum) brought the camera over the tree → QR mode
    this.controls.addEventListener('change', () => {
      if (moved && dragOriginMode === 0 && this.qrTarget === 0 && this.controls.getPolarAngle() < OVER_TREE_POLAR) toQr();
    });
  }

  // ---------------------------------------------------------------- public API

  setData(text: string) {
    const matrix = encode(text, this.opts.ecc);
    this.data = text;
    this.rng = makeRng(text);
    this.world = buildWorld(matrix, this.rng);
    this.rebuild();
    this.resetCamera();
  }

  setTheme(season: Season, color: string | null = null) {
    this.opts.season = season;
    this.opts.color = color;
    if (this.world) this.rebuild();
  }

  setEcc(ecc: Ecc) {
    if (ecc === this.opts.ecc) return;
    this.opts.ecc = ecc;
    if (this.data) this.setData(this.data);
  }

  setBackground(hex: string) {
    this.opts.background = hex;
    (this.scene.background as THREE.Color).set(hex);
    this.uniforms.uBgCol.value.set(hex);
  }

  setAutorotate(on: boolean) {
    this.opts.autorotate = on;
    this.applyControlOptions();
  }

  setOrbit(on: boolean) {
    this.opts.orbit = on;
    this.applyControlOptions();
  }

  setReducedMotion(on: boolean) {
    this.opts.reducedMotion = on;
    this.applyControlOptions();
  }

  get qrMode() {
    return this.qrTarget === 1;
  }

  setQrMode(on: boolean, instant = false) {
    const target = on ? 1 : 0;
    if (target === this.qrTarget && !instant) return;
    // Start the dolly from the exact current pose so there's no jump when a drag triggers QR mode
    if (on && this.qrT === 0) {
      this.isoState = this.captureIsoState();
      // Drop leftover drag momentum so it doesn't drift the camera when we come back to 3D.
      // Flushing moves the camera, so put it straight back on the captured pose.
      this.controls.enableDamping = false;
      this.controls.update();
      this.controls.enableDamping = true;
      this.restoreIso();
    }
    // Returning from a settled QR view: come back down to a proper side angle instead of overhead.
    // Only safe at qrT === 1, where the start pose has zero weight; mid-transition reversals retrace the path.
    if (!on && this.qrT === 1 && this.isoState && this.isoState.polar < OVER_TREE_POLAR) this.isoState.polar = ISO_POLAR;
    this.qrTarget = target;
    if (instant || this.opts.reducedMotion) {
      this.qrT = target;
      if (target === 0) this.restoreIso();
      this.applyTransition();
      this.onQrModeSettled?.(on);
    }
    this.applyControlOptions(); // enable/disable orbit right away, not on the next frame
    this.renderFrame();
  }

  resize(width: number, height: number) {
    if (width <= 0 || height <= 0) return;
    this.renderer.setSize(width, height, false);
    const aspect = width / height;
    this.persp.aspect = aspect;
    this.persp.updateProjectionMatrix();
    if (this.world && this.qrT === 0) this.fitIsoDistance();
    this.applyTransition();
    this.renderFrame();
  }

  setActive(on: boolean) {
    if (on === this.active || this.disposed) return;
    this.active = on;
    this.renderer.setAnimationLoop(on ? (t) => this.tick(t) : null);
  }

  renderFrame() {
    if (this.disposed) return;
    this.renderer.render(this.scene, this.qrT === 1 ? this.ortho : this.persp);
  }

  toPNG(): string {
    this.renderFrame();
    return this.canvas.toDataURL('image/png');
  }

  dispose() {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.timer.dispose();
    this.controls.dispose();
    this.clearGroup();
    Object.values(this.mats).forEach((m) => m.dispose());
    this.renderer.dispose();
  }

  // ---------------------------------------------------------------- building

  private theme(): Theme {
    const base = THEMES[this.opts.season] ?? THEMES['core-blue'] ?? THEMES.spring;
    if (!this.opts.color) return base;
    const leaves = customLeaves(this.opts.color);
    return { ...base, qrDark: this.opts.color, leaves, petals: leaves.slice(0, 2) };
  }

  private clearGroup() {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        if (o instanceof THREE.InstancedMesh) o.dispose();
      }
    });
    this.group.clear();
    this.branchMesh = null;
    this.slabMesh = null;
    this.grassMesh = null;
    this.petalMesh = null;
  }

  private rebuild() {
    const world = this.world;
    if (!world) return;
    this.clearGroup();
    const theme = this.theme();
    const rng = this.rng;
    const tmp = new THREE.Object3D();
    const col = new THREE.Color();

    this.mats.bark.color.set(theme.bark);
    this.uniforms.uSwayBase.value = world.canopyBase;

    // Platform slab
    const size = world.n + 2 * BORDER;
    const slab = new THREE.Mesh(new RoundedBoxGeometry(size + 0.3, 1.4, size + 0.3, 2, 0.1), this.mats.slab);
    slab.position.y = -0.5 - 0.7 + 0.05;
    slab.receiveShadow = true;
    this.slabMesh = slab;
    this.group.add(slab);

    // Ground tiles partitioned into light tiles and dark tiles
    const lightTilesData: { x: number; y: number; z: number; color: THREE.Color }[] = [];
    const darkTilesData: { x: number; y: number; z: number; color: THREE.Color }[] = [];

    const grassTileBase = col.set(theme.grass[2]).clone();
    const mossTileBase = new THREE.Color(theme.moss);

    world.tiles.forEach((t) => {
      if (t.kind === 'light') {
        lightTilesData.push({
          x: t.x,
          y: 0.02 * t.seed,
          z: t.z,
          color: new THREE.Color(theme.light[Math.floor(t.seed * theme.light.length)]),
        });
      } else {
        const c = t.kind === 'grass' ? grassTileBase.clone() : mossTileBase.clone().multiplyScalar(0.85 + 0.25 * t.seed);
        darkTilesData.push({
          x: t.x,
          y: 0,
          z: t.z,
          color: c,
        });
      }
    });

    const tileGeo = new RoundedBoxGeometry(1.0, 0.5, 1.0, 1, 0.012);
    tileGeo.translate(0, -0.25, 0);

    const lightTiles = new THREE.InstancedMesh(tileGeo, this.mats.lightTile, lightTilesData.length);
    lightTiles.receiveShadow = true;
    lightTilesData.forEach((d, i) => {
      tmp.position.set(d.x, d.y, d.z);
      tmp.rotation.set(0, 0, 0);
      tmp.scale.set(1, 1, 1);
      tmp.updateMatrix();
      lightTiles.setMatrixAt(i, tmp.matrix);
      lightTiles.setColorAt(i, d.color);
    });
    this.group.add(lightTiles);

    const darkTiles = new THREE.InstancedMesh(tileGeo, this.mats.darkTile, darkTilesData.length);
    darkTiles.receiveShadow = true;
    darkTilesData.forEach((d, i) => {
      tmp.position.set(d.x, d.y, d.z);
      tmp.rotation.set(0, 0, 0);
      tmp.scale.set(1, 1, 1);
      tmp.updateMatrix();
      darkTiles.setMatrixAt(i, tmp.matrix);
      darkTiles.setColorAt(i, d.color);
    });
    this.group.add(darkTiles);

    // Leaves — seamless voxel cubes forming the canopy
    const leafGeo = new RoundedBoxGeometry(1.0, 1.0, 1.0, 1, 0.035);
    const leaves = new THREE.InstancedMesh(leafGeo, this.mats.leaf, world.leaves.length);
    leaves.castShadow = true;
    leaves.receiveShadow = true;
    world.leaves.forEach((l, i) => {
      const r2 = rng(l.seed * 89, 2, 2);
      tmp.position.set(l.x, l.y + (r2 - 0.5) * 0.1, l.z);
      tmp.rotation.set(0, 0, 0);
      tmp.scale.set(1, 1, 1);
      tmp.updateMatrix();
      leaves.setMatrixAt(i, tmp.matrix);
      col.set(theme.leaves[Math.floor(l.seed * theme.leaves.length)]).multiplyScalar(0.85 + 0.25 * l.h);
      leaves.setColorAt(i, col);
    });
    this.group.add(leaves);

    // Grass blades on dark modules outside the canopy (for 3D look)
    const BLADES = 8;
    const bladeGeo = makeBladeGeometry();
    const grass = new THREE.InstancedMesh(bladeGeo, this.mats.grass, world.grass.length * BLADES);
    grass.receiveShadow = true;
    this.grassMesh = grass;
    let gi = 0;
    for (const g of world.grass) {
      for (let b = 0; b < BLADES; b++) {
        const a = rng(g.seed * 31, b, 1);
        const c = rng(g.seed * 37, b, 2);
        const h = rng(g.seed * 41, b, 3);
        tmp.position.set(g.x + (a - 0.5) * 0.78, 0, g.z + (c - 0.5) * 0.78);
        tmp.rotation.set((a - 0.5) * 0.7, h * Math.PI * 2, (c - 0.5) * 0.7);
        tmp.scale.set(1, 0.45 + 0.6 * h, 1);
        tmp.updateMatrix();
        grass.setMatrixAt(gi, tmp.matrix);
        col.set(theme.grass[Math.floor(h * theme.grass.length)]);
        grass.setColorAt(gi, col);
        gi++;
      }
    }
    this.group.add(grass);

    // Fallen petals on the moss under the canopy
    const PETALS = 4;
    const petalGeo = new THREE.CircleGeometry(0.13, 5);
    petalGeo.rotateX(-Math.PI / 2);
    const petals = new THREE.InstancedMesh(petalGeo, this.mats.petal, world.petals.length * PETALS);
    petals.receiveShadow = true;
    this.petalMesh = petals;
    let pi = 0;
    for (const p of world.petals) {
      for (let k = 0; k < PETALS; k++) {
        const a = rng(p.seed * 53, k, 1);
        const c = rng(p.seed * 59, k, 2);
        tmp.position.set(p.x + (a - 0.5) * 0.8, 0.012 + 0.002 * k, p.z + (c - 0.5) * 0.8);
        tmp.rotation.set(0, a * Math.PI * 2, 0);
        tmp.scale.set(1, 1, 0.6 + 0.6 * c);
        tmp.updateMatrix();
        petals.setMatrixAt(pi, tmp.matrix);
        col.set(theme.petals[Math.floor(c * theme.petals.length)]);
        petals.setColorAt(pi, col);
        pi++;
      }
    }
    this.group.add(petals);

    // Trunk + branches
    const branches = new THREE.Mesh(buildBranchGeometry(world, rng), this.mats.bark);
    branches.castShadow = true;
    branches.receiveShadow = true;
    this.branchMesh = branches;
    this.group.add(branches);

    // Sun shadow setup
    const ext = size * 0.8;
    const sc = this.sun.shadow.camera;
    sc.left = -ext;
    sc.right = ext;
    sc.top = ext;
    sc.bottom = -ext;
    sc.near = 1;
    sc.far = 400;
    sc.updateProjectionMatrix();
    this.sun.position.set(-0.55, 1, 0.4).normalize().multiplyScalar(150);
    this.sun.target.position.set(0, world.canopyTop * 0.3, 0);

    this.applyTransition();
  }

  private patchQrColor(mat: THREE.MeshStandardMaterial, kind: 'light' | 'dark') {
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.fragmentShader =
        'uniform float uQr;\nuniform vec3 uBgCol;\nuniform vec3 uDarkCol;\n' +
        shader.fragmentShader.replace(
          '#include <dithering_fragment>',
          `#include <dithering_fragment>
gl_FragColor.rgb = mix(gl_FragColor.rgb, ${kind === 'light' ? 'uBgCol' : 'uDarkCol'}, uQr);`,
        );
    };
    mat.customProgramCacheKey = () => `qr-tree-color-${kind}`;
  }

  private patchSway(mat: THREE.MeshStandardMaterial, kind: 'leaf' | 'grass') {
    const amp =
      kind === 'leaf'
        ? 'uSway * (0.008 * max(p.y - uSwayBase, 0.0) + 0.03)'
        : 'uSway * 0.14 * max(transformed.y, 0.0)';
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader =
        'uniform float uTime;\nuniform float uSway;\nuniform float uSwayBase;\n' +
        shader.vertexShader.replace(
          '#include <project_vertex>',
          `vec4 p = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  p = instanceMatrix * p;
  vec3 ip = instanceMatrix[3].xyz;
  float ph = uTime * 1.3 + ip.x * 0.23 + ip.z * 0.17;
  float a = ${amp};
  p.x += sin(ph) * a;
  p.z += cos(ph * 0.83) * a * 0.7;
#endif
vec4 mvPosition = modelViewMatrix * p;
gl_Position = projectionMatrix * mvPosition;`,
        );
      if (kind === 'leaf') {
        shader.fragmentShader =
          'uniform float uQr;\nuniform vec3 uDarkCol;\n' +
          shader.fragmentShader.replace(
            '#include <dithering_fragment>',
            `#include <dithering_fragment>
gl_FragColor.rgb = mix(gl_FragColor.rgb, uDarkCol, uQr);`,
          );
      }
    };
    mat.customProgramCacheKey = () => `qr-tree-sway-${kind}`;
  }

  // ---------------------------------------------------------------- camera & transition

  private qrFrameSize() {
    return this.world ? (this.world.n + 2 * BORDER) * 1.05 : 30;
  }

  private isoDefaults(): CamState {
    const w = this.world!;
    return {
      target: new THREE.Vector3(0, w.canopyTop * 0.36, 0),
      polar: ISO_POLAR,
      azimuth: ISO_AZIMUTH,
      fov: ISO_FOV,
      frameH: 0,
    };
  }

  private fitDistance(fov: number) {
    const w = this.world!;
    const halfDiag = ((w.n + 2 * BORDER) / 2) * Math.SQRT2;
    const radius = Math.hypot(halfDiag, w.canopyTop * 0.62) * 0.78;
    const vHalf = THREE.MathUtils.degToRad(fov / 2);
    const hHalf = Math.atan(Math.tan(vHalf) * this.persp.aspect);
    return radius / Math.sin(Math.min(vHalf, hHalf));
  }

  private resetCamera() {
    this.qrT = this.qrTarget;
    const s = this.isoDefaults();
    this.controls.target.copy(s.target);
    this.persp.fov = ISO_FOV;
    this.setPerspFromSpherical(s.target, this.fitDistance(ISO_FOV), s.polar, s.azimuth);
    this.isoState = this.captureIsoState();
    this.applyTransition();
  }

  private fitIsoDistance() {
    const offset = this.persp.position.clone().sub(this.controls.target);
    offset.setLength(this.fitDistance(this.persp.fov));
    this.persp.position.copy(this.controls.target).add(offset);
    this.updateClipping(offset.length());
  }

  /** Puts the perspective camera back at the saved 3D pose and hands it to OrbitControls. */
  private restoreIso() {
    if (!this.isoState) return;
    this.controls.target.copy(this.isoState.target);
    this.persp.fov = this.isoState.fov;
    const dist = this.isoState.frameH / (2 * Math.tan(THREE.MathUtils.degToRad(this.isoState.fov / 2)));
    this.setPerspFromSpherical(this.isoState.target, dist, this.isoState.polar, this.isoState.azimuth);
  }

  private captureIsoState(): CamState {
    const offset = this.persp.position.clone().sub(this.controls.target);
    const sph = new THREE.Spherical().setFromVector3(offset);
    return {
      target: this.controls.target.clone(),
      polar: sph.phi,
      azimuth: sph.theta,
      fov: this.persp.fov,
      frameH: 2 * sph.radius * Math.tan(THREE.MathUtils.degToRad(this.persp.fov / 2)),
    };
  }

  private setPerspFromSpherical(target: THREE.Vector3, dist: number, polar: number, azimuth: number) {
    this.persp.position.copy(target).add(new THREE.Vector3().setFromSphericalCoords(dist, polar, azimuth));
    this.persp.lookAt(target);
    this.updateClipping(dist);
  }

  private updateClipping(dist: number) {
    const depth = this.world ? 3 * (this.world.canopyTop + this.world.n) : 300;
    this.persp.near = Math.max(0.1, dist - depth);
    this.persp.far = dist + depth;
    this.persp.updateProjectionMatrix();
  }

  private applyTransition() {
    if (!this.world) return;
    const e = easeInOutCubic(this.qrT);
    const aspect = this.persp.aspect || 1;
    const F = this.qrFrameSize();

    // Top-down orthographic camera
    const halfH = aspect >= 1 ? F / 2 : F / (2 * aspect);
    this.ortho.left = -halfH * aspect;
    this.ortho.right = halfH * aspect;
    this.ortho.top = halfH;
    this.ortho.bottom = -halfH;
    this.ortho.position.set(0, 500, 0);
    this.ortho.lookAt(0, 0, 0);
    this.ortho.updateProjectionMatrix();

    // Perspective camera dolly zoom
    if (this.qrT > 0 && this.isoState) {
      const from = this.isoState;
      let az = from.azimuth % (Math.PI * 2);
      if (az > Math.PI) az -= Math.PI * 2;
      if (az < -Math.PI) az += Math.PI * 2;
      const fov = Math.exp(lerp(Math.log(from.fov), Math.log(QR_FOV), e));
      const frameH = lerp(from.frameH, halfH * 2, e);
      const dist = frameH / (2 * Math.tan(THREE.MathUtils.degToRad(fov / 2)));
      const target = from.target.clone().lerp(new THREE.Vector3(0, 0, 0), e);
      this.persp.fov = fov;
      this.setPerspFromSpherical(target, dist, lerp(from.polar, 0.001, e), lerp(az, 0, e));
    }

    // Uniforms for smooth shader color transition
    this.uniforms.uQr.value = e;
    this.uniforms.uBgCol.value.set(this.opts.background);

    // Material transitions for perfect scan contrast:
    const theme = this.theme();
    const qrDark = new THREE.Color(theme.qrDark ?? theme.primary);
    const white = new THREE.Color(1, 1, 1);
    const bgCol = new THREE.Color(this.opts.background);

    this.uniforms.uDarkCol.value.copy(qrDark);

    // Light tiles blend seamlessly to background
    this.mats.lightTile.color.copy(white).lerp(bgCol, e);

    // Dark tiles & leaves transition to the tree brand color in QR mode
    this.mats.darkTile.color.copy(white).lerp(qrDark, e);
    this.mats.leaf.color.copy(white).lerp(qrDark, e);

    // Lighting flattens out
    this.hemi.color.set('#fff8ec').lerp(white, e);
    this.hemi.groundColor.set('#b9a88c').lerp(white, e);
    this.hemi.intensity = lerp(1.7, Math.PI, e);
    this.sun.intensity = lerp(2.6, 0, e);
    // Don't toggle sun.castShadow here: it changes the shader program key and recompiles every
    // material mid-transition (visible hitch). At intensity 0 the shadow has no effect anyway.
    this.uniforms.uSway.value = this.opts.reducedMotion ? 0 : 1 - e;

    // Decorative details hide in top-down QR view
    const o = 1 - THREE.MathUtils.smoothstep(e, 0.12, 0.6);
    if (this.branchMesh) {
      this.mats.bark.opacity = o;
      this.branchMesh.visible = o > 0.01;
    }
    if (this.grassMesh) this.grassMesh.visible = o > 0.01;
    if (this.petalMesh) this.petalMesh.visible = o > 0.01;
    if (this.slabMesh) this.slabMesh.visible = o > 0.01;
  }

  private applyControlOptions() {
    // Enabled while animating back to 3D too: drag input accumulates and is applied (damped) once
    // the camera lands, instead of being silently dropped. tick() only runs update() at qrT === 0.
    this.controls.enabled = this.opts.orbit && this.qrTarget === 0;
    this.controls.autoRotate = this.opts.autorotate && this.qrT === 0 && !this.opts.reducedMotion;
    this.uniforms.uSway.value = this.opts.reducedMotion ? 0 : 1 - this.qrT;
  }

  // ---------------------------------------------------------------- loop

  private tick(time: number) {
    this.timer.update(time);
    const dt = Math.min(this.timer.getDelta(), 0.1);
    this.uniforms.uTime.value = this.timer.getElapsed();

    if (this.qrT !== this.qrTarget) {
      const step = dt / QR_TRANSITION_SECONDS;
      this.qrT = this.qrTarget > this.qrT ? Math.min(1, this.qrT + step) : Math.max(0, this.qrT - step);
      if (this.qrT === 0) this.restoreIso();
      this.applyTransition();
      this.applyControlOptions();
      if (this.qrT === this.qrTarget) this.onQrModeSettled?.(this.qrTarget === 1);
    }

    // Controls only drive the camera in 3D mode; during a transition they would fight the dolly
    if (this.qrT === 0) this.controls.update(dt);
    this.renderFrame();
  }
}

// Single grass blade with dark root -> light tip
function makeBladeGeometry(): THREE.BufferGeometry {
  const geo = new THREE.ConeGeometry(0.075, 1, 3, 1);
  geo.translate(0, 0.5, 0);
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const k = 0.55 + 0.6 * pos.getY(i);
    colors.set([k, k, k], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

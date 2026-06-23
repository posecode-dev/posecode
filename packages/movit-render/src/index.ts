/**
 * movit-render — public API.
 *
 * `createViewer(canvas)` sets up a Three.js studio scene with the procedural
 * mannequin and returns a controller. `load(ir)` builds a timeline from a parsed
 * MovitIR; the render loop applies forward kinematics each frame, then keeps
 * ground-locked contacts (hands/feet) planted via floating-root solving. The
 * camera auto-frames the figure and eases smoothly when a new movement loads.
 */

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { MovitIR } from "movit-parser";
import { buildMannequin, type Mannequin } from "./mannequin.js";
import { buildTimeline, type BuiltTimeline, type PhaseSegment } from "./timeline.js";

const DEG = Math.PI / 180;

export interface ViewerPhaseInfo {
  phaseName: string;
  cue?: string;
}

export interface TimelineInfo {
  duration: number;
  repeat: number;
  segments: PhaseSegment[];
}

export interface Viewer {
  load(ir: MovitIR): void;
  play(): void;
  pause(): void;
  toggle(): boolean;
  seek(seconds: number): void;
  setSpeed(multiplier: number): void;
  setLoop(loop: boolean): void;
  get playing(): boolean;
  get duration(): number;
  get time(): number;
  getTimeline(): TimelineInfo | null;
  onPhase(cb: (info: ViewerPhaseInfo) => void): void;
  onTick(cb: (time: number, duration: number) => void): void;
  onLoop(cb: () => void): void;
  dispose(): void;
}

export interface ViewerOptions {
  /** Slowly orbit the camera when idle. Defaults to true. */
  autoRotate?: boolean;
}

export function createViewer(
  canvas: HTMLCanvasElement,
  opts: ViewerOptions = {},
): Viewer {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0c0f15);
  scene.fog = new THREE.Fog(0x0c0f15, 9, 18);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(2.6, 1.6, 3.4);

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0.9, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 1.2;
  controls.maxDistance = 9;
  controls.maxPolarAngle = Math.PI * 0.92;
  controls.autoRotate = opts.autoRotate ?? true;
  controls.autoRotateSpeed = 0.5;

  // --- Studio lighting ---
  const hemi = new THREE.HemisphereLight(0xdfe9ff, 0x20242c, 0.85);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xfff4e6, 2.0);
  key.position.set(3.5, 6, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 22;
  key.shadow.camera.left = -3;
  key.shadow.camera.right = 3;
  key.shadow.camera.top = 3;
  key.shadow.camera.bottom = -3;
  key.shadow.bias = -0.0004;
  key.shadow.radius = 4;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0x9fb8ff, 0.5);
  fill.position.set(-4, 2.5, -2);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0xffffff, 0.7);
  rim.position.set(-1, 3, -5);
  scene.add(rim);

  // --- Ground ---
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(8, 64),
    new THREE.MeshStandardMaterial({ color: 0x14181f, roughness: 0.95, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(12, 24, 0x2b323d, 0x1b2027);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.5;
  grid.position.y = 0.001;
  scene.add(grid);

  let mannequin: Mannequin = buildMannequin();
  enableShadows(mannequin.root);
  scene.add(mannequin.root);

  let timeline: BuiltTimeline | null = null;
  let groundTargets = new Map<string, THREE.Vector3>();
  let time = 0;
  let speed = 1;
  let playing = false;
  let loop = true;
  let phaseCb: (info: ViewerPhaseInfo) => void = () => {};
  let tickCb: (time: number, duration: number) => void = () => {};
  let loopCb: () => void = () => {};
  let lastPhaseName = "";

  // Camera easing targets.
  const desiredTarget = new THREE.Vector3(0, 0.9, 0);
  const desiredPos = camera.position.clone();
  let easeCamera = false;

  function resize(): void {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    if (canvas.width !== w || canvas.height !== h) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
  }

  function applyBaseRoot(): void {
    const root = mannequin.root;
    const base = timeline?.basePose.root;
    root.position.set(...(base?.position ?? [0, 0, 0]));
    const [rx, ry, rz] = base?.rotationDeg ?? [0, 0, 0];
    root.rotation.set(rx * DEG, ry * DEG, rz * DEG);
    root.updateMatrixWorld(true);
  }

  function groundFigure(): void {
    mannequin.root.updateMatrixWorld(true);
    let minY = Infinity;
    for (const id of ["wrist_left", "wrist_right", "ankle_left", "ankle_right"]) {
      const node = mannequin.bones.get(id);
      if (!node) continue;
      minY = Math.min(minY, node.getWorldPosition(new THREE.Vector3()).y);
    }
    if (Number.isFinite(minY)) {
      mannequin.root.position.y -= minY;
      mannequin.root.updateMatrixWorld(true);
    }
  }

  function captureGroundTargets(): void {
    // "Ground-lock" means HOLD the effector where the grounded base pose placed
    // it — not drag it to y=0. groundFigure() already set the floor contact.
    groundTargets = new Map();
    for (const ids of Object.values(mannequin.effectors)) {
      for (const id of ids) {
        const node = mannequin.bones.get(id);
        if (node) groundTargets.set(id, node.getWorldPosition(new THREE.Vector3()));
      }
    }
  }

  function activeEffectorIds(active: string[]): string[] {
    const ids = new Set<string>();
    for (const group of active) {
      for (const id of mannequin.effectors[group] ?? []) ids.add(id);
    }
    return [...ids];
  }

  /** Average world position of a set of effector bones. */
  function avgWorld(ids: string[]): THREE.Vector3 {
    const p = new THREE.Vector3();
    let n = 0;
    for (const id of ids) {
      const node = mannequin.bones.get(id);
      if (!node) continue;
      p.add(node.getWorldPosition(new THREE.Vector3()));
      n++;
    }
    return n > 0 ? p.multiplyScalar(1 / n) : p;
  }

  const ROOT_X = new THREE.Vector3(1, 0, 0);

  /** Rotate the whole figure about a world-space pivot (axis through pivot). */
  function rotateRootAboutPivot(pivot: THREE.Vector3, angle: number): void {
    const q = new THREE.Quaternion().setFromAxisAngle(ROOT_X, angle);
    mannequin.root.position.sub(pivot).applyQuaternion(q).add(pivot);
    mannequin.root.quaternion.premultiply(q);
    mannequin.root.updateMatrixWorld(true);
  }

  /**
   * Ground-lock = floating-root contact solving, tuned per support type:
   *
   * - **Hands + feet (push-up / plank):** pivot the whole rigid body about the
   *   foot line (the toes stay planted) until the hands reach the floor. As the
   *   elbows fold (FK), the hands rise toward the shoulders, so the body tips
   *   down around the toes — the torso lowers in one straight line, a real
   *   push-up. Rotating about an X-axis through the foot midpoint keeps both
   *   feet exactly planted (they differ from the pivot only along X).
   * - **Feet only (squat / roll-down):** drop the body vertically so the feet
   *   stay planted while the legs keep their authored FK bend — the pelvis
   *   lowers. Legs are never CCD-solved (that would overwrite the squat pose).
   */
  function applyGroundLock(active: string[]): void {
    if (active.length === 0) return;
    const ids = activeEffectorIds(active);
    const hands = ids.filter((id) => id.startsWith("wrist"));
    const feet = ids.filter((id) => id.startsWith("ankle"));

    if (hands.length > 0 && feet.length > 0) {
      const pivot = avgWorld(feet);
      // Newton iterations: rotate about the toes until avg hand height = 0.
      for (let i = 0; i < 8; i++) {
        const y0 = avgWorld(hands).y;
        if (Math.abs(y0) < 0.004) break;
        rotateRootAboutPivot(pivot, 0.01);
        const y1 = avgWorld(hands).y;
        rotateRootAboutPivot(pivot, -0.01);
        const deriv = (y1 - y0) / 0.01;
        if (Math.abs(deriv) < 1e-4) break;
        rotateRootAboutPivot(pivot, THREE.MathUtils.clamp(-y0 / deriv, -0.35, 0.35));
      }
      return;
    }

    if (feet.length > 0) {
      let sumY = 0;
      for (const id of feet) {
        const node = mannequin.bones.get(id);
        if (node) sumY += node.getWorldPosition(new THREE.Vector3()).y;
      }
      mannequin.root.position.y -= sumY / feet.length;
      mannequin.root.updateMatrixWorld(true);
    }
  }

  function frameCamera(): void {
    // Auto-frame the figure: fit its bounding box, keep a pleasant angle.
    const box = new THREE.Box3().setFromObject(mannequin.root);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    // Frame against a ~1.8m standing height floor so short poses (squat,
    // plank) don't zoom in awkwardly; fill most of the viewport.
    const radius = Math.max(size.x, size.y, size.z, 1.8) * 0.5;
    const dist = (radius / Math.sin((camera.fov * DEG) / 2)) * 1.15 + 0.3;

    desiredTarget.copy(center);
    desiredTarget.y = Math.max(center.y, 0.55);
    desiredPos.set(
      center.x + dist * 0.55,
      Math.max(center.y + radius * 0.5, 1.0),
      center.z + dist,
    );
    easeCamera = true;
  }

  function frame(): void {
    if (timeline) {
      const info = timeline.sample(time, mannequin.bones);
      mannequin.root.updateMatrixWorld(true);
      applyGroundLock(info.groundLock);
      if (info.phaseName !== lastPhaseName) {
        lastPhaseName = info.phaseName;
        phaseCb({ phaseName: info.phaseName, ...(info.cue ? { cue: info.cue } : {}) });
      }
    }
    if (easeCamera) {
      controls.target.lerp(desiredTarget, 0.07);
      camera.position.lerp(desiredPos, 0.07);
      if (camera.position.distanceToSquared(desiredPos) < 1e-4) easeCamera = false;
    }
    resize();
    controls.update();
    renderer.render(scene, camera);
  }

  let raf = 0;
  let lastT = performance.now();
  function loopFn(now: number): void {
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    if (playing && timeline) {
      time += dt * speed;
      if (time >= timeline.duration) {
        if (loop) {
          time %= timeline.duration;
          loopCb();
        } else {
          time = timeline.duration;
          playing = false;
        }
      }
      tickCb(time, timeline.duration);
    }
    frame();
    raf = requestAnimationFrame(loopFn);
  }
  raf = requestAnimationFrame(loopFn);

  const api: Viewer = {
    load(ir: MovitIR) {
      timeline = buildTimeline(ir);
      time = 0;
      lastPhaseName = "";
      // Reset every bone to rest — otherwise joints from a previous movement
      // that this document doesn't touch would persist (e.g. bent legs from a
      // squat showing under a biceps curl).
      for (const bone of mannequin.bones.values()) bone.quaternion.identity();
      applyBaseRoot();
      timeline.sample(0, mannequin.bones);
      mannequin.root.updateMatrixWorld(true);
      groundFigure();
      captureGroundTargets();
      frameCamera();
    },
    play() {
      playing = true;
      lastT = performance.now();
    },
    pause() {
      playing = false;
    },
    toggle() {
      playing = !playing;
      lastT = performance.now();
      return playing;
    },
    seek(seconds: number) {
      if (!timeline) return;
      time = THREE.MathUtils.clamp(seconds, 0, timeline.duration);
    },
    setSpeed(multiplier: number) {
      speed = Math.max(0.1, multiplier);
    },
    setLoop(v: boolean) {
      loop = v;
    },
    get playing() {
      return playing;
    },
    get duration() {
      return timeline?.duration ?? 0;
    },
    get time() {
      return time;
    },
    getTimeline() {
      if (!timeline) return null;
      return {
        duration: timeline.duration,
        repeat: timeline.repeat,
        segments: timeline.segments,
      };
    },
    onPhase(cb) {
      phaseCb = cb;
    },
    onTick(cb) {
      tickCb = cb;
    },
    onLoop(cb) {
      loopCb = cb;
    },
    dispose() {
      cancelAnimationFrame(raf);
      controls.dispose();
      renderer.dispose();
    },
  };
  return api;
}

function enableShadows(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });
}

export { buildMannequin } from "./mannequin.js";
export { buildTimeline } from "./timeline.js";
export { solveCCD } from "./ik.js";
export type { PhaseSegment } from "./timeline.js";

/**
 * posecode-render — public API.
 *
 * `createViewer(canvas)` sets up a Three.js studio scene with the procedural
 * mannequin and returns a controller. `load(ir)` builds a timeline from a parsed
 * PosecodeIR; the render loop applies forward kinematics each frame, then keeps
 * ground-locked contacts (hands/feet) planted via floating-root solving. The
 * camera auto-frames the figure and eases smoothly when a new movement loads.
 */

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { eulerRomFor } from "posecode-parser";
import type { PosecodeIR, ReachTarget, PinTarget } from "posecode-parser";
import { buildMannequin, type Mannequin } from "./mannequin.js";
import { applyGroundLock as applyGroundLockTo, groundFigure as groundFigureOf } from "./groundlock.js";
import { buildTimeline, type BuiltTimeline, type PhaseSegment } from "./timeline.js";
import { solveCCD, type JointLimits } from "./ik.js";
import { buildProps, type PropScene } from "./props.js";

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
  load(ir: PosecodeIR): void;
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
  /**
   * Render the current time synchronously and return the frame as a PNG data
   * URL. Works without preserveDrawingBuffer because the read happens in the
   * same task as the render (no buffer swap in between). Powers GIF/poster
   * export and headless capture tooling.
   */
  captureFrame(): string;
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
  // World-space anchor points contributed by scene props (chair seat, bar grip,
  // wall surface). Populated when a doc declares props; empty otherwise.
  let propAnchors = new Map<string, THREE.Vector3>();
  let propScene: PropScene | null = null;
  // The grounded base transform captured at load. Each frame resets the root to
  // this before ground-lock / pins / reach recompute, so those root adjustments
  // never accumulate across frames (and the body returns to base when a pin ends).
  const baseRootPos = new THREE.Vector3();
  const baseRootQuat = new THREE.Quaternion();
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

  // Reused scratch for the per-frame facing rotation (yaw about world Y).
  const WORLD_Y = new THREE.Vector3(0, 1, 0);
  const YAW_Q = new THREE.Quaternion();

  // Friendly DSL effector aliases → the distal bone whose world position is
  // driven to the reach target.
  const EFFECTOR_BONE: Record<string, string> = {
    hand_left: "wrist_left",
    hand_right: "wrist_right",
    foot_left: "ankle_left",
    foot_right: "ankle_right",
  };

  /**
   * The rotatable joint chain (proximal → distal) that moves an effector, with
   * each joint's ROM expressed as local Euler limits for the constrained solve.
   * A limit box is widened to include the joint's CURRENT (authored FK) angle:
   * the timeline pose is already ROM-clamped in author terms, but rig mechanics
   * such as the hip-hinge counter-rotation can place a bone outside its raw box
   * on purpose — IK must never fight the authored pose, only be prevented from
   * pushing beyond it.
   */
  function reachChain(effectorBone: string): {
    joints: THREE.Object3D[];
    limits: (JointLimits | null)[];
  } {
    const side = effectorBone.endsWith("_left") ? "left" : "right";
    const ids = effectorBone.startsWith("wrist")
      ? [`shoulder_${side}`, `elbow_${side}`]
      : effectorBone.startsWith("ankle")
        ? [`hip_${side}`, `knee_${side}`]
        : [];
    const joints: THREE.Object3D[] = [];
    const limits: (JointLimits | null)[] = [];
    for (const id of ids) {
      const node = mannequin.bones.get(id);
      if (!node) continue;
      joints.push(node);
      limits.push(jointLimitsFor(id, node));
    }
    return { joints, limits };
  }

  const REACH_EULER = new THREE.Euler();

  /** A bone's ROM as radian Euler limits, widened to admit its current pose. */
  function jointLimitsFor(boneId: string, node: THREE.Object3D): JointLimits | null {
    const rom = eulerRomFor(boneId);
    if (!rom) return null;
    REACH_EULER.setFromQuaternion(node.quaternion, "XYZ");
    return {
      x: widen(rom.x.min * DEG, rom.x.max * DEG, REACH_EULER.x),
      y: widen(rom.y.min * DEG, rom.y.max * DEG, REACH_EULER.y),
      z: widen(rom.z.min * DEG, rom.z.max * DEG, REACH_EULER.z),
    };
  }

  function widen(min: number, max: number, current: number): [number, number] {
    return [Math.min(min, current), Math.max(max, current)];
  }

  /** Resolve a reach target name to a world point: floor / prop anchor / landmark. */
  function resolveReachTarget(
    target: string,
    effector: THREE.Object3D,
  ): THREE.Vector3 | null {
    if (target === "floor") {
      const p = effector.getWorldPosition(new THREE.Vector3());
      p.y = 0;
      return p;
    }
    const anchor = propAnchors.get(target);
    if (anchor) return anchor.clone();
    const bone = mannequin.bones.get(target);
    if (bone) return bone.getWorldPosition(new THREE.Vector3());
    return null;
  }

  /**
   * Reach-IK: drive each active effector to its world target with ROM-
   * constrained CCD — the solved arm/leg obeys the same hard joint limits as
   * authored angles, so an unreachable target yields the closest SAFE pose.
   * Runs AFTER ground-lock so landmark/floor targets are resolved against the
   * final root placement. The chain is the arm (hand) or the leg (foot); other
   * joints keep their authored FK pose.
   */
  function applyReaches(reaches: ReachTarget[]): void {
    for (const r of reaches) {
      const effectorBone = EFFECTOR_BONE[r.effector] ?? r.effector;
      const effector = mannequin.bones.get(effectorBone);
      if (!effector) continue;
      const target = resolveReachTarget(r.target, effector);
      if (!target) continue;
      const { joints, limits } = reachChain(effectorBone);
      if (joints.length === 0) continue;
      solveCCD({ joints, limits, effector, target }, 12);
    }
  }

  /**
   * Contact pins: translate the WHOLE figure so each pinned effector sits on its
   * anchor. Where ground-lock keeps a planted foot on the floor, a pin keeps a
   * hand on the bar or a foot on the box while the body moves relative to it —
   * so the figure hangs from a bar, pulls up toward it, rises onto a box, or
   * lowers into a dip as the limb joints work. Applied after ground-lock (which
   * pinned movements normally omit) and before reach-IK.
   */
  function applyPins(pins: PinTarget[]): void {
    if (pins.length === 0) return;
    const delta = new THREE.Vector3();
    let n = 0;
    for (const p of pins) {
      const effectorBone = EFFECTOR_BONE[p.effector] ?? p.effector;
      const effector = mannequin.bones.get(effectorBone);
      if (!effector) continue;
      const anchor = resolveReachTarget(p.anchor, effector);
      if (!anchor) continue;
      delta.add(anchor.sub(effector.getWorldPosition(new THREE.Vector3())));
      n++;
    }
    if (n > 0) {
      mannequin.root.position.add(delta.multiplyScalar(1 / n));
      mannequin.root.updateMatrixWorld(true);
    }
  }

  function frameCamera(): void {
    // Auto-frame the figure: fit its bounding box, keep a pleasant angle.
    // Include any scene prop too — a pull-up bar sits well above the figure's
    // head, and framing on the mannequin alone left it cropped out of view.
    const box = new THREE.Box3().setFromObject(mannequin.root);
    if (propScene) box.union(new THREE.Box3().setFromObject(propScene.group));
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    // Frame against a ~1.8m standing height floor so short poses (squat,
    // plank) don't zoom in awkwardly; fill most of the viewport. Traveling
    // movements (turn/travel) roam across the floor, so widen the frame by the
    // movement's travel extent to keep the figure in view the whole loop.
    const travel = timeline?.travelExtent ?? 0;
    const radius = Math.max(size.x, size.y, size.z, 1.8) * 0.5 + travel;
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
      // Recompute root contact from the grounded base each frame (no drift).
      mannequin.root.position.copy(baseRootPos);
      mannequin.root.quaternion.copy(baseRootQuat);
      // Spatial choreography: layer the phase's facing (yaw about world Y) and
      // ground travel (world X/Z) onto the base root BEFORE ground-lock. The
      // feet-only ground-lock only corrects the root's Y, so it composes with
      // travel (X/Z) and yaw without fighting them; the figure turns and steps
      // across the floor while its feet still rest on it.
      if (info.rootYaw !== 0) {
        YAW_Q.setFromAxisAngle(WORLD_Y, info.rootYaw);
        mannequin.root.quaternion.premultiply(YAW_Q);
      }
      mannequin.root.position.x += info.rootOffset.x;
      mannequin.root.position.z += info.rootOffset.z;
      mannequin.root.updateMatrixWorld(true);
      applyGroundLockTo(mannequin, info.groundLock);
      applyPins(info.pins);
      // Safety net: nothing above ever intentionally pushes part of the body
      // below the floor, so clamp the root up whenever the lowest point dips
      // below y=0 — a no-op whenever the pose is legitimately grounded or
      // elevated (bbox min already ≥ 0). This also catches phases with
      // neither ground-lock nor a pin (the root stays frozen at the base
      // pose's grounded height while FK animates freely on top of it, e.g. a
      // prone "superman" lift), and pinned phases where a fixed-height anchor
      // (a low chair seat) combined with static leg FK can otherwise let the
      // feet sink through the floor as the arms fold (e.g. a chair dip).
      mannequin.root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(mannequin.root);
      if (box.min.y < 0) {
        mannequin.root.position.y -= box.min.y;
        mannequin.root.updateMatrixWorld(true);
      }
      applyReaches(info.reaches);
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
    load(ir: PosecodeIR) {
      timeline = buildTimeline(ir);
      time = 0;
      lastPhaseName = "";
      // Scene props: tear down any previous set, build the declared ones, and
      // expose their anchors to reach-IK.
      if (propScene) {
        scene.remove(propScene.group);
        disposeTree(propScene.group);
      }
      propScene = ir.props.length > 0 ? buildProps(ir.props) : null;
      propAnchors = propScene?.anchors ?? new Map();
      if (propScene) {
        enableShadows(propScene.group);
        scene.add(propScene.group);
      }
      // Reset every bone to rest — otherwise joints from a previous movement
      // that this document doesn't touch would persist (e.g. bent legs from a
      // squat showing under a biceps curl).
      for (const bone of mannequin.bones.values()) bone.quaternion.identity();
      applyBaseRoot();
      timeline.sample(0, mannequin.bones);
      mannequin.root.updateMatrixWorld(true);
      groundFigureOf(mannequin);
      captureGroundTargets();
      baseRootPos.copy(mannequin.root.position);
      baseRootQuat.copy(mannequin.root.quaternion);
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
    captureFrame() {
      frame();
      return renderer.domElement.toDataURL("image/png");
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

/** Free GPU resources for a discarded subtree (prop set swapped on reload). */
function disposeTree(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.geometry?.dispose();
      const mat = mesh.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    }
  });
}

export { buildMannequin } from "./mannequin.js";
export { applyGroundLock, groundFigure } from "./groundlock.js";
export type { Mannequin } from "./mannequin.js";
export { buildTimeline } from "./timeline.js";
export { solveCCD, type IkChain, type JointLimits } from "./ik.js";
export { buildProps, type PropScene } from "./props.js";
export type { PhaseSegment } from "./timeline.js";

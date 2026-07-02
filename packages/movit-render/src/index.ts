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
import type { MovitIR, ReachTarget, PinTarget } from "movit-parser";
import { buildMannequin, type Mannequin } from "./mannequin.js";
import { buildTimeline, type BuiltTimeline, type PhaseSegment } from "./timeline.js";
import { solveCCD } from "./ik.js";
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
  /**
   * Synchronously pose and render one frame at the current time. Used by
   * exporters to capture deterministic frames: `seek(t); renderOnce();` then
   * read the canvas — no dependence on the RAF loop's timing.
   */
  renderOnce(): void;
  /**
   * Toggle the idle camera orbit. Exporters freeze it so a captured loop's
   * first and last frames share one camera angle (a seamless replay), then
   * restore it. Returns the previous value so callers can put it back.
   */
  setAutoRotate(v: boolean): boolean;
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
  // preserveDrawingBuffer keeps the last rendered frame readable from the
  // canvas (drawImage / toBlob) outside the render call — required by the
  // playground's GIF/video export compositor, negligible cost at this scene size.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
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

  // --- Aliveness layer state -------------------------------------------------
  // Follow-through: displayed bone rotations chase the sampled targets with a
  // small per-bone lag (deeper bones lag more), so limbs overlap naturally
  // instead of the whole body moving in robotic lockstep. `alivenessSnap` skips
  // the lag for one frame after load/seek so scrubbing stays frame-exact.
  const followQuats = new Map<string, THREE.Quaternion>();
  let alivenessSnap = true;
  let lastFrameNow = 0;
  // Weight shift: smoothed whole-body lean (radians) toward the planted foot.
  let leanAngle = 0;
  const LEAN_AXIS = new THREE.Vector3();
  const LEAN_PIVOT = new THREE.Vector3();
  const BREATH_Q = new THREE.Quaternion();

  /** Seconds of lag per bone: distal segments trail proximal ones slightly. */
  function followTau(boneId: string): number {
    if (/^(wrist|ankle|head)/.test(boneId)) return 0.085;
    if (/^(thumb|index|middle|ring|pinky)/.test(boneId)) return 0.105;
    if (/^(elbow|knee)/.test(boneId)) return 0.06;
    return 0.038; // pelvis, spine, chest, neck, shoulders, hips
  }

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
    // Drop the whole figure so its lowest point rests on the floor. Using the
    // mesh bounding-box min (not just hand/foot joints) means ANY pose grounds
    // correctly — standing/plank rest on feet/hands, while supine/prone/seated
    // poses rest on the back, chest, or glutes.
    mannequin.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(mannequin.root);
    if (Number.isFinite(box.min.y)) {
      mannequin.root.position.y -= box.min.y;
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
  // Reused scratch for the per-frame facing rotation (yaw about world Y).
  const WORLD_Y = new THREE.Vector3(0, 1, 0);
  const YAW_Q = new THREE.Quaternion();

  /** Rotate the whole figure about a world-space pivot (axis through pivot). */
  function rotateRootAboutPivot(
    pivot: THREE.Vector3,
    angle: number,
    axis: THREE.Vector3 = ROOT_X,
  ): void {
    const q = new THREE.Quaternion().setFromAxisAngle(axis, angle);
    mannequin.root.position.sub(pivot).applyQuaternion(q).add(pivot);
    mannequin.root.quaternion.premultiply(q);
    mannequin.root.updateMatrixWorld(true);
  }

  /** Max whole-body lean toward the planted foot, radians (~4°). */
  const MAX_LEAN = 0.07;

  /**
   * Weight shift: when one foot lifts (march, kick, single-leg balance, dance
   * steps), a real body moves its weight over the planted foot — a centred
   * pelvis under a raised leg reads as physically impossible. Lean the whole
   * figure about the planted ANKLE (pivoting there, so the planted foot never
   * skates) toward the support, proportional to how high the other foot lifts,
   * smoothed so the weight transfers gradually like a real step. Applies only
   * to standing-based movements (a tilted base — plank/supine/prone — has its
   * own support polygon) and never while pins carry the body (bar hangs).
   */
  function applyWeightShift(pinned: boolean, dt: number): void {
    let target = 0;
    const la = mannequin.bones.get("ankle_left");
    const ra = mannequin.bones.get("ankle_right");
    const [brx = 0, , brz = 0] = timeline?.basePose.root?.rotationDeg ?? [0, 0, 0];
    if (!pinned && la && ra && Math.abs(brx) < 10 && Math.abs(brz) < 10) {
      const lp = la.getWorldPosition(new THREE.Vector3());
      const rp = ra.getWorldPosition(new THREE.Vector3());
      const planted = lp.y <= rp.y ? lp : rp;
      const lifted = lp.y <= rp.y ? rp : lp;
      const diff = lifted.y - planted.y;
      // Direction from the lifted foot toward the planted one, flattened to the
      // ground plane; axis = UP × dir tips the body toward the planted side.
      LEAN_AXIS.set(planted.x - lifted.x, 0, planted.z - lifted.z);
      if (diff > 0.05 && planted.y < 0.15 && LEAN_AXIS.lengthSq() > 1e-6) {
        target = Math.min(1, (diff - 0.05) / 0.12) * MAX_LEAN;
        LEAN_AXIS.normalize();
        LEAN_AXIS.crossVectors(WORLD_Y, LEAN_AXIS);
        LEAN_PIVOT.copy(planted);
      }
    }
    const alpha = alivenessSnap ? 1 : 1 - Math.exp(-dt / 0.18);
    leanAngle += (target - leanAngle) * alpha;
    if (Math.abs(leanAngle) > 1e-3 && LEAN_AXIS.lengthSq() > 0.5) {
      rotateRootAboutPivot(LEAN_PIVOT, leanAngle, LEAN_AXIS);
    }
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
      // The loop above zeroes the WRIST BONE's height, but the visible hand
      // (wrist ball + forearm capsule) and foot (mesh box) extend a bit below
      // their bones, leaving the mesh sunk into the floor by that offset. Catch
      // it with one final rigid-body vertical nudge (rotation already set the
      // correct tilt; this only corrects the residual bone-vs-mesh gap).
      mannequin.root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(mannequin.root);
      if (box.min.y < 0) {
        mannequin.root.position.y -= box.min.y;
        mannequin.root.updateMatrixWorld(true);
      }
      return;
    }

    if (feet.length > 0) {
      // Ground the FOOT MESH's lowest point, not the ankle bone's origin — the
      // bone sits ~0.04m above the sole (foot box + capsule radius), so
      // anchoring the bone itself left the visible foot sunk into the floor.
      let minY = Infinity;
      for (const id of feet) {
        const node = mannequin.bones.get(id);
        if (!node) continue;
        const box = new THREE.Box3().setFromObject(node);
        if (Number.isFinite(box.min.y)) minY = Math.min(minY, box.min.y);
      }
      if (Number.isFinite(minY)) {
        mannequin.root.position.y -= minY;
        mannequin.root.updateMatrixWorld(true);
      }
    }
  }

  // Friendly DSL effector aliases → the distal bone whose world position is
  // driven to the reach target.
  const EFFECTOR_BONE: Record<string, string> = {
    hand_left: "wrist_left",
    hand_right: "wrist_right",
    foot_left: "ankle_left",
    foot_right: "ankle_right",
  };

  /** The rotatable joint chain (proximal → distal) that moves an effector. */
  function reachChain(effectorBone: string): THREE.Object3D[] {
    const side = effectorBone.endsWith("_left") ? "left" : "right";
    const ids = effectorBone.startsWith("wrist")
      ? [`shoulder_${side}`, `elbow_${side}`]
      : effectorBone.startsWith("ankle")
        ? [`hip_${side}`, `knee_${side}`]
        : [];
    return ids
      .map((id) => mannequin.bones.get(id))
      .filter((n): n is THREE.Object3D => !!n);
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
   * Reach-IK: drive each active effector to its world target with CCD. Runs
   * AFTER ground-lock so landmark/floor targets are resolved against the final
   * root placement. The chain is the arm (hand) or the leg (foot); other joints
   * keep their authored FK pose.
   */
  function applyReaches(reaches: ReachTarget[]): void {
    for (const r of reaches) {
      const effectorBone = EFFECTOR_BONE[r.effector] ?? r.effector;
      const effector = mannequin.bones.get(effectorBone);
      if (!effector) continue;
      const target = resolveReachTarget(r.target, effector);
      if (!target) continue;
      const joints = reachChain(effectorBone);
      if (joints.length === 0) continue;
      solveCCD({ joints, effector, target }, 12);
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
    const now = performance.now();
    const frameDt = lastFrameNow > 0 ? Math.min(0.05, (now - lastFrameNow) / 1000) : 0.016;
    lastFrameNow = now;
    if (timeline) {
      const info = timeline.sample(time, mannequin.bones);
      // Follow-through: chase the sampled pose with a small per-bone lag so
      // distal segments (hands, feet, head, fingers) trail the joints that
      // drive them — natural overlap instead of robotic lockstep. Snapped on
      // load/seek so the scrubber stays frame-exact, and when paused so a
      // still frame shows the authored pose.
      if (playing && !alivenessSnap) {
        for (const [id, bone] of mannequin.bones) {
          let fq = followQuats.get(id);
          if (!fq) {
            fq = bone.quaternion.clone();
            followQuats.set(id, fq);
          }
          const alpha = 1 - Math.exp(-frameDt / followTau(id));
          fq.slerp(bone.quaternion, alpha);
          bone.quaternion.copy(fq);
        }
      } else {
        for (const [id, bone] of mannequin.bones) {
          const fq = followQuats.get(id);
          if (fq) fq.copy(bone.quaternion);
          else followQuats.set(id, bone.quaternion.clone());
        }
      }
      // Breathing: a barely-visible sinusoidal chest tilt (~1° @ ~3.8s period)
      // so the figure reads as alive during holds. Imperceptible mid-movement;
      // during a plank it even reads as breathing under load. When the timeline
      // drives the chest, sample() has just reset it, so layering on top is
      // safe; when it doesn't, sample() never touches the bone, so the value
      // must be set absolutely — an in-place multiply would compound each frame.
      const chest = mannequin.bones.get("chest");
      if (chest) {
        BREATH_Q.setFromAxisAngle(ROOT_X, Math.sin(now * 0.00165) * 0.019);
        if (timeline.bonesUsed.includes("chest")) chest.quaternion.multiply(BREATH_Q);
        else chest.quaternion.copy(BREATH_Q);
      }
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
      applyWeightShift(info.pins.length > 0, frameDt);
      alivenessSnap = false;
      applyGroundLock(info.groundLock);
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
    load(ir: MovitIR) {
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
      groundFigure();
      captureGroundTargets();
      baseRootPos.copy(mannequin.root.position);
      baseRootQuat.copy(mannequin.root.quaternion);
      leanAngle = 0;
      alivenessSnap = true;
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
      // Scrubbing must be frame-exact: skip follow-through lag and land the
      // weight shift instantly at the sought pose.
      alivenessSnap = true;
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
    renderOnce() {
      frame();
    },
    setAutoRotate(v: boolean) {
      const prev = controls.autoRotate;
      controls.autoRotate = v;
      return prev;
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
export { buildTimeline } from "./timeline.js";
export { solveCCD } from "./ik.js";
export { buildProps, type PropScene } from "./props.js";
export type { PhaseSegment } from "./timeline.js";

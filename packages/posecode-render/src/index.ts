/**
 * posecode-render: public API.
 *
 * `createViewer(canvas)` sets up a Three.js studio scene with the procedural
 * mannequin and returns a controller. `load(ir)` builds a timeline from a parsed
 * PosecodeIR; the render loop applies forward kinematics each frame, then keeps
 * ground-locked contacts (hands/feet) planted via floating-root solving. The
 * camera auto-frames the figure and eases smoothly when a new movement loads.
 */

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { eulerRomFor } from "posecode-parser";
import type { PosecodeIR, ReachTarget, PinTarget, GripTarget } from "posecode-parser";
import { buildMannequin, type Mannequin } from "./mannequin.js";
import { applyGroundLock as applyGroundLockTo, groundFigure as groundFigureOf } from "./groundlock.js";
import { buildTimeline, type BuiltTimeline, type PhaseSegment } from "./timeline.js";
import { solveCCD, type JointLimits } from "./ik.js";
import { buildProps, type PropScene } from "./props.js";
import { loadCharacter, type Character } from "./character.js";
import {
  loadClipSource,
  retargetMocapClip,
  createClipLayer,
  type ClipLayer,
  type ClipSource,
} from "./clips.js";
import { depenetrate } from "./depenetrate.js";
import { alignFloorPalms, levelPlantedFeet, wrapGrip, relaxHands, swingArms, aimHead, orientBarGrips } from "./contacts.js";

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
  /** True once the skinned character (characterUrl) is loaded and visible. */
  get characterActive(): boolean;
  /** True while a retargeted mocap clip is driving (or fading over) the pose. */
  get clipActive(): boolean;
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
  /**
   * URL of a rigged human character GLB (Mixamo bone naming) to render instead
   * of the procedural figure. Loaded asynchronously; until it resolves — and if
   * it fails — the viewer shows the procedural figure, so a missing or slow
   * asset can never blank the scene. All solving still runs on the driver
   * skeleton, rebuilt to the character's exact proportions (see character.ts).
   */
  characterUrl?: string;
  /**
   * Mocap clip library: clip name (as written in a document's `clip "<name>"`
   * directive) → FBX/GLB asset URL. When a loaded document names a clip found
   * here and the skinned character is active, the viewer retargets the clip
   * onto the character and crossfades it over the procedural pose. Documents
   * naming clips absent from this map — and any load/retarget failure — play
   * the procedural keyframes as always, so clips can never blank a movement.
   */
  clips?: Record<string, string>;
  /**
   * Keep the procedural figure visible while a skinned `characterUrl` loads.
   * Defaults to `true` (the procedural figure poses the scene during the load,
   * matching callers that never set this). Set `false` alongside a
   * `characterUrl` to hide the procedural meshes until the character resolves —
   * so a page load shows the skinned figure or nothing, never a blink of the
   * crude procedural figure. On load failure the procedural figure is revealed
   * regardless, so the scene never stays blank.
   */
  showProceduralWhileLoading?: boolean;
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

  // Image-based environment light: soft bounced light that gives the matte
  // figure materials realistic shading gradients instead of flat CG plastic.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.35;
  pmrem.dispose();

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
  // Trimmed from 0.85 to keep exposure level after adding the environment map.
  const hemi = new THREE.HemisphereLight(0xdfe9ff, 0x20242c, 0.6);
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

  // When a skinned character is requested and the caller opted out of the
  // procedural fallback during load, hide the procedural meshes up front so the
  // crude figure never flashes for the character's fetch time on a page load.
  // The skeleton still drives animation and grounding; only the meshes hide
  // (same as the post-load swap). Revealed again if the character fails to load.
  const deferProceduralMeshes =
    Boolean(opts.characterUrl) && opts.showProceduralWhileLoading === false;
  if (deferProceduralMeshes) setMeshVisibility(mannequin.root, false);

  // Skinned character layer (optional). While loading (and on failure) the
  // procedural figure stays — unless deferred above; once ready, the driver
  // skeleton is rebuilt with the character's proportions, its meshes are hidden
  // (they keep feeding the bounding-box grounding), and the character mirrors it
  // every frame.
  let character: Character | null = null;

  // Mocap-clip layer (optional, character-only). When the loaded document
  // names a clip present in opts.clips, the asset is fetched once, retargeted
  // onto the character skeleton, and crossfaded over the procedural pose. The
  // weight eases toward its target each frame, so switching documents (or a
  // clip arriving mid-play) fades rather than pops; every failure path leaves
  // the procedural keyframes driving the figure.
  const CLIP_FADE_PER_SEC = 2.5; // full crossfade in ~0.4s
  let clipLayer: ClipLayer | null = null;
  let clipLayerName: string | null = null;
  let clipWeight = 0;
  let clipTargetWeight = 0;
  let clipToken = 0;
  const clipSources = new Map<string, Promise<ClipSource>>();

  /** (Re)aim the clip layer at the current document's `clip` request. */
  function requestClip(ir: PosecodeIR | null): void {
    clipToken++;
    const token = clipToken;
    const name = ir?.clip;
    const url = name ? opts.clips?.[name] : undefined;
    if (!name || !url || !character?.skinnedMesh) {
      clipTargetWeight = 0;
      return;
    }
    if (clipLayerName === name && clipLayer) {
      clipTargetWeight = 1;
      return;
    }
    clipTargetWeight = 0; // fade out whatever plays while the new clip loads
    let source = clipSources.get(url);
    if (!source) {
      source = loadClipSource(url);
      clipSources.set(url, source);
    }
    source
      .then((src) => {
        const mesh = character?.skinnedMesh;
        if (token !== clipToken || !mesh || !character) return;
        const retargeted = retargetMocapClip(mesh, src.root, src.clip);
        clipLayer?.dispose();
        clipLayer = createClipLayer(mesh, retargeted, character.drivenNodes);
        clipLayerName = name;
        clipWeight = 0;
        clipTargetWeight = 1;
      })
      .catch(() => {
        // Missing/broken clip asset: the procedural keyframes keep playing.
        // Deliberately silent, matching the characterUrl fallback.
        clipSources.delete(url);
      });
  }

  // --- Life layer: breathing + blinking so the figure reads as alive even
  // when the movement is paused. Both are MESH-only effects. Breathing must
  // never rotate skeleton bones: an earlier version breathed via tiny
  // chest/spine rotations, but those ran before ground-lock/pin solving,
  // which translated the whole figure to re-plant the displaced hands/feet,
  // so every movement visibly swayed and the head bobbed. Swelling the
  // ribcage mesh cannot disturb any joint, so authored poses stay exact.
  const BREATH_PERIOD = 3.8; // seconds per breath cycle
  const BLINK_DURATION = 0.13;
  let eyes = ["eye_left", "eye_right"]
    .map((n) => mannequin.root.getObjectByName(n))
    .filter((o): o is THREE.Object3D => Boolean(o));
  let ribcage = mannequin.root.getObjectByName("ribcage");
  let ribcageRestScale = ribcage ? ribcage.scale.clone() : null;
  let nextBlink = performance.now() / 1000 + 2;

  function applyLife(nowSec: number): void {
    if (ribcage && ribcageRestScale) {
      // 0..1 inhale fraction; the chest swells mostly front-to-back.
      const breath = 0.5 + 0.5 * Math.sin((nowSec * Math.PI * 2) / BREATH_PERIOD);
      ribcage.scale.set(
        ribcageRestScale.x * (1 + breath * 0.015),
        ribcageRestScale.y * (1 + breath * 0.01),
        ribcageRestScale.z * (1 + breath * 0.05),
      );
    }
    if (nowSec >= nextBlink + BLINK_DURATION) {
      nextBlink = nowSec + 2.5 + Math.random() * 3;
    }
    const closed = nowSec >= nextBlink && nowSec < nextBlink + BLINK_DURATION;
    for (const eye of eyes) eye.scale.y = closed ? 0.12 : 1;
  }

  let timeline: BuiltTimeline | null = null;
  // Finger bones the loaded document explicitly poses (make-a-fist, finger-spell,
  // hand-wave): the L4.1 resting-hand curl leaves these alone.
  let authoredFingers = new Set<string>();
  // Shoulders the document poses: L4.2 arm-swing leaves these to the author.
  let authoredShoulders = new Set<string>();
  // True when the document poses the head/neck: L4.3 look-at then stays off.
  let authoredHead = false;
  // The last loaded document, kept so the viewer can re-solve base pose and
  // ground anchors when the character (with its own proportions) arrives.
  let lastIR: PosecodeIR | null = null;
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
    // it, not drag it to y=0. groundFigure() already set the floor contact.
    groundTargets = new Map();
    frameAnchorMap.clear(); // drop anchors for effectors no longer captured
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

  // Per-frame ground anchors: the captured load-time effector positions,
  // carried along by the phase's yaw/travel so horizontal foot planting
  // composes with choreography instead of fighting it. Values are mutated in
  // place each frame; the map is rebuilt on load (captureGroundTargets).
  const frameAnchorMap = new Map<string, THREE.Vector3>();
  function frameAnchors(rootYaw: number, rootOffset: { x: number; z: number }): Map<string, THREE.Vector3> {
    for (const [id, captured] of groundTargets) {
      let v = frameAnchorMap.get(id);
      if (!v) {
        v = new THREE.Vector3();
        frameAnchorMap.set(id, v);
      }
      v.copy(captured);
      if (rootYaw !== 0) {
        // Yaw spins the body about the vertical axis through the root, so the
        // anchors must pivot with it (a quarter-turn carries the feet around).
        v.sub(baseRootPos).applyAxisAngle(WORLD_Y, rootYaw).add(baseRootPos);
      }
      v.x += rootOffset.x;
      v.z += rootOffset.z;
    }
    return frameAnchorMap;
  }

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
   * on purpose: IK must never fight the authored pose, only be prevented from
   * pushing beyond it.
   */
  function reachChain(effectorBone: string): {
    joints: THREE.Object3D[];
    limits: (JointLimits | null)[];
  } {
    const side = effectorBone.endsWith("_left") ? "left" : "right";
    const ids = effectorBone.startsWith("wrist")
      ? [`shoulder_${side}`, `elbow_${side}`]
      : effectorBone.startsWith("elbow")
        ? [`shoulder_${side}`]
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
      // Rest the effector's MESH on the floor, not its bone origin: the hand
      // mesh extends below the wrist bone, so a bone target of y=0 would sink
      // the palm and force the floor safety clamp to lift the whole body.
      const p = effector.getWorldPosition(new THREE.Vector3());
      const box = new THREE.Box3().setFromObject(effector);
      p.y = Number.isFinite(box.min.y) ? Math.max(0, p.y - box.min.y) : 0;
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
   * constrained CCD: the solved arm/leg obeys the same hard joint limits as
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
   * hand on the bar or a foot on the box while the body moves relative to it,
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

  /**
   * Bar grips: unlike a pin (body translate only), a grip makes each hand hold
   * the bar. (1) Translate the body by the average wrist→anchor delta — the
   * authored elbow flex raises the wrists, so the body rises: the pull-up. (2)
   * Per-hand arm IK drives each wrist exactly onto its own two-point anchor
   * (`bar_left`/`bar_right`), so the hands grip shoulder-width and the arms angle
   * naturally instead of pointing straight up. (3) Wrap the fingers round the bar.
   */
  function applyGrips(grips: GripTarget[]): void {
    if (grips.length === 0) return;
    const resolveGrip = (anchor: string, effector: THREE.Object3D): THREE.Vector3 | null =>
      resolveReachTarget(anchor, effector) ??
      resolveReachTarget(anchor.replace(/_(left|right)$/, ""), effector);
    // 1. Body translate (the vertical pull).
    const delta = new THREE.Vector3();
    let n = 0;
    for (const g of grips) {
      const effectorBone = EFFECTOR_BONE[g.effector] ?? g.effector;
      const effector = mannequin.bones.get(effectorBone);
      if (!effector) continue;
      const target = resolveGrip(g.anchor, effector);
      if (!target) continue;
      delta.add(target.clone().sub(effector.getWorldPosition(new THREE.Vector3())));
      n++;
    }
    if (n > 0) {
      mannequin.root.position.add(delta.multiplyScalar(1 / n));
      mannequin.root.updateMatrixWorld(true);
    }
    // 2. Per-hand arm IK onto each grip point (ROM-clamped via reachChain).
    for (const g of grips) {
      const effectorBone = EFFECTOR_BONE[g.effector] ?? g.effector;
      const effector = mannequin.bones.get(effectorBone);
      if (!effector) continue;
      const target = resolveGrip(g.anchor, effector);
      if (!target) continue;
      const { joints, limits } = reachChain(effectorBone);
      if (joints.length === 0) continue;
      solveCCD({ joints, limits, effector, target }, 12);
    }
    // 3. Resolve the wrist roll left underdetermined by positional arm IK.
    orientBarGrips(mannequin, grips);
    // 4. Finger wrap.
    wrapGrip(mannequin, grips);
  }

  /**
   * L4.3 look-at: turn the head toward the action. Collects the world points of
   * this phase's active grips/reaches (up at the bar, down at a floor reach) and
   * aims the head at their average. Skipped when the document poses the head/neck.
   */
  function applyLookAt(info: { grips: GripTarget[]; reaches: ReachTarget[] }): void {
    if (authoredHead) return;
    const pts: THREE.Vector3[] = [];
    const collect = (effectorName: string, anchorName: string): void => {
      const bone = EFFECTOR_BONE[effectorName] ?? effectorName;
      const eff = mannequin.bones.get(bone);
      if (!eff) return;
      const t =
        resolveReachTarget(anchorName, eff) ??
        resolveReachTarget(anchorName.replace(/_(left|right)$/, ""), eff);
      if (t) pts.push(t);
    };
    for (const g of info.grips) collect(g.effector, g.anchor);
    for (const r of info.reaches) collect(r.effector, r.target);
    if (pts.length === 0) return;
    const focus = new THREE.Vector3();
    for (const p of pts) focus.add(p);
    aimHead(mannequin, focus.multiplyScalar(1 / pts.length));
  }

  function frameCamera(): void {
    // Auto-frame the figure: fit its bounding box, keep a pleasant angle.
    // Include any scene prop too: a pull-up bar sits well above the figure's
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
      // Life layer rides on wall-clock time (not timeline time) so the figure
      // keeps breathing and blinking while paused or scrubbing.
      applyLife(performance.now() / 1000);
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
      // Self-collision: nudge limbs out of the body BEFORE contact solving so
      // ground-lock and pins see the corrected pose (same order as load()).
      depenetrate(mannequin);
      applyGroundLockTo(mannequin, info.groundLock, frameAnchors(info.rootYaw, info.rootOffset));
      applyPins(info.pins);
      applyGrips(info.grips);
      // Reach-IK BEFORE the floor safety clamp. When authored FK pushes a
      // reaching limb through the floor (cobra: prone + shoulders flex 50),
      // the limb must bend to meet the floor. Running reaches after the clamp
      // let the clamp "solve" the penetration first by hoisting the whole
      // rigid body into the air — legs floating, the classic levitating-cobra
      // bug. Ground-lock and pins have already fixed the root placement that
      // floor/landmark targets resolve against.
      applyReaches(info.reaches);
      alignFloorPalms(mannequin, info.reaches, info.pins, info.groundLock);
      // Plantigrade correction: keep planted soles flat to the floor so grounded
      // lower-body poses (squat, lunge, deadlift) don't balance on the toes.
      // Runs before the floor clamp so the leveled sole is what rests on y=0.
      levelPlantedFeet(mannequin, info.groundLock);
      // L4.2 aliveness: contralateral arm swing during locomotion (free arms only).
      swingArms(mannequin, authoredShoulders, gripSidesOf(info.grips));
      // L4.1 aliveness: relax idle hands into a natural curl (grips still wrap).
      relaxHands(
        mannequin,
        gripSidesOf(info.grips),
        authoredFingers,
        floorHandSidesOf(info.reaches, info.pins, info.groundLock),
      );
      // L4.3 aliveness: turn the head toward the active contact (bar / floor reach).
      applyLookAt(info);
      // Safety net: reconcile the fully-solved pose with the floor.
      //
      // A ground-locked phase asserts its effectors (feet, and for a plank the
      // forearms) are PLANTED, so its lowest mesh point must sit exactly on the
      // floor — clamp the root BOTH ways. This is essential because
      // levelPlantedFeet() rotates the ankle flat AFTER ground-lock dropped the
      // body, which lifts the sole a couple centimetres; an up-only clamp could
      // never recover it and the whole figure floated (squat, deadlift,
      // good-morning, forward-fold, plank, …).
      //
      // A phase with NO ground-lock may be intentionally airborne (a prone
      // "superman" lift, a jump), so it stays up-only: never yank a lifted body
      // down, only rescue parts that dip below y=0. Pinned phases with a
      // fixed-height anchor (a low chair seat) also rely on this up-only rescue
      // as the legs fold.
      mannequin.root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(mannequin.root);
      const planted = info.groundLock.length > 0;
      if (box.min.y < 0 || (planted && box.min.y > 0)) {
        mannequin.root.position.y -= box.min.y;
        mannequin.root.updateMatrixWorld(true);
      }
      if (info.phaseName !== lastPhaseName) {
        lastPhaseName = info.phaseName;
        phaseCb({ phaseName: info.phaseName, ...(info.cue ? { cue: info.cue } : {}) });
      }
    }
    // Mirror the fully-solved driver pose onto the skinned character.
    character?.sync(mannequin);
    // Mocap layer: ease the crossfade weight, then blend the retargeted clip
    // over the procedural pose sync() just wrote. Timeline time drives the
    // mixer so pause/scrub/export stay deterministic.
    if (character && clipLayer) {
      const step = frameDt * CLIP_FADE_PER_SEC;
      const gap = clipTargetWeight - clipWeight;
      clipWeight += Math.sign(gap) * Math.min(Math.abs(gap), step);
      clipLayer.apply(time, clipWeight);
      if (clipWeight > 0) character.group.updateMatrixWorld(true);
    }
    frameDt = 0;
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
  // Wall-clock delta consumed by frame() for the clip crossfade; zeroed after
  // each frame so captureFrame() renders without advancing the fade.
  let frameDt = 0;
  function loopFn(now: number): void {
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    frameDt = dt;
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
      lastIR = ir;
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
      // Reset every bone to rest: otherwise joints from a previous movement
      // that this document doesn't touch would persist (e.g. bent legs from a
      // squat showing under a biceps curl).
      for (const bone of mannequin.bones.values()) bone.quaternion.identity();
      applyBaseRoot();
      timeline.sample(0, mannequin.bones);
      mannequin.root.updateMatrixWorld(true);
      depenetrate(mannequin);
      groundFigureOf(mannequin);
      levelPlantedFeet(mannequin, ir.phases[0]?.groundLock ?? []);
      authoredFingers = new Set(timeline.bonesUsed.filter(isFingerId));
      authoredShoulders = new Set(timeline.bonesUsed.filter((id) => id.startsWith("shoulder_")));
      authoredHead = timeline.bonesUsed.some((id) => id === "head" || id === "neck");
      swingArms(mannequin, authoredShoulders, gripSidesOf(ir.phases[0]?.grips ?? []));
      relaxHands(
        mannequin,
        gripSidesOf(ir.phases[0]?.grips ?? []),
        authoredFingers,
        floorHandSidesOf(ir.phases[0]?.reaches ?? [], ir.phases[0]?.pins ?? [], ir.phases[0]?.groundLock ?? []),
      );
      applyLookAt({ grips: ir.phases[0]?.grips ?? [], reaches: ir.phases[0]?.reaches ?? [] });
      captureGroundTargets();
      baseRootPos.copy(mannequin.root.position);
      baseRootQuat.copy(mannequin.root.quaternion);
      requestClip(ir);
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
    get characterActive() {
      return character !== null;
    },
    get clipActive() {
      return clipLayer !== null && (clipWeight > 0 || clipTargetWeight > 0);
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
      clipLayer?.dispose();
      character?.dispose();
      renderer.dispose();
    },
  };

  // Kick off the character load (if requested). On success, swap the driver
  // skeleton for one congruent with the character, hide the procedural meshes
  // (still feeding the bounding-box grounding), and re-solve the current
  // document against the new proportions. On failure, the procedural figure
  // simply remains: the scene is never blank.
  if (opts.characterUrl) {
    void loadCharacter(opts.characterUrl)
      .then((char) => {
        scene.remove(mannequin.root);
        disposeTree(mannequin.root);
        mannequin = buildMannequin(undefined, char.proportions);
        setMeshVisibility(mannequin.root, false);
        scene.add(mannequin.root);
        scene.add(char.group);
        character = char;
        // The life layer's mesh handles died with the procedural figure.
        eyes = [];
        ribcage = undefined;
        ribcageRestScale = null;
        if (lastIR) api.load(lastIR);
        else char.sync(mannequin);
      })
      .catch(() => {
        // Character failed (offline embed, blocked/404 CDN): reveal the
        // procedural figure we may have hidden, so the scene degrades to the
        // working fallback instead of staying blank. Deliberately silent.
        if (deferProceduralMeshes) setMeshVisibility(mannequin.root, true);
      });
  }

  return api;
}

/**
 * Show or hide a figure's meshes. The skeleton keeps driving animation and
 * bounding-box grounding regardless, so hiding only the meshes lets a hidden
 * procedural figure still pose the scene while its character stand-in loads.
 */
function setMeshVisibility(root: THREE.Object3D, visible: boolean): void {
  root.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) obj.visible = visible;
  });
}

/** True for a finger bone id (thumb/index/middle/ring/pinky_left|right). */
function isFingerId(id: string): boolean {
  return /^(thumb|index|middle|ring|pinky)_/.test(id);
}

/** The hand sides ("left"/"right") gripping this phase, from its grip targets. */
function gripSidesOf(grips: readonly { effector: string }[]): Set<"left" | "right"> {
  const sides = new Set<"left" | "right">();
  for (const g of grips) {
    if (g.effector.endsWith("_left") || g.effector === "hands") sides.add("left");
    if (g.effector.endsWith("_right") || g.effector === "hands") sides.add("right");
  }
  return sides;
}

/**
 * Hand sides pressed onto the floor this phase — via `reach`/`pin: hands floor`
 * OR `ground-lock: hands` (a high plank / push-up / mountain-climber, where the
 * hands bear weight flat on the ground). Their fingers rest flat instead of
 * taking the idle inward hook, so the palm lies on the floor rather than
 * clawing into it. Ground-locked hands never carry a `floor` reach/pin, so
 * without the ground-lock check they were mis-read as free and hooked up.
 */
function floorHandSidesOf(
  reaches: readonly { effector: string; target: string }[],
  pins: readonly { effector: string; anchor: string }[],
  groundLock: readonly string[] = [],
): Set<"left" | "right"> {
  const sides = new Set<"left" | "right">();
  const add = (effector: string): void => {
    if (effector.endsWith("_left") || effector === "hands") sides.add("left");
    if (effector.endsWith("_right") || effector === "hands") sides.add("right");
  };
  for (const r of reaches) if (r.target === "floor") add(r.effector);
  for (const p of pins) if (p.anchor === "floor") add(p.effector);
  if (groundLock.includes("hands")) add("hands");
  return sides;
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
export type { Mannequin, Proportions, CollisionRadii } from "./mannequin.js";
export { buildTimeline } from "./timeline.js";
export { solveCCD, type IkChain, type JointLimits } from "./ik.js";
export { buildProps, type PropScene } from "./props.js";
export { loadCharacter, rigCharacter, type Character } from "./character.js";
export {
  loadClipSource,
  retargetMocapClip,
  createClipLayer,
  type ClipLayer,
  type ClipSource,
} from "./clips.js";
export { depenetrate } from "./depenetrate.js";
export { alignFloorPalms, levelPlantedFeet } from "./contacts.js";
export type { PhaseSegment } from "./timeline.js";

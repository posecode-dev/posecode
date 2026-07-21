/**
 * posecode-render: public API.
 *
 * `createViewer(canvas)` sets up a Three.js studio scene with the procedural
 * mannequin and returns a controller. `load(ir)` builds a timeline from a parsed
 * PosecodeIR; the render loop applies forward kinematics each frame, then keeps
 * ground-locked contacts (hands/forearms/feet/back) planted via floating-root
 * solving. The camera auto-frames the figure and eases smoothly when a new
 * movement loads.
 */

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { PosecodeIR, ReachTarget, PinTarget, GripTarget } from "posecode-parser";
import { buildMannequin, type Mannequin } from "./mannequin.js";
import { applyGroundLock as applyGroundLockTo, groundFigure as groundFigureOf } from "./groundlock.js";
import {
  buildTimeline,
  type BuiltTimeline,
  type PhaseSegment,
  type WeightedReachTarget,
} from "./timeline.js";
import {
  buildFloorGuideData,
  createFloorGuide,
  syncFloorGuideToSolvedRoot,
  type FloorGuideData,
  type FloorGuideInfo,
  type FloorGuideScene,
} from "./floor-guide.js";
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
import {
  measureConstraintDiagnostics,
  type ConstraintDiagnostic,
} from "./diagnostics.js";
import { resolvePropContacts, propContactExemptions } from "./propcontact.js";
import {
  alignFloorContacts,
  alignGripFrames,
  enforceContactRom,
  floorContactHeight,
  floorTargetForEffector,
  formFists,
  isDipBarGrip,
  levelPlantedFeet,
  prepareGripFrames,
  wrapGrip,
  relaxHands,
  swingArms,
  aimHead,
} from "./contacts.js";
import {
  REACH_TOLERANCE,
  effectorBoneId,
  missingReachTarget,
  reachChain,
  solveReachToPoint,
  type ReachResidual,
} from "./reach.js";
import { solveCCD } from "./ik.js";

const DEG = Math.PI / 180;
/** Live diagnostics match the playground warning refresh cadence (~5Hz). */
const CONSTRAINT_DIAGNOSTIC_INTERVAL_MS = 200;

export interface ViewerPhaseInfo {
  /** Zero-based real phase index, or -1 while blending through loop reset. */
  phaseIndex: number;
  phaseName: string;
  /** Display-only coaching text from the phase; it never drives the animation. */
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
  /** Floor scale/orientation and authored root-path metadata for the loaded clip. */
  getFloorGuideInfo(): FloorGuideInfo | null;
  /** Diagnostics for every active reach, including missing/unreachable targets. */
  getReachResiduals(): readonly ReachResidual[];
  /** Procedural-driver grounding/collision outcomes, before optional skin/mocap reconciliation. */
  getConstraintDiagnostics(): readonly ConstraintDiagnostic[];
  /** Precise visible world bounds; intended for audits and deterministic export. */
  getVisibleBounds(): THREE.Box3;
  getMannequin(): any;
  getCharacter(): any;
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
   * Show the metric floor, load origin, live facing arrow, and authored travel
   * path. Defaults to true; set false for a completely clean embed.
   */
  floorGuide?: boolean;
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
      clipWeight = 0;
      clipLayer?.dispose();
      clipLayer = null;
      clipLayerName = null;
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
  const floorGuideEnabled = opts.floorGuide ?? true;
  let floorGuideData: FloorGuideData | null = null;
  let floorGuide: FloorGuideScene | null = null;
  // True for a GAIT clip: it authors root travel AND alternates its floor
  // foot-pins between both feet (box-step, grapevine, chassé, walk). There a
  // floor foot-pin is a STANCE foot — the body travels to its authored waypoint
  // while the leg reaches back to keep the foot planted. A same-foot travel pin
  // (a forward lunge's weight-shift) or a vertical support (pull-up bar, box)
  // still translates the whole body onto its anchor.
  let clipIsGait = false;
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
  // Rebuilt on every solved frame. Missing target names and unreachable
  // effectors remain visible here instead of disappearing behind `continue`.
  let reachResiduals: ReachResidual[] = [];
  let constraintDiagnostics: ConstraintDiagnostic[] = [];
  let constraintDiagnosticsDirty = true;
  let lastConstraintDiagnosticsAt = -Infinity;
  type ReachResidualTarget =
    | { kind: "fixed"; point: THREE.Vector3 }
    | { kind: "floor"; point: THREE.Vector3 }
    | { kind: "landmark"; boneId: string };
  let reachResidualTargets: Array<ReachResidualTarget | null> = [];
  let groundTargets = new Map<string, THREE.Vector3>();
  const segmentStartEffectors: Map<string, THREE.Vector3>[] = [];
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
  let lastPhaseIndex = -2;
  let activeSegIndex = 0;
  // `load()` briefly solves each real phase endpoint to seed any floor pin
  // introduced by the following phase from the *fully solved* prior pose.
  // Keep those internal solves out of callbacks, character/mocap state, and
  // the canvas; they are deterministic anchor preparation, not visible frames.
  let precomputingAnchors = false;

  function refreshConstraintDiagnostics(
    info: ReturnType<NonNullable<typeof timeline>["sample"]>,
  ): void {
    if (precomputingAnchors) return;
    const now = performance.now();
    if (!constraintDiagnosticsDirty) {
      if (!playing || now - lastConstraintDiagnosticsAt < CONSTRAINT_DIAGNOSTIC_INTERVAL_MS) return;
    }
    constraintDiagnostics = measureConstraintDiagnostics(
      mannequin,
      info.groundLock,
      info.pins,
    );
    constraintDiagnosticsDirty = false;
    lastConstraintDiagnosticsAt = now;
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

  /** Resolve a reach target name to a world point: floor / prop anchor / landmark. */
  function resolveReachTarget(
    target: string,
    effectorName: string,
  ): THREE.Vector3 | null {
    if (target === "floor") return floorTargetForEffector(mannequin, effectorName);
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
  function applyReaches(reaches: WeightedReachTarget[]): void {
    reachResiduals = [];
    reachResidualTargets = [];
    for (const r of reaches) {
      const effectorBone = effectorBoneId(r.effector);
      const effector = mannequin.bones.get(effectorBone);
      if (!effector) {
        reachResiduals.push(
          solveReachToPoint(mannequin, r.effector, r.target, new THREE.Vector3(), r.weight),
        );
        reachResidualTargets.push(null);
        continue;
      }
      const target = resolveReachTarget(r.target, r.effector);
      if (!target) {
        reachResiduals.push(missingReachTarget(r.effector, r.target, r.weight));
        reachResidualTargets.push(null);
        continue;
      }
      reachResiduals.push(
        solveReachToPoint(mannequin, r.effector, r.target, target, r.weight),
      );
      reachResidualTargets.push(
        r.target === "floor"
          ? { kind: "floor", point: target.clone() }
          : mannequin.bones.has(r.target)
            ? { kind: "landmark", boneId: r.target }
            : { kind: "fixed", point: target.clone() },
      );
    }
  }

  /** Re-measure after later contacts/root grounding so diagnostics are final. */
  function refreshReachResiduals(): void {
    reachResiduals = reachResiduals.map((residual, index) => {
      const targetRef = reachResidualTargets[index];
      if (!targetRef || residual.distance === null) return residual;
      const effector = mannequin.bones.get(effectorBoneId(residual.effector));
      if (!effector) return residual;
      // Body landmarks and contact surfaces can move during later root/contact
      // reconciliation. Re-read their final geometry while preserving a floor
      // contact's solved world-space X/Z anchor.
      const point = effector.getWorldPosition(new THREE.Vector3());
      let target: THREE.Vector3 | undefined;
      if (targetRef.kind === "fixed") {
        target = targetRef.point;
      } else if (targetRef.kind === "landmark") {
        target = mannequin.bones.get(targetRef.boneId)?.getWorldPosition(new THREE.Vector3());
      } else {
        const height = floorContactHeight(mannequin, residual.effector);
        if (height !== null) target = targetRef.point.clone().setY(point.y - height);
      }
      if (!target) return residual;
      const distance = point.distanceTo(target);
      return { ...residual, distance, reached: distance <= REACH_TOLERANCE };
    });
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
    const dipBarPins = pins.filter((pin) => isDipBarGrip(pin.anchor));
    prepareGripFrames(mannequin, dipBarPins);
    const delta = new THREE.Vector3();
    let n = 0;
    // Stance-foot plants solved by leg IK after the body reaches its waypoint,
    // rather than by translating the body onto the anchor (which cancels travel).
    const stancePlants: { effector: string; anchor: THREE.Vector3 }[] = [];
    for (const p of pins) {
      const effectorBone = effectorBoneId(p.effector);
      const effector = mannequin.bones.get(effectorBone);
      if (!effector) continue;
      let anchor: THREE.Vector3 | null = null;
      if (p.anchor === "floor") {
        const startPos = segmentStartEffectors[activeSegIndex]?.get(effectorBone);
        if (startPos) {
          anchor = startPos.clone();
          anchor.y = floorTargetForEffector(mannequin, p.effector)?.y ?? 0;
        } else {
          anchor = resolveReachTarget(p.anchor, p.effector);
        }
      } else {
        anchor = resolveReachTarget(p.anchor, p.effector);
      }
      if (!anchor) continue;
      if (clipIsGait && p.anchor === "floor" && effectorBone.startsWith("ankle_")) {
        stancePlants.push({ effector: p.effector, anchor });
        continue;
      }
      delta.add(anchor.sub(effector.getWorldPosition(new THREE.Vector3())));
      n++;
    }
    if (n > 0) {
      mannequin.root.position.add(delta.multiplyScalar(1 / n));
      mannequin.root.updateMatrixWorld(true);
    }
    // Keep each stance foot on its plant while the travelled root stays put: the
    // leg reaches back to the fixed floor anchor, so the figure steps across the
    // floor instead of marching in place.
    for (const plant of stancePlants) {
      solveReachToPoint(mannequin, plant.effector, "floor", plant.anchor, 1);
    }
    alignGripFrames(mannequin, dipBarPins);
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
    // Dip support begins from a deterministic untwisted forearm frame; doing
    // this before translation/IK means the later wrist target remains exact.
    prepareGripFrames(mannequin, grips);
    const resolveGrip = (anchor: string, effectorName: string): THREE.Vector3 | null =>
      resolveReachTarget(anchor, effectorName) ??
      resolveReachTarget(anchor.replace(/_(left|right)$/, ""), effectorName);
    // 1. Body translate (the vertical pull).
    const delta = new THREE.Vector3();
    let n = 0;
    for (const g of grips) {
      const effectorBone = effectorBoneId(g.effector);
      const effector = mannequin.bones.get(effectorBone);
      if (!effector) continue;
      const target = resolveGrip(g.anchor, g.effector);
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
      const effectorBone = effectorBoneId(g.effector);
      const effector = mannequin.bones.get(effectorBone);
      if (!effector) continue;
      const target = resolveGrip(g.anchor, g.effector);
      if (!target) continue;
      const { joints, limits } = reachChain(mannequin, g.effector);
      if (joints.length === 0) continue;
      if (isDipBarGrip(g.anchor)) {
        // Keep forearm twist stable while CCD positions the hand. Otherwise
        // equally-valid axial solutions flip palms between/away from the rails.
        for (let i = 0; i < joints.length; i++) {
          if (!joints[i]!.name.startsWith("elbow_")) continue;
          const limit = limits[i];
          if (limit) limits[i] = { ...limit, y: [0, 0] };
        }
      }
      solveCCD({ joints, limits, effector, target }, 12);
    }
    // 3. Stable contact frame followed by an anatomically signed finger wrap.
    alignGripFrames(mannequin, grips);
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
      const bone = effectorBoneId(effectorName);
      const eff = mannequin.bones.get(bone);
      if (!eff) return;
      const t =
        resolveReachTarget(anchorName, effectorName) ??
        resolveReachTarget(anchorName.replace(/_(left|right)$/, ""), effectorName);
      if (t) pts.push(t);
    };
    for (const g of info.grips) collect(g.effector, g.anchor);
    for (const r of info.reaches) collect(r.effector, r.target);
    if (pts.length === 0) return;
    const focus = new THREE.Vector3();
    for (const p of pts) focus.add(p);
    aimHead(mannequin, focus.multiplyScalar(1 / pts.length));
  }

  /** Prop-contact exemptions for a phase: limbs pinned/gripped/reached to props. */
  function contactExemptionsOf(info: {
    pins?: readonly PinTarget[];
    grips?: readonly GripTarget[];
    reaches?: readonly ReachTarget[];
  }): ReturnType<typeof propContactExemptions> {
    return propContactExemptions([
      ...(info.pins ?? []),
      ...(info.grips ?? []),
      ...(info.reaches ?? []).map((r) => ({ effector: r.effector, anchor: r.target })),
    ]);
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
    let solvedInfo: ReturnType<NonNullable<typeof timeline>["sample"]> | null = null;
    if (timeline) {
      const info = timeline.sample(time, mannequin.bones);
      solvedInfo = info;
      activeSegIndex = info.phaseIndex >= 0 ? info.phaseIndex : 0;
      // Life layer rides on wall-clock time (not timeline time) so the figure
      // keeps breathing and blinking while paused or scrubbing.
      if (!precomputingAnchors) applyLife(performance.now() / 1000);
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
      // A semantic fist is geometry as well as an endpoint name. Close any
      // unauthored digits before floor target/bounds resolution; authored curl
      // remains untouched and survives the later wrist contact correction.
      const fistSides = fistSidesOf(info.reaches, info.pins, info.groundLock);
      const activeGripSides = gripSidesOf(info.grips);
      const constrainedHandSides = contactHandSidesOf(
        info.reaches,
        info.pins,
        info.grips,
        info.groundLock,
      );
      const palmFloorSides = floorHandSidesOf(info.reaches, info.pins, info.groundLock);
      formFists(mannequin, fistSides, authoredFingers);
      // Finger surface shape is part of a floor target too. Flatten palms (and
      // relax free hands) before measuring their subtree bounds; fist/grip
      // sides are protected from this pass.
      relaxHands(
        mannequin,
        unionHandSides(activeGripSides, fistSides),
        authoredFingers,
        palmFloorSides,
      );
      // Establish the intended palm/knuckle surface BEFORE any floor target is
      // measured. The post-IK pass below restores the same frame after parent
      // joints move, keeping contact-surface height consistent at both ends.
      alignFloorContacts(mannequin, info.reaches, info.pins, info.groundLock);
      // Self-collision: nudge limbs out of the body BEFORE contact solving so
      // ground-lock and pins see the corrected pose (same order as load()).
      depenetrate(mannequin);
      applyGroundLockTo(mannequin, info.groundLock, frameAnchors(info.rootYaw, info.rootOffset));
      applyPins(info.pins);
      applyGrips(info.grips);
      // Props are solid: after the root solvers place the body, push it back
      // out of any prop face it crossed (wall-sit slides down the wall's
      // surface, not through it) and bend swing legs clear of box edges.
      // Before reach-IK so a later root push can't drag reached hands off
      // their world targets. Limbs pinned/gripped to a prop anchor are that
      // phase's declared support, exempt from clearing.
      if (propScene) {
        resolvePropContacts(mannequin, propScene.colliders, contactExemptionsOf(info));
      }
      // Reach-IK BEFORE the floor safety clamp. When authored FK pushes a
      // reaching limb through the floor (cobra: prone + shoulders flex 50),
      // the limb must bend to meet the floor. Running reaches after the clamp
      // let the clamp "solve" the penetration first by hoisting the whole
      // rigid body into the air — legs floating, the classic levitating-cobra
      // bug. Ground-lock and pins have already fixed the root placement that
      // floor/landmark targets resolve against.
      applyReaches(info.reaches);
      alignFloorContacts(mannequin, info.reaches, info.pins, info.groundLock);
      // Plantigrade correction: keep planted soles flat to the floor so grounded
      // lower-body poses (squat, lunge, deadlift) don't balance on the toes.
      // Runs before the floor clamp so the leveled sole is what rests on y=0.
      levelPlantedFeet(mannequin, info.groundLock);
      // L4.2 aliveness: contralateral arm swing during locomotion (free arms only).
      swingArms(mannequin, authoredShoulders, constrainedHandSides);
      // L4.3 aliveness: turn the head toward the active contact (bar / floor reach).
      applyLookAt(info);
      // Final renderer-authored contact mutations stay inside strict terminal
      // ROM (notably wrist and every ankle axis, including locked ankle Y/Z).
      enforceContactRom(mannequin);
      // A floor reach can change a limb after floating-root ground-lock has
      // placed the existing supports. Reconcile once more in constraint order:
      // replant the root support, then re-solve the independent limbs. Without
      // this bounded refinement, the global floor safety clamp could rescue a
      // reached knee/hand by lifting the declared planted foot several cm.
      if (info.groundLock.length > 0 && info.reaches.length > 0) {
        for (let refinement = 0; refinement < 3; refinement++) {
          applyGroundLockTo(
            mannequin,
            info.groundLock,
            frameAnchors(info.rootYaw, info.rootOffset),
          );
          applyReaches(info.reaches);
          alignFloorContacts(mannequin, info.reaches, info.pins, info.groundLock);
          enforceContactRom(mannequin);
        }
      }
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
      // Explicit elevated support is the opt-out: bar grips and non-floor pins
      // (box/chair) preserve their solved height. Everything else remains
      // floor-bound; airborne choreography should use a future explicit flight
      // contact rather than arise accidentally from missing `ground-lock`.
      mannequin.root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(mannequin.root);
      // Unless an elevated prop/grip is carrying the body, the movement is
      // floor-bound even when the author omitted `ground-lock`. This prevents
      // ordinary curls, lunges, stretches, and transitions from inheriting a
      // floating root when their FK pose raises the previous lowest point.
      const floorBound = isFloorBound(info);
      if (box.min.y < 0 || (floorBound && box.min.y > 0)) {
        mannequin.root.position.y -= box.min.y;
        mannequin.root.updateMatrixWorld(true);
      }
      refreshReachResiduals();
      refreshConstraintDiagnostics(info);
      // Root/contact solvers can translate X/Z beyond the authored travel
      // offset (pins, grips, and solid-prop correction). Keep the live floor
      // marker on the final rendered root rather than the pre-solve target.
      if (!precomputingAnchors && floorGuide) {
        syncFloorGuideToSolvedRoot(
          floorGuide,
          mannequin.root.position,
          baseRootPos,
          info.rootYaw,
        );
      }
      if (!precomputingAnchors && info.phaseIndex !== lastPhaseIndex) {
        lastPhaseIndex = info.phaseIndex;
        phaseCb({
          phaseIndex: info.phaseIndex,
          phaseName: info.phaseName,
          ...(info.cue ? { cue: info.cue } : {}),
        });
      }
    }
    if (precomputingAnchors) return;
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
      if (clipWeight > 0) {
        character.group.updateMatrixWorld(true);
        // Mocap is layered after procedural grounding and can add hip/root bob
        // that lifts a planted foot. Restore declared terminal contacts on the
        // visible character without removing motion from unconstrained limbs.
        if (solvedInfo) character.correctContacts(mannequin, contactBoneIds(solvedInfo));
      }
    }
    // Final visible-surface grounding. The hidden driver uses calibrated proxy
    // geometry; a segmented skin can have a different lowest point as limbs
    // rotate. Reconcile the actual skinned surface after every animation layer.
    if (character && solvedInfo && isFloorBound(solvedInfo)) character.reconcileFloor();
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
          constraintDiagnosticsDirty = true;
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
      floorGuideData = buildFloorGuideData(ir, timeline);
      const pinnedFootSides = new Set<string>();
      for (const phase of ir.phases) {
        for (const pin of phase.pins ?? []) {
          if (pin.anchor !== "floor") continue;
          const bone = effectorBoneId(pin.effector);
          if (bone.startsWith("ankle_")) {
            pinnedFootSides.add(bone.endsWith("_left") ? "left" : "right");
          }
        }
      }
      clipIsGait = floorGuideData.hasTravel && pinnedFootSides.size >= 2;
      if (floorGuide) {
        scene.remove(floorGuide.group);
        floorGuide.dispose();
        floorGuide = null;
      }
      if (floorGuideEnabled) {
        floorGuide = createFloorGuide(floorGuideData);
        scene.add(floorGuide.group);
      }
      time = 0;
      lastPhaseIndex = -2;
      reachResiduals = [];
      constraintDiagnostics = [];
      constraintDiagnosticsDirty = true;
      lastConstraintDiagnosticsAt = -Infinity;
      reachResidualTargets = [];
      authoredFingers = new Set(timeline.bonesUsed.filter(isFingerId));
      authoredShoulders = new Set(timeline.bonesUsed.filter((id) => id.startsWith("shoulder_")));
      authoredHead = timeline.bonesUsed.some((id) => id === "head" || id === "neck");
      const initialPhase = ir.phases[0];
      const initialFistSides = fistSidesOf(
        initialPhase?.reaches ?? [],
        initialPhase?.pins ?? [],
        initialPhase?.groundLock ?? [],
      );
      const initialGripSides = gripSidesOf(initialPhase?.grips ?? []);
      const initialConstrainedHandSides = contactHandSidesOf(
        initialPhase?.reaches ?? [],
        initialPhase?.pins ?? [],
        initialPhase?.grips ?? [],
        initialPhase?.groundLock ?? [],
      );
      const initialPalmFloorSides = floorHandSidesOf(
        initialPhase?.reaches ?? [],
        initialPhase?.pins ?? [],
        initialPhase?.groundLock ?? [],
      );
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
      formFists(mannequin, initialFistSides, authoredFingers);
      relaxHands(
        mannequin,
        unionHandSides(initialGripSides, initialFistSides),
        authoredFingers,
        initialPalmFloorSides,
      );
      alignFloorContacts(
        mannequin,
        initialPhase?.reaches ?? [],
        initialPhase?.pins ?? [],
        initialPhase?.groundLock ?? [],
      );
      depenetrate(mannequin);
      groundFigureOf(mannequin);
      if (propScene) {
        resolvePropContacts(mannequin, propScene.colliders, contactExemptionsOf(ir.phases[0] ?? {}));
      }
      levelPlantedFeet(mannequin, ir.phases[0]?.groundLock ?? []);
      swingArms(mannequin, authoredShoulders, initialConstrainedHandSides);
      applyLookAt({ grips: ir.phases[0]?.grips ?? [], reaches: ir.phases[0]?.reaches ?? [] });
      enforceContactRom(mannequin);
      captureGroundTargets();
      baseRootPos.copy(mannequin.root.position);
      baseRootQuat.copy(mannequin.root.quaternion);
      floorGuide?.setOrigin(baseRootPos.x, baseRootPos.z);
      floorGuide?.updateRoot({ x: 0, z: 0 }, 0);

      // Precompute world positions of all effectors at start of each segment
      segmentStartEffectors.length = 0;
      if (timeline) {
        let prevEffectorsMap: Map<string, THREE.Vector3> | null = null;
        let prevPins: PinTarget[] = [];
        for (let i = 0; i < timeline.segments.length; i++) {
          const seg = timeline.segments[i]!;
          for (const bone of mannequin.bones.values()) bone.quaternion.identity();
          const info = timeline.sample(seg.start, mannequin.bones);
          
          const wasPinned = (id: string) => prevPins.some(p => effectorBoneId(p.effector) === id && p.anchor === "floor");
          const isPinned = (id: string) => info.pins.some(p => effectorBoneId(p.effector) === id && p.anchor === "floor");

          mannequin.root.position.copy(baseRootPos);
          mannequin.root.quaternion.copy(baseRootQuat);
          if (info.rootYaw !== 0) {
            const yawQ = new THREE.Quaternion().setFromAxisAngle(WORLD_Y, info.rootYaw);
            mannequin.root.quaternion.premultiply(yawQ);
          }
          mannequin.root.position.x += info.rootOffset.x;
          mannequin.root.position.z += info.rootOffset.z;
          mannequin.root.updateMatrixWorld(true);
          depenetrate(mannequin);

          const effectorsMap = new Map<string, THREE.Vector3>();
          for (const ids of Object.values(mannequin.effectors)) {
            for (const id of ids) {
              const node = mannequin.bones.get(id);
              if (node) {
                if (i > 0 && wasPinned(id) && isPinned(id) && prevEffectorsMap && prevEffectorsMap.has(id)) {
                  effectorsMap.set(id, prevEffectorsMap.get(id)!);
                } else {
                  effectorsMap.set(id, node.getWorldPosition(new THREE.Vector3()));
                }
              }
            }
          }
          segmentStartEffectors.push(effectorsMap);
          prevEffectorsMap = effectorsMap;
          prevPins = info.pins;
        }

        // The raw FK pass above provides deterministic first-phase anchors,
        // but a pin introduced later must inherit the contact position from
        // the preceding phase *after* ground-lock, reach IK, ROM enforcement,
        // and floor reconciliation. Otherwise a ground-lock→pin handoff snaps
        // the whole body to the next phase's unsolved FK location (the original
        // superhero knee planted abruptly; bridge lowers jumped by ~60 cm).
        let previousSolvedEffectors: Map<string, THREE.Vector3> | null = null;
        const activeFloorPinTargets = new Map<string, THREE.Vector3>();
        precomputingAnchors = true;
        try {
          for (let i = 0; i < timeline.segments.length; i++) {
            const seg = timeline.segments[i]!;
            const currentPins = new Set(
              (ir.phases[i]?.pins ?? [])
                .filter((pin) => pin.anchor === "floor")
                .map((pin) => effectorBoneId(pin.effector)),
            );
            for (const id of [...activeFloorPinTargets.keys()]) {
              if (!currentPins.has(id)) activeFloorPinTargets.delete(id);
            }
            for (const id of currentPins) {
              let anchor = activeFloorPinTargets.get(id);
              if (!anchor) {
                anchor = previousSolvedEffectors?.get(id)?.clone()
                  ?? segmentStartEffectors[i]?.get(id)?.clone();
                if (anchor) activeFloorPinTargets.set(id, anchor);
              }
              if (anchor) segmentStartEffectors[i]?.set(id, anchor.clone());
            }

            // Stay inside the segment because sample(duration) wraps to zero.
            time = Math.max(seg.start, seg.end - 1e-5);
            frame();
            previousSolvedEffectors = new Map();
            for (const ids of Object.values(mannequin.effectors)) {
              for (const id of ids) {
                const node = mannequin.bones.get(id);
                if (node) previousSolvedEffectors.set(id, node.getWorldPosition(new THREE.Vector3()));
              }
            }
          }
        } finally {
          precomputingAnchors = false;
          time = 0;
        }

        // Restore initial pose
        for (const bone of mannequin.bones.values()) bone.quaternion.identity();
        applyBaseRoot();
        timeline.sample(0, mannequin.bones);
        formFists(mannequin, initialFistSides, authoredFingers);
        relaxHands(
          mannequin,
          unionHandSides(initialGripSides, initialFistSides),
          authoredFingers,
          initialPalmFloorSides,
        );
        alignFloorContacts(
          mannequin,
          initialPhase?.reaches ?? [],
          initialPhase?.pins ?? [],
          initialPhase?.groundLock ?? [],
        );
        mannequin.root.position.copy(baseRootPos);
        mannequin.root.quaternion.copy(baseRootQuat);
        mannequin.root.updateMatrixWorld(true);
        depenetrate(mannequin);
        groundFigureOf(mannequin);
        levelPlantedFeet(mannequin, ir.phases[0]?.groundLock ?? []);
        enforceContactRom(mannequin);
      }
      // Anchor precomputation samples every phase endpoint; restore the visual
      // root marker alongside the figure before the first visible frame.
      floorGuide?.updateRoot({ x: 0, z: 0 }, 0);

      requestClip(ir);
      frameCamera();
    },
    play() {
      playing = true;
      constraintDiagnosticsDirty = true;
      lastT = performance.now();
    },
    pause() {
      playing = false;
      constraintDiagnosticsDirty = true;
    },
    toggle() {
      playing = !playing;
      constraintDiagnosticsDirty = true;
      lastT = performance.now();
      return playing;
    },
    seek(seconds: number) {
      if (!timeline) return;
      time = THREE.MathUtils.clamp(seconds, 0, timeline.duration);
      constraintDiagnostics = [];
      constraintDiagnosticsDirty = true;
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
    getFloorGuideInfo() {
      if (!floorGuideData) return null;
      return floorGuide
        ? floorGuide.getInfo(true)
        : {
            visible: false,
            gridStepMetres: floorGuideData.gridStepMetres,
            scaleBarMetres: floorGuideData.scaleBarMetres,
            hasTravel: floorGuideData.hasTravel,
            hasLoopReset: floorGuideData.hasLoopReset,
            waypoints: floorGuideData.waypoints.map((point) => ({ ...point })),
          };
    },
    getReachResiduals() {
      return reachResiduals.map((residual) => ({ ...residual }));
    },
    getConstraintDiagnostics() {
      return constraintDiagnostics.map((diagnostic) => ({ ...diagnostic }));
    },
    getVisibleBounds() {
      return character?.getBounds() ?? new THREE.Box3().setFromObject(mannequin.root);
    },
    getMannequin() {
      return mannequin;
    },
    getCharacter() {
      return character;
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
      floorGuide?.dispose();
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
      .catch((error: unknown) => {
        // Character failed (offline embed, blocked/404 CDN): reveal the
        // procedural figure we may have hidden, so the scene degrades to the
        // working fallback instead of staying blank. Keep a developer-facing
        // diagnostic because malformed or incompatible rigs otherwise look
        // exactly like a network fallback and are impossible to calibrate.
        console.warn("Posecode character load failed; using procedural fallback", error);
        if (deferProceduralMeshes) setMeshVisibility(mannequin.root, true);
      });
  }

  return api;
}

/** True unless a grip or non-floor pin intentionally suspends/supports the body. */
function isFloorBound(info: {
  grips: readonly unknown[];
  pins: readonly { anchor: string }[];
}): boolean {
  return info.grips.length === 0 && !info.pins.some((pin) => pin.anchor !== "floor");
}

/** Driver terminal bones that must survive a mocap layer unchanged. */
function contactBoneIds(info: {
  groundLock: readonly string[];
  grips: readonly { effector: string }[];
  pins: readonly { effector: string }[];
  reaches: readonly { effector: string; target: string }[];
}): string[] {
  const ids = new Set<string>();
  const addEffector = (effector: string): void => {
    if (effector === "feet" || effector === "foot_left") ids.add("ankle_left");
    if (effector === "feet" || effector === "foot_right") ids.add("ankle_right");
    if (effector === "hands" || effector === "hand_left") ids.add("wrist_left");
    if (effector === "hands" || effector === "hand_right") ids.add("wrist_right");
    if (effector === "fists" || effector === "fist_left") ids.add("wrist_left");
    if (effector === "fists" || effector === "fist_right") ids.add("wrist_right");
    if (effector === "knees" || effector === "knee_left") ids.add("knee_left");
    if (effector === "knees" || effector === "knee_right") ids.add("knee_right");
    if (effector === "forearms") {
      ids.add("elbow_left");
      ids.add("elbow_right");
    }
    if (effector === "back") {
      ids.add("pelvis");
      ids.add("spine");
      ids.add("chest");
    }
  };
  for (const group of info.groundLock) addEffector(group);
  for (const contact of [...info.grips, ...info.pins]) addEffector(contact.effector);
  for (const reach of info.reaches) {
    if (reach.target === "floor") addEffector(reach.effector);
  }
  return [...ids];
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

/** Every hand side whose arm participates in an active contact constraint. */
function contactHandSidesOf(
  reaches: readonly { effector: string }[],
  pins: readonly { effector: string }[],
  grips: readonly { effector: string }[],
  groundLock: readonly string[] = [],
): Set<"left" | "right"> {
  const sides = gripSidesOf(grips);
  const add = (effector: string): void => {
    if (/^(?:hand|fist|elbow)_left$/.test(effector)
      || effector === "hands" || effector === "fists" || effector === "forearms") sides.add("left");
    if (/^(?:hand|fist|elbow)_right$/.test(effector)
      || effector === "hands" || effector === "fists" || effector === "forearms") sides.add("right");
  };
  reaches.forEach((contact) => add(contact.effector));
  pins.forEach((contact) => add(contact.effector));
  groundLock.forEach(add);
  return sides;
}

/** Hand sides whose semantic endpoint is a closed fist (at any target). */
function fistSidesOf(
  reaches: readonly { effector: string }[],
  pins: readonly { effector: string }[],
  groundLock: readonly string[] = [],
): Set<"left" | "right"> {
  const sides = new Set<"left" | "right">();
  const add = (effector: string): void => {
    if (effector === "fists" || effector === "fist_left") sides.add("left");
    if (effector === "fists" || effector === "fist_right") sides.add("right");
  };
  reaches.forEach((reach) => add(reach.effector));
  pins.forEach((pin) => add(pin.effector));
  groundLock.forEach(add);
  return sides;
}

function unionHandSides(
  a: ReadonlySet<"left" | "right">,
  b: ReadonlySet<"left" | "right">,
): Set<"left" | "right"> {
  return new Set([...a, ...b]);
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
    if (effector === "hands" || effector === "hand_left") sides.add("left");
    if (effector === "hands" || effector === "hand_right") sides.add("right");
  };
  for (const r of reaches) if (r.target === "floor") add(r.effector);
  for (const p of pins) if (p.anchor === "floor") add(p.effector);
  for (const effector of groundLock) add(effector);
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
export {
  applyGroundLock,
  groundFigure,
  GROUND_LOCK_PLANTED_MAX_Y,
  isGroundLockFootPlanted,
} from "./groundlock.js";
export type { Mannequin, Proportions, CollisionRadii } from "./mannequin.js";
export { buildTimeline } from "./timeline.js";
export {
  FLOOR_GRID_STEP_METRES,
  FLOOR_SCALE_BAR_METRES,
  buildFloorGuideData,
  createFloorGuide,
  syncFloorGuideToSolvedRoot,
  type FloorGuideData,
  type FloorGuideInfo,
  type FloorGuidePoint,
  type FloorGuideScene,
} from "./floor-guide.js";
export { solveCCD, type IkChain, type JointLimits } from "./ik.js";
export {
  EFFECTOR_BONE,
  REACH_TOLERANCE,
  effectorBoneId,
  reachChain,
  solveReachToPoint,
  missingReachTarget,
  type ReachResidual,
  type ReachResidualReason,
} from "./reach.js";
export { buildProps, type PropScene, type FaceCollider, type BlockedPart } from "./props.js";
export { resolvePropContacts, propContactExemptions, type PropContactExemptions } from "./propcontact.js";
export { loadCharacter, rigCharacter, type Character } from "./character.js";
export {
  loadClipSource,
  retargetMocapClip,
  createClipLayer,
  type ClipLayer,
  type ClipSource,
} from "./clips.js";
export {
  depenetrate,
  measureSelfCollisions,
  type SelfCollisionKind,
  type SelfCollisionResidual,
} from "./depenetrate.js";
export {
  FOOT_CONTACT_HEIGHT_MAX,
  PLANTIGRADE_SOLE_ANGLE_MAX,
  SELF_COLLISION_DEPTH_MAX,
  measureConstraintDiagnostics,
  type ConstraintDiagnostic,
  type ConstraintDiagnosticKind,
  type DiagnosticPin,
} from "./diagnostics.js";
export {
  PALM_LOCAL_NORMAL,
  FIST_LOCAL_NORMAL,
  PLANT_FADE,
  PLANTARFLEX_SKIP,
  alignFloorContacts,
  alignFloorPalms,
  prepareGripFrames,
  alignGripFrames,
  isDipBarGrip,
  floorTargetForEffector,
  floorContactHeight,
  measureFootContact,
  enforceContactRom,
  formFists,
  levelPlantedFeet,
  relaxHands,
  swingArms,
  aimHead,
  wrapGrip,
  type BodySide,
  type FootContactMeasurement,
} from "./contacts.js";
export type { PhaseSegment } from "./timeline.js";

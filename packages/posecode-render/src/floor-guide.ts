/**
 * Floor-orientation overlay for the viewer.
 *
 * The guide turns otherwise implicit root choreography into scene geometry:
 * a half-metre grid, a one-metre ruler, the document load origin, the figure's
 * live facing direction, and (only when authored) its travel trajectory.
 */

import * as THREE from "three";
import type { PosecodeIR } from "posecode-parser";
import type { BuiltTimeline } from "./timeline.js";

export const FLOOR_GRID_STEP_METRES = 0.5;
export const FLOOR_SCALE_BAR_METRES = 1;

export interface FloorGuidePoint {
  x: number;
  z: number;
}

/** Read-only metadata hosts can use to describe the rendered floor guide. */
export interface FloorGuideInfo {
  /** Whether the guide was enabled when the viewer was created. */
  visible: boolean;
  /** Distance between the fine grid lines. */
  gridStepMetres: number;
  /** Length of the brighter ruler drawn beside the origin. */
  scaleBarMetres: number;
  /** True when the source contains a non-zero root travel path. */
  hasTravel: boolean;
  /** True when the implicit loop reset translates the root back to the origin. */
  hasLoopReset: boolean;
  /** Exact authored travel destinations, beginning at the load origin. */
  waypoints: readonly FloorGuidePoint[];
}

export interface FloorGuideData extends Omit<FloorGuideInfo, "visible"> {
  /** Timeline-sampled authored path used for the solid curve. */
  path: readonly FloorGuidePoint[];
  /** Timeline-sampled implicit return to origin, rendered separately as dashes. */
  resetPath: readonly FloorGuidePoint[];
  /** Half-width of the square grid, in metres. */
  gridRadiusMetres: number;
}

export interface FloorGuideScene {
  group: THREE.Group;
  getInfo(visible: boolean): FloorGuideInfo;
  /** Place the guide's load origin in world space. */
  setOrigin(x: number, z: number): void;
  /** Move and turn the live facing marker relative to the load origin. */
  updateRoot(offset: FloorGuidePoint, yawRadians: number): void;
  dispose(): void;
}

const EPSILON = 1e-5;
const GUIDE_Y = 0.006;

/**
 * Synchronize the live marker to the renderer's final world-space root.
 * Contact and prop solvers may translate X/Z beyond the authored trajectory,
 * so callers should invoke this only after those solver passes finish.
 */
export function syncFloorGuideToSolvedRoot(
  guide: Pick<FloorGuideScene, "updateRoot">,
  solvedRoot: FloorGuidePoint,
  loadOrigin: FloorGuidePoint,
  yawRadians: number,
): void {
  guide.updateRoot(
    {
      x: solvedRoot.x - loadOrigin.x,
      z: solvedRoot.z - loadOrigin.z,
    },
    yawRadians,
  );
}

/**
 * Build deterministic guide data from the authored destinations and the same
 * root interpolation the figure uses. Sampling the built timeline means a
 * curved `flow` corner is displayed as the actual trajectory, not a misleading
 * straight waypoint polyline.
 */
export function buildFloorGuideData(
  ir: PosecodeIR,
  timeline: BuiltTimeline,
): FloorGuideData {
  const waypoints: FloorGuidePoint[] = [{ x: 0, z: 0 }];
  let position = { x: 0, z: 0 };
  for (const phase of ir.phases) {
    if (!phase.travel) continue;
    position = { x: phase.travel.x, z: phase.travel.z };
    const previous = waypoints.at(-1)!;
    if (Math.hypot(position.x - previous.x, position.z - previous.z) > EPSILON) {
      waypoints.push({ ...position });
    }
  }

  const hasTravel = waypoints.some((point) => Math.hypot(point.x, point.z) > EPSILON);
  const path: FloorGuidePoint[] = [];
  const resetPath: FloorGuidePoint[] = [];
  const motionEnd = timeline.segments.at(-1)?.end ?? 0;
  if (hasTravel) {
    path.push(...sampleRootPath(timeline, 0, motionEnd, 16, 192));
    // Sampling at `duration` wraps to t=0. Preserve the exact final authored
    // destination for a clip that ends at home as well as one with a reset.
    const final = waypoints.at(-1)!;
    const last = path.at(-1);
    if (!last || Math.hypot(final.x - last.x, final.z - last.z) > 0.002) {
      path.push({ ...final });
    }
  }

  const final = waypoints.at(-1)!;
  const hasLoopReset =
    timeline.duration - motionEnd > EPSILON && Math.hypot(final.x, final.z) > EPSILON;
  if (hasLoopReset) {
    resetPath.push(...sampleRootPath(timeline, motionEnd, timeline.duration, 8, 96));
    // Keep the semantic boundary exact: solid reaches the final authored
    // waypoint; dashed begins there and ends at the load origin.
    resetPath[0] = { ...final };
    resetPath[resetPath.length - 1] = { x: 0, z: 0 };
  }

  const maxCoordinate = Math.max(
    0,
    ...[...waypoints, ...path, ...resetPath]
      .map((point) => Math.max(Math.abs(point.x), Math.abs(point.z))),
  );
  // Preserve the existing 12m floor for normal movements, expanding in whole
  // metres only when choreography would otherwise leave the grid.
  const gridRadiusMetres = Math.max(6, Math.ceil(maxCoordinate + 1.5));
  return {
    gridStepMetres: FLOOR_GRID_STEP_METRES,
    scaleBarMetres: FLOOR_SCALE_BAR_METRES,
    hasTravel,
    hasLoopReset,
    waypoints,
    path,
    resetPath,
    gridRadiusMetres,
  };
}

function sampleRootPath(
  timeline: BuiltTimeline,
  start: number,
  end: number,
  minimumSamples: number,
  maximumSamples: number,
): FloorGuidePoint[] {
  if (end - start <= EPSILON) return [];
  // 16 Hz is smooth at floor scale; cap density for unusually long clips.
  const samples = THREE.MathUtils.clamp(
    Math.ceil((end - start) * 16),
    minimumSamples,
    maximumSamples,
  );
  const path: FloorGuidePoint[] = [];
  const noBones = new Map<string, THREE.Object3D>();
  for (let i = 0; i <= samples; i++) {
    const time = start + (end - start) * (i / samples);
    const point = timeline.sample(time, noBones).rootOffset;
    const previous = path.at(-1);
    if (!previous || Math.hypot(point.x - previous.x, point.z - previous.z) > 0.002) {
      path.push({ ...point });
    }
  }
  return path;
}

/** Build disposable Three.js geometry for one loaded movement. */
export function createFloorGuide(data: FloorGuideData): FloorGuideScene {
  const group = new THREE.Group();
  group.name = "posecode-floor-guide";

  const size = data.gridRadiusMetres * 2;
  const minorGrid = new THREE.GridHelper(
    size,
    Math.round(size / data.gridStepMetres),
    0x343b45,
    0x20262e,
  );
  minorGrid.name = "floor-grid-half-metre";
  configureLineMaterial(minorGrid.material, 0.42);
  minorGrid.position.y = 0.001;
  group.add(minorGrid);

  const majorGrid = new THREE.GridHelper(size, Math.round(size), 0x46515e, 0x303844);
  majorGrid.name = "floor-grid-metre";
  configureLineMaterial(majorGrid.material, 0.34);
  majorGrid.position.y = 0.002;
  group.add(majorGrid);

  const originMaterial = new THREE.MeshBasicMaterial({
    color: 0xf2f1eb,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const origin = new THREE.Mesh(new THREE.RingGeometry(0.055, 0.078, 32), originMaterial);
  origin.name = "floor-origin";
  origin.rotation.x = -Math.PI / 2;
  origin.position.y = GUIDE_Y;
  origin.renderOrder = 2;
  group.add(origin);

  const rulerMaterial = new THREE.LineBasicMaterial({
    color: 0xf2f1eb,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
  });
  const rulerZ = -0.38;
  const rulerHalf = data.scaleBarMetres / 2;
  const tick = 0.055;
  const ruler = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-rulerHalf, GUIDE_Y, rulerZ),
      new THREE.Vector3(rulerHalf, GUIDE_Y, rulerZ),
      new THREE.Vector3(-rulerHalf, GUIDE_Y, rulerZ - tick),
      new THREE.Vector3(-rulerHalf, GUIDE_Y, rulerZ + tick),
      new THREE.Vector3(rulerHalf, GUIDE_Y, rulerZ - tick),
      new THREE.Vector3(rulerHalf, GUIDE_Y, rulerZ + tick),
    ]),
    rulerMaterial,
  );
  ruler.name = "floor-scale-one-metre";
  ruler.renderOrder = 2;
  group.add(ruler);

  if (data.hasTravel && data.path.length > 1) {
    const curve = new THREE.CurvePath<THREE.Vector3>();
    for (let i = 1; i < data.path.length; i++) {
      const from = data.path[i - 1]!;
      const to = data.path[i]!;
      curve.add(
        new THREE.LineCurve3(
          new THREE.Vector3(from.x, GUIDE_Y, from.z),
          new THREE.Vector3(to.x, GUIDE_Y, to.z),
        ),
      );
    }
    const path = new THREE.Mesh(
      new THREE.TubeGeometry(curve, Math.max(12, data.path.length * 2), 0.009, 5, false),
      new THREE.MeshBasicMaterial({
        color: 0xd4ff3f,
        transparent: true,
        opacity: 0.62,
        depthWrite: false,
      }),
    );
    path.name = "floor-travel-path";
    path.renderOrder = 2;
    group.add(path);

    const waypointMaterial = new THREE.MeshBasicMaterial({
      color: 0xd4ff3f,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    for (const [index, point] of data.waypoints.entries()) {
      // The white origin marker already marks both departure and return-home.
      if (index === 0 || Math.hypot(point.x, point.z) <= EPSILON) continue;
      const marker = new THREE.Mesh(new THREE.RingGeometry(0.025, 0.043, 20), waypointMaterial);
      marker.name = `floor-travel-waypoint-${index}`;
      marker.rotation.x = -Math.PI / 2;
      marker.position.set(point.x, GUIDE_Y + 0.002, point.z);
      marker.renderOrder = 3;
      group.add(marker);
    }
  }

  if (data.hasLoopReset && data.resetPath.length > 1) {
    const reset = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(
        data.resetPath.map((point) => new THREE.Vector3(point.x, GUIDE_Y + 0.003, point.z)),
      ),
      new THREE.LineDashedMaterial({
        color: 0xb8c2cc,
        dashSize: 0.09,
        gapSize: 0.055,
        transparent: true,
        opacity: 0.68,
        depthWrite: false,
      }),
    );
    reset.name = "floor-loop-reset-path";
    reset.renderOrder = 2;
    reset.computeLineDistances();
    group.add(reset);
  }

  const currentMaterial = new THREE.MeshBasicMaterial({
    color: 0xd4ff3f,
    transparent: true,
    opacity: 0.96,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const current = new THREE.Mesh(new THREE.RingGeometry(0.033, 0.052, 24), currentMaterial);
  current.name = "floor-current-position";
  current.rotation.x = -Math.PI / 2;
  current.position.y = GUIDE_Y + 0.004;
  current.renderOrder = 4;
  group.add(current);

  // The mannequin's anatomical front is local +Z. Keep this arrow attached to
  // the root trajectory so turns are readable even when the camera orbits.
  const facing = new THREE.ArrowHelper(
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(0, GUIDE_Y + 0.006, 0),
    0.46,
    0xd4ff3f,
    0.12,
    0.075,
  );
  facing.name = "floor-facing-direction";
  facing.line.renderOrder = 4;
  facing.cone.renderOrder = 4;
  configureLineMaterial(facing.line.material, 0.95);
  const coneMaterial = facing.cone.material;
  if (Array.isArray(coneMaterial)) {
    for (const material of coneMaterial) material.depthWrite = false;
  } else {
    coneMaterial.depthWrite = false;
  }
  group.add(facing);

  return {
    group,
    getInfo(visible) {
      return {
        visible,
        gridStepMetres: data.gridStepMetres,
        scaleBarMetres: data.scaleBarMetres,
        hasTravel: data.hasTravel,
        hasLoopReset: data.hasLoopReset,
        waypoints: data.waypoints.map((point) => ({ ...point })),
      };
    },
    setOrigin(x, z) {
      group.position.x = x;
      group.position.z = z;
    },
    updateRoot(offset, yawRadians) {
      current.position.x = offset.x;
      current.position.z = offset.z;
      facing.position.x = offset.x;
      facing.position.z = offset.z;
      facing.setDirection(
        new THREE.Vector3(Math.sin(yawRadians), 0, Math.cos(yawRadians)).normalize(),
      );
    },
    dispose() {
      group.traverse((object) => {
        const drawable = object as THREE.Mesh | THREE.Line;
        drawable.geometry?.dispose();
        const material = drawable.material;
        if (Array.isArray(material)) material.forEach((item) => item.dispose());
        else material?.dispose();
      });
    },
  };
}

function configureLineMaterial(
  material: THREE.Material | THREE.Material[],
  opacity: number,
): void {
  const materials = Array.isArray(material) ? material : [material];
  for (const item of materials) {
    item.transparent = true;
    item.opacity = opacity;
    item.depthWrite = false;
  }
}

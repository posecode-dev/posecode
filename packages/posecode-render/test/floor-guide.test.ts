import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { parse } from "posecode-parser";
import { buildTimeline } from "../src/timeline.js";
import {
  buildFloorGuideData,
  createFloorGuide,
  syncFloorGuideToSolvedRoot,
} from "../src/floor-guide.js";

function parseTimeline(source: string) {
  const parsed = parse(source);
  expect(parsed.errors).toEqual([]);
  expect(parsed.ir).toBeDefined();
  return { ir: parsed.ir!, timeline: buildTimeline(parsed.ir!) };
}

describe("floor guide", () => {
  it("keeps static clips quiet while preserving metric orientation metadata", () => {
    const { ir, timeline } = parseTimeline([
      'posecode exercise "Curl"',
      "  rig humanoid",
      "  pose start = standing",
      '  step "Curl" 1s linear:',
      "    elbows: flex 90",
      "  repeat 1",
    ].join("\n"));

    const data = buildFloorGuideData(ir, timeline);
    expect(data.gridStepMetres).toBe(0.5);
    expect(data.scaleBarMetres).toBe(1);
    expect(data.hasTravel).toBe(false);
    expect(data.hasLoopReset).toBe(false);
    expect(data.waypoints).toEqual([{ x: 0, z: 0 }]);
    expect(data.path).toEqual([]);
    expect(data.resetPath).toEqual([]);

    const guide = createFloorGuide(data);
    expect(guide.group.getObjectByName("floor-origin")).toBeDefined();
    expect(guide.group.getObjectByName("floor-facing-direction")).toBeDefined();
    expect(guide.group.getObjectByName("floor-scale-one-metre")).toBeDefined();
    expect(guide.group.getObjectByName("floor-travel-path")).toBeUndefined();
    expect(guide.group.getObjectByName("floor-loop-reset-path")).toBeUndefined();
    guide.dispose();
  });

  it("uses timeline interpolation for the visible path and retains authored waypoints", () => {
    const { ir, timeline } = parseTimeline([
      'posecode exercise "Corner"',
      "  rig humanoid",
      "  pose start = standing",
      '  step "Across" 1s flow:',
      "    travel: 1 0",
      '  step "Forward" 1s flow:',
      "    travel: 1 1",
      "  repeat 1",
    ].join("\n"));

    const data = buildFloorGuideData(ir, timeline);
    expect(data.hasTravel).toBe(true);
    expect(data.waypoints).toEqual([
      { x: 0, z: 0 },
      { x: 1, z: 0 },
      { x: 1, z: 1 },
    ]);
    expect(data.path[0]).toEqual({ x: 0, z: 0 });
    expect(data.path.some((point) => Math.hypot(point.x - 1, point.z) < 1e-6)).toBe(true);
    expect(data.path.at(-1)).toEqual({ x: 1, z: 1 });
    // The solid authored path stops at the final waypoint. The implicit
    // Hermite/flow return is separate, never presented as authored travel.
    expect(data.hasLoopReset).toBe(true);
    expect(data.resetPath[0]).toEqual({ x: 1, z: 1 });
    expect(data.resetPath.at(-1)).toEqual({ x: 0, z: 0 });
    const resetMidTime = (timeline.segments.at(-1)!.end + timeline.duration) / 2;
    const sampledResetMidpoint = timeline.sample(resetMidTime, new Map()).rootOffset;
    expect(data.resetPath.some((point) =>
      Math.hypot(
        point.x - sampledResetMidpoint.x,
        point.z - sampledResetMidpoint.z,
      ) < 1e-6,
    )).toBe(true);
    const authoredBeforeEnd = data.path.at(-2)!;
    const resetAfterStart = data.resetPath[1]!;
    const authoredVector = {
      x: 1 - authoredBeforeEnd.x,
      z: 1 - authoredBeforeEnd.z,
    };
    const resetVector = {
      x: resetAfterStart.x - 1,
      z: resetAfterStart.z - 1,
    };
    // The final authored leg arrives from a different direction than the
    // automatic return; the dashed reset must still be present as its own path.
    expect(Math.abs(authoredVector.x * resetVector.z - authoredVector.z * resetVector.x))
      .toBeGreaterThan(1e-4);

    const guide = createFloorGuide(data);
    expect(guide.group.getObjectByName("floor-travel-path")).toBeDefined();
    expect(guide.group.getObjectByName("floor-travel-waypoint-2")).toBeDefined();
    const reset = guide.group.getObjectByName("floor-loop-reset-path") as THREE.Line;
    expect(reset).toBeDefined();
    expect(reset.material).toBeInstanceOf(THREE.LineDashedMaterial);
    expect(reset.geometry.getAttribute("lineDistance")).toBeDefined();
    guide.dispose();
  });

  it("moves the live marker and rotates +Z facing with root choreography", () => {
    const { ir, timeline } = parseTimeline([
      'posecode exercise "Quarter turn"',
      "  rig humanoid",
      '  step "Turn" 1s linear:',
      "    turn: 90",
      "    travel: 0.5 -0.25",
      "  repeat 1",
    ].join("\n"));
    const guide = createFloorGuide(buildFloorGuideData(ir, timeline));

    guide.setOrigin(0.2, -0.4);
    guide.updateRoot({ x: 0.5, z: -0.25 }, Math.PI / 2);
    expect(guide.group.position.x).toBeCloseTo(0.2);
    expect(guide.group.position.z).toBeCloseTo(-0.4);

    const marker = guide.group.getObjectByName("floor-current-position")!;
    expect(marker.position.x).toBeCloseTo(0.5);
    expect(marker.position.z).toBeCloseTo(-0.25);

    const arrow = guide.group.getObjectByName("floor-facing-direction")!;
    const direction = new THREE.Vector3(0, 1, 0).applyQuaternion(arrow.quaternion);
    expect(direction.x).toBeCloseTo(1, 5);
    expect(direction.z).toBeCloseTo(0, 5);
    guide.dispose();
  });

  it("tracks the final solver-adjusted root relative to the load origin", () => {
    const { ir, timeline } = parseTimeline([
      'posecode exercise "Squat"',
      "  rig humanoid",
      '  step "Lower" 1s settle:',
      "    knees: flex 90",
      "    ground-lock: feet",
      "  repeat 1",
    ].join("\n"));
    const guide = createFloorGuide(buildFloorGuideData(ir, timeline));

    // Simulate a contact solver moving the final root 17.5cm behind the
    // authored zero-travel target, from a non-zero world-space load origin.
    syncFloorGuideToSolvedRoot(
      guide,
      { x: 0.4, z: -0.375 },
      { x: 0.4, z: -0.2 },
      0,
    );

    const marker = guide.group.getObjectByName("floor-current-position")!;
    expect(marker.position.x).toBeCloseTo(0);
    expect(marker.position.z).toBeCloseTo(-0.175);
    guide.dispose();
  });
});

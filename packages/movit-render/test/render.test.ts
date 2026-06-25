import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { buildMannequin } from "../src/mannequin.js";
import { buildTimeline } from "../src/timeline.js";
import { solveCCD } from "../src/ik.js";
import { parse } from "movit-parser";

describe("mannequin", () => {
  it("exposes all 17 named bones", () => {
    const m = buildMannequin();
    expect(m.bones.size).toBe(17);
    for (const id of ["pelvis", "chest", "elbow_left", "knee_right", "wrist_left"]) {
      expect(m.bones.has(id)).toBe(true);
    }
  });

  it("declares hand and foot effector groups", () => {
    const m = buildMannequin();
    expect(m.effectors.hands).toEqual(["wrist_left", "wrist_right"]);
    expect(m.effectors.feet).toEqual(["ankle_left", "ankle_right"]);
  });
});

describe("timeline", () => {
  const PUSHUP = [
    'movit exercise "Push-up"',
    "  rig humanoid",
    "  pose start = plank",
    '  step "Lower" 2s ease-in:',
    "    elbows: flex 90",
    '  step "Press" 1s ease-out:',
    "    elbows: extend 0",
    "  repeat 5",
  ].join("\n");

  it("builds a looping timeline whose duration covers all phases + wrap", () => {
    const { ir } = parse(PUSHUP);
    const tl = buildTimeline(ir!);
    // 2s + 1s phases + 2s wrap (first phase duration)
    expect(tl.duration).toBeCloseTo(5, 5);
    expect(tl.bonesUsed).toContain("elbow_left");
  });

  it("bends the elbow as the Lower phase progresses", () => {
    const { ir } = parse(PUSHUP);
    const tl = buildTimeline(ir!);
    const m = buildMannequin();

    tl.sample(0, m.bones);
    const start = m.bones.get("elbow_left")!.quaternion.clone();
    tl.sample(2, m.bones); // end of Lower
    const lowered = m.bones.get("elbow_left")!.quaternion.clone();

    expect(start.angleTo(lowered)).toBeGreaterThan(1.0); // ~90deg in radians
  });
});

describe("hip-hinge coupling", () => {
  const DEADLIFT = [
    'movit exercise "Hinge"',
    "  rig humanoid",
    "  pose start = standing",
    '  step "Lower" 2s ease-in-out:',
    "    pelvis: hinge 90",
    "    ground-lock: feet",
    "  repeat 2",
  ].join("\n");

  it("keeps the thighs world-vertical when the pelvis hinges", () => {
    const { ir } = parse(DEADLIFT);
    const tl = buildTimeline(ir!);
    const m = buildMannequin();
    const root = m.root;

    // Sample the bottom of the hinge (end of the 2s Lower phase).
    tl.sample(2, m.bones);
    root.updateMatrixWorld(true);

    // The torso (chest) should have tipped forward toward horizontal: its rest
    // down-axis (0,-1,0) pitches away from vertical, so |y| collapses toward 0.
    const chestDir = new THREE.Vector3(0, -1, 0).applyQuaternion(
      m.bones.get("chest")!.getWorldQuaternion(new THREE.Quaternion()),
    );
    expect(Math.abs(chestDir.y)).toBeLessThan(0.4);

    // ...while the thigh (hip → knee) stays essentially vertical, because the
    // renderer counter-rotates the hips against the pelvis hinge.
    const hipPos = m.bones.get("hip_left")!.getWorldPosition(new THREE.Vector3());
    const kneePos = m.bones
      .get("knee_left")!
      .getWorldPosition(new THREE.Vector3());
    const thigh = kneePos.sub(hipPos).normalize();
    expect(thigh.y).toBeLessThan(-0.95); // points almost straight down
  });
});

describe("ccd ik", () => {
  it("brings an effector close to its target", () => {
    const root = new THREE.Object3D();
    const j0 = new THREE.Object3D();
    const j1 = new THREE.Object3D();
    const effector = new THREE.Object3D();
    root.add(j0);
    j0.add(j1);
    j1.position.set(0, 1, 0);
    j1.add(effector);
    effector.position.set(0, 1, 0);
    root.updateMatrixWorld(true);

    const target = new THREE.Vector3(1.4, 0.6, 0);
    const distSq = solveCCD({ joints: [j0, j1], effector, target }, 30);
    expect(Math.sqrt(distSq)).toBeLessThan(0.05);
  });
});

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

describe("pose directions (world space)", () => {
  function poseAtEnd(src: string) {
    const { ir, errors } = parse(src);
    expect(errors).toEqual([]);
    const m = buildMannequin();
    const tl = buildTimeline(ir!);
    tl.sample(tl.segments[0]!.end - 1e-6, m.bones);
    m.root.updateMatrixWorld(true);
    return m;
  }
  const world = (m: ReturnType<typeof buildMannequin>, id: string) =>
    m.bones.get(id)!.getWorldPosition(new THREE.Vector3());
  const doc = (...lines: string[]) =>
    ['movit exercise "t"', "  rig humanoid", '  step "go" 2s linear:', ...lines.map((l) => `    ${l}`)].join("\n");

  it("spine flexion bends the head forward (+Z), the same side as the toes", () => {
    const m = poseAtEnd(doc("spine: flex 45"));
    expect(world(m, "head").z).toBeGreaterThan(0.15);
  });

  it("hip hinge tips the torso over the feet while the legs stay vertical", () => {
    const m = poseAtEnd(doc("hips: hinge 70", "ground-lock: feet"));
    // Torso pitched well forward…
    expect(world(m, "head").z).toBeGreaterThan(0.35);
    expect(world(m, "head").y).toBeLessThan(1.3);
    // …while the legs stay a vertical column: knee directly below the hip.
    const hip = world(m, "hip_left");
    const knee = world(m, "knee_left");
    const ankle = world(m, "ankle_left");
    expect(Math.abs(knee.z - hip.z)).toBeLessThan(0.03);
    expect(Math.abs(ankle.z - knee.z)).toBeLessThan(0.03);
  });

  it("hip hinge is a hinge, not a spinal roll: spine stays neutral", () => {
    const m = poseAtEnd(doc("hips: hinge 70"));
    // Neck→head direction should still align with the chest→neck direction
    // (straight back), unlike a roll-down which curls the spine.
    const chest = world(m, "chest");
    const neck = world(m, "neck");
    const head = world(m, "head");
    const a = neck.clone().sub(chest).normalize();
    const b = head.clone().sub(neck).normalize();
    expect(a.dot(b)).toBeGreaterThan(0.99);
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

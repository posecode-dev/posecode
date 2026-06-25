import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { buildMannequin } from "../src/mannequin.js";
import { buildTimeline } from "../src/timeline.js";
import { solveCCD } from "../src/ik.js";
import { poseFor } from "../src/poses.js";
import { buildProps } from "../src/props.js";
import { parse } from "movit-parser";

const DEG = Math.PI / 180;

describe("mannequin", () => {
  it("exposes all 27 named bones (incl. fingers)", () => {
    const m = buildMannequin();
    expect(m.bones.size).toBe(27);
    for (const id of [
      "pelvis",
      "chest",
      "elbow_left",
      "knee_right",
      "wrist_left",
      "index_right",
      "thumb_left",
    ]) {
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

describe("lying & seated poses", () => {
  it("lays the supine torso horizontal", () => {
    const spec = poseFor("supine");
    expect(spec.root?.rotationDeg).toEqual([-90, 0, 0]);

    const m = buildMannequin();
    const [rx, ry, rz] = spec.root!.rotationDeg!;
    m.root.rotation.set(rx * DEG, ry * DEG, rz * DEG);
    m.root.updateMatrixWorld(true);

    // The torso's long axis (chest local +Y) should be ~horizontal when lying.
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(
      m.bones.get("chest")!.getWorldQuaternion(new THREE.Quaternion()),
    );
    expect(Math.abs(up.y)).toBeLessThan(0.1);
  });

  it("grounds a lying figure with a bounding-box drop", () => {
    const m = buildMannequin();
    m.root.rotation.x = poseFor("prone").root!.rotationDeg![0] * DEG;
    m.root.updateMatrixWorld(true);

    // Mirror groundFigure(): drop so the lowest mesh point rests at y=0.
    const box = new THREE.Box3().setFromObject(m.root);
    m.root.position.y -= box.min.y;
    m.root.updateMatrixWorld(true);

    const grounded = new THREE.Box3().setFromObject(m.root);
    expect(grounded.min.y).toBeCloseTo(0, 5);
  });
});

describe("reach-IK", () => {
  it("drives a wrist to a world point within the arm's reach", () => {
    const m = buildMannequin();
    m.root.updateMatrixWorld(true);
    const wrist = m.bones.get("wrist_right")!;
    const shoulder = m.bones.get("shoulder_right")!;

    // A target ~0.47m from the shoulder — inside the ~0.54m arm reach — so the
    // hand can actually arrive (a body landmark like a knee is out of range from
    // a neutral stand, which is exactly why touch-toes hinges the torso first).
    const target = shoulder
      .getWorldPosition(new THREE.Vector3())
      .add(new THREE.Vector3(0.3, -0.2, 0.3));

    solveCCD(
      { joints: [shoulder, m.bones.get("elbow_right")!], effector: wrist, target },
      20,
    );
    m.root.updateMatrixWorld(true);
    const after = wrist.getWorldPosition(new THREE.Vector3()).distanceTo(target);

    expect(after).toBeLessThan(0.06);
  });
});

describe("hand rig", () => {
  it("curls every finger on `fingers: flex`", () => {
    const { ir, warnings } = parse(
      [
        'movit posture "Fist"',
        "  rig humanoid",
        '  step "Close" 1s ease-out:',
        "    fingers: flex 80",
        "  repeat 1",
      ].join("\n"),
    );
    expect(warnings).toEqual([]);
    const tl = buildTimeline(ir!);
    const m = buildMannequin();
    tl.sample(1, m.bones); // end of the Close phase

    for (const id of ["index_left", "middle_right", "pinky_left", "thumb_right"]) {
      const q = m.bones.get(id)!.quaternion;
      expect(Math.abs(q.x) + Math.abs(q.y) + Math.abs(q.z)).toBeGreaterThan(0.1);
    }
  });
});

describe("props", () => {
  it("exposes named anchors for declared props", () => {
    const { anchors, group } = buildProps(["chair", "bar", "wall"]);
    expect(anchors.has("seat")).toBe(true);
    expect(anchors.has("bar")).toBe(true);
    expect(anchors.has("wall")).toBe(true);
    expect(anchors.get("bar")!.y).toBeGreaterThan(1.5); // overhead
    expect(group.children.length).toBeGreaterThan(0);
  });

  it("drives a wrist to a prop anchor with reach-IK", () => {
    const m = buildMannequin();
    m.root.updateMatrixWorld(true);
    const { anchors } = buildProps(["bar"]);
    const target = anchors.get("bar")!.clone();

    const wrist = m.bones.get("wrist_right")!;
    solveCCD(
      {
        joints: [m.bones.get("shoulder_right")!, m.bones.get("elbow_right")!],
        effector: wrist,
        target,
      },
      20,
    );
    m.root.updateMatrixWorld(true);
    // The bar sits at the edge of arm reach; the hand should come up close to it.
    const d = wrist.getWorldPosition(new THREE.Vector3()).distanceTo(target);
    expect(d).toBeLessThan(0.2);
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

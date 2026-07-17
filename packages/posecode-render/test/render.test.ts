import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { buildMannequin } from "../src/mannequin.js";
import { buildTimeline } from "../src/timeline.js";
import { solveCCD } from "../src/ik.js";
import { poseFor } from "../src/poses.js";
import { buildProps } from "../src/props.js";
import { applyGroundLock, groundFigure } from "../src/groundlock.js";
import { PALM_LOCAL_NORMAL, formFists, levelPlantedFeet, wrapGrip } from "../src/contacts.js";
import { effectorBoneId, missingReachTarget, solveReachToPoint } from "../src/reach.js";
import { parse, eulerRomFor } from "posecode-parser";

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
    expect(m.effectors.hand_left).toEqual(["wrist_left"]);
    expect(m.effectors.forearms).toEqual(["elbow_left", "elbow_right"]);
    expect(m.effectors.feet).toEqual(["ankle_left", "ankle_right"]);
    expect(m.effectors.foot_right).toEqual(["ankle_right"]);
    expect(m.effectors.back).toEqual(["pelvis", "spine", "chest"]);
    expect(m.effectors.fist_left).toEqual(["wrist_left"]);
    expect(m.effectors.fists).toEqual(["wrist_left", "wrist_right"]);
    expect(m.effectors.knees).toEqual(["knee_left", "knee_right"]);
    expect(effectorBoneId("fist_right")).toBe("wrist_right");
    expect(effectorBoneId("knee_left")).toBe("knee_left");
  });
});

describe("timeline", () => {
  it("starts standing poses with relaxed palms facing the thighs", () => {
    const joints = poseFor("standing").joints!;
    expect(joints.elbow_left).toEqual([0, -80, 0]);
    expect(joints.elbow_right).toEqual([0, 80, 0]);

    const m = buildMannequin();
    for (const [boneId, rotation] of Object.entries(joints)) {
      const [x, y, z] = rotation;
      m.bones.get(boneId)!.rotation.set(x * DEG, y * DEG, z * DEG);
    }
    m.root.updateMatrixWorld(true);
    const pelvis = m.bones.get("pelvis")!.getWorldPosition(new THREE.Vector3());
    const expectPalmsInward = (): void => {
      for (const side of ["left", "right"] as const) {
        const wrist = m.bones.get(`wrist_${side}`)!;
        const palm = new THREE.Vector3(...PALM_LOCAL_NORMAL)
          .applyQuaternion(wrist.getWorldQuaternion(new THREE.Quaternion()))
          .normalize();
        const towardBody = pelvis.clone()
          .sub(wrist.getWorldPosition(new THREE.Vector3()))
          .normalize();
        expect(palm.dot(towardBody)).toBeGreaterThan(0.8);
      }
    };
    expectPalmsInward();
    formFists(m, new Set(["left", "right"]));
    expectPalmsInward(); // finger curl never changes palm facing
  });

  const PUSHUP = [
    'posecode exercise "Push-up"',
    "  rig humanoid",
    "  pose start = plank",
    '  step "Lower" 2s ease-in:',
    "    elbows: flex 90",
    '  step "Press" 1s ease-out:',
    "    elbows: extend 0",
    "  repeat 5",
  ].join("\n");

  it("omits a redundant wrap when the final phase returns to the base pose", () => {
    const { ir } = parse(PUSHUP);
    const tl = buildTimeline(ir!);
    expect(tl.duration).toBeCloseTo(3, 5);
    expect(tl.bonesUsed).toContain("elbow_left");
  });

  it("keeps a wrap segment when the final phase differs from the base pose", () => {
    const src = [
      'posecode exercise "Hold curl"',
      "  rig humanoid",
      "  pose start = standing",
      '  step "Curl" 1s settle:',
      "    elbows: flex 90",
      "  repeat 1",
    ].join("\n");
    const { ir } = parse(src);
    expect(buildTimeline(ir!).duration).toBeCloseTo(2, 5);
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

  // Regression: a large rest-to-rest move (biceps curl: elbow flex 135 +
  // supinate 80, near-antipodal endpoints) must sweep monotonically instead of
  // lingering near rest and snapping to the target near the phase boundary.
  it("curls the forearm monotonically from rest (no interpolation snap)", () => {
    const CURL = [
      'posecode exercise "Curl"',
      "  rig humanoid",
      "  pose start = standing",
      '  step "Curl" 1.1s settle:',
      "    elbows: flex 135",
      "    elbows: supinate 80",
      '  step "Lower" 1.4s drive:',
      "    elbows: flex 15",
      "    elbows: supinate 80",
      "  repeat 10",
    ].join("\n");
    const { ir } = parse(CURL);
    const tl = buildTimeline(ir!);
    const m = buildMannequin();
    const forearm = new THREE.Vector3(0, -1, 0); // wrist sits at elbow-local -Y
    const wq = new THREE.Quaternion();
    const dir = new THREE.Vector3();
    let prev: THREE.Vector3 | null = null;
    // Walk the 1.1s Curl segment in even steps. The forearm swings ~135deg
    // total, so at this resolution each step is small; the overshoot bug instead
    // parked the forearm near rest then jumped ~135deg in a single step. Assert
    // no adjacent step exceeds 0.9rad (~50deg): the fix keeps every step under
    // ~0.5rad, while the snap produced a ~2.3rad jump.
    for (let t = 0; t <= 1.1 + 1e-9; t += 1.1 / 22) {
      tl.sample(t, m.bones);
      m.root.updateMatrixWorld(true);
      m.bones.get("elbow_left")!.getWorldQuaternion(wq);
      dir.copy(forearm).applyQuaternion(wq).normalize();
      if (prev) expect(dir.angleTo(prev)).toBeLessThan(0.9);
      prev = dir.clone();
    }
  });

  it("follows a large reversing joint arc without hiding a full rotation", () => {
    const REVERSAL = [
      'posecode stretch "Shoulder abduction"',
      "  rig humanoid",
      "  pose start = standing",
      '  step "Raise" 2.5s flow:',
      "    shoulders: abduct 160",
      '  step "Lower" 2.5s settle:',
      "    shoulders: abduct 0",
      "  repeat 1",
    ].join("\n");
    const { ir } = parse(REVERSAL);
    const tl = buildTimeline(ir!);
    const m = buildMannequin();
    const euler = new THREE.Euler();
    let previous = 0;

    for (let t = 0; t <= 2.5 + 1e-9; t += 0.125) {
      tl.sample(t, m.bones);
      euler.setFromQuaternion(m.bones.get("shoulder_right")!.quaternion, "XYZ");
      const angle = -euler.z / DEG;
      expect(angle).toBeGreaterThanOrEqual(previous - 1e-4);
      expect(angle - previous).toBeLessThan(15);
      previous = angle;
    }
    expect(previous).toBeCloseTo(160, 4);

    tl.sample(1.25, m.bones);
    euler.setFromQuaternion(m.bones.get("shoulder_right")!.quaternion, "XYZ");
    expect(-euler.z / DEG).toBeCloseTo(80, 1);
  });

  it("blends reach constraints across phase boundaries", () => {
    const src = [
      'posecode stretch "Cross-body reach"',
      "  rig humanoid",
      "  pose start = standing",
      '  step "Reach" 1s flow:',
      "    reach: hand_right shoulder_left",
      '  step "Return" 1s settle:',
      "    shoulder_right: flex 0",
      "  repeat 1",
    ].join("\n");
    const { ir } = parse(src);
    const tl = buildTimeline(ir!);
    const m = buildMannequin();

    expect(tl.sample(0, m.bones).reaches).toEqual([]);
    expect(tl.sample(0.5, m.bones).reaches[0]?.weight).toBeCloseTo(0.5, 5);
    expect(tl.sample(1, m.bones).reaches[0]?.weight).toBeCloseTo(1, 5);
    expect(tl.sample(1.5, m.bones).reaches[0]?.weight).toBeCloseTo(0.25, 5);
    expect(tl.sample(2 - 1e-5, m.bones).reaches).toEqual([]);
  });
});

describe("hip-hinge coupling", () => {
  const DEADLIFT = [
    'posecode exercise "Hinge"',
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

describe("spatial choreography (turn & travel)", () => {
  it("interpolates root yaw across a turn phase", () => {
    const src = [
      'posecode exercise "Half turn"',
      "  rig humanoid",
      "  pose start = standing",
      '  step "Spin" 1s linear:',
      "    turn: 180",
      "    ground-lock: feet",
      "  repeat 1",
    ].join("\n");
    const { ir } = parse(src);
    const tl = buildTimeline(ir!);
    const m = buildMannequin();

    // Midway through the 1s spin → ~90°; at the end → 180° (π radians).
    expect(tl.sample(0.5, m.bones).rootYaw).toBeCloseTo(Math.PI / 2, 3);
    expect(tl.sample(1, m.bones).rootYaw).toBeCloseTo(Math.PI, 3);
  });

  it("interpolates the root ground offset across a travel phase", () => {
    const src = [
      'posecode exercise "Step over"',
      "  rig humanoid",
      "  pose start = standing",
      '  step "Go" 1s linear:',
      "    travel: 0.5 -0.4",
      "    ground-lock: feet",
      "  repeat 1",
    ].join("\n");
    const { ir } = parse(src);
    const tl = buildTimeline(ir!);
    const m = buildMannequin();

    const end = tl.sample(1, m.bones).rootOffset;
    expect(end.x).toBeCloseTo(0.5, 3);
    expect(end.z).toBeCloseTo(-0.4, 3);
    // Travel extent (for camera framing) is the largest offset magnitude.
    expect(tl.travelExtent).toBeCloseTo(Math.hypot(0.5, 0.4), 3);
  });

  it("carries root velocity smoothly through flow travel waypoints", () => {
    const src = [
      'posecode exercise "Corner"',
      "  rig humanoid",
      "  pose start = standing",
      '  step "Across" 1s flow:',
      "    travel: 1 0",
      '  step "Forward" 1s flow:',
      "    travel: 1 1",
      "  repeat 1",
    ].join("\n");
    const { ir } = parse(src);
    const tl = buildTimeline(ir!);
    const m = buildMannequin();
    const eps = 1e-3;
    const before = tl.sample(1 - eps, m.bones).rootOffset;
    const at = tl.sample(1, m.bones).rootOffset;
    const after = tl.sample(1 + eps, m.bones).rootOffset;
    const velocityBefore = {
      x: (at.x - before.x) / eps,
      z: (at.z - before.z) / eps,
    };
    const velocityAfter = {
      x: (after.x - at.x) / eps,
      z: (after.z - at.z) / eps,
    };

    expect(at).toEqual({ x: 1, z: 0 });
    expect(velocityBefore.x).toBeCloseTo(velocityAfter.x, 2);
    expect(velocityBefore.z).toBeCloseTo(velocityAfter.z, 2);
  });

  it("leaves yaw and offset at home for movements that never turn/travel", () => {
    const src = [
      'posecode exercise "Curl"',
      "  rig humanoid",
      '  step "Up" 1s linear:',
      "    elbows: flex 90",
      "  repeat 1",
    ].join("\n");
    const { ir } = parse(src);
    const tl = buildTimeline(ir!);
    const m = buildMannequin();
    const info = tl.sample(1, m.bones);
    expect(info.rootYaw).toBe(0);
    expect(info.rootOffset).toEqual({ x: 0, z: 0 });
    expect(tl.travelExtent).toBe(0);
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

    // A target ~0.47m from the shoulder (inside the ~0.54m arm reach) so the
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

  it("solves a canonical knee effector through the hip and reports residual", () => {
    const m = buildMannequin();
    m.root.updateMatrixWorld(true);
    const hip = m.bones.get("hip_left")!;
    const knee = m.bones.get("knee_left")!;
    const hipPos = hip.getWorldPosition(new THREE.Vector3());
    const radius = knee.getWorldPosition(new THREE.Vector3()).sub(hipPos);
    const target = hipPos.clone().add(radius.applyAxisAngle(new THREE.Vector3(1, 0, 0), -0.2));
    const kneeBefore = knee.quaternion.clone();

    const residual = solveReachToPoint(m, "knee_left", "world", target);

    expect(residual.reason).toBeUndefined();
    expect(residual.distance).not.toBeNull();
    expect(residual.distance!).toBeLessThan(0.04);
    expect(residual.reached).toBe(true);
    // The endpoint knee does not rotate itself; its hip is the reach chain.
    expect(knee.quaternion.angleTo(kneeBefore)).toBeLessThan(1e-8);
    expect(hip.quaternion.angleTo(new THREE.Quaternion())).toBeGreaterThan(0.05);
  });

  it("retains an unreachable fist residual and an unresolved target diagnostic", () => {
    const m = buildMannequin();
    m.root.updateMatrixWorld(true);
    const far = new THREE.Vector3(5, 5, 5);
    const residual = solveReachToPoint(m, "fist_right", "far", far);
    expect(residual.distance).not.toBeNull();
    expect(residual.distance!).toBeGreaterThan(5);
    expect(residual.reached).toBe(false);

    expect(missingReachTarget("fist_right", "missing_anchor")).toMatchObject({
      effector: "fist_right",
      target: "missing_anchor",
      distance: null,
      reached: false,
      reason: "missing-target",
    });
  });
});

describe("hand rig", () => {
  it("curls every finger on `fingers: flex`", () => {
    const { ir, warnings } = parse(
      [
        'posecode posture "Fist"',
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

describe("ground-lock (shared solver)", () => {
  // The solver extracted into groundlock.ts is what both the viewer and the
  // headless eval harness call, so exercise it directly.
  function posedRaw(source: string): ReturnType<typeof buildMannequin> {
    const { ir } = parse(source);
    const tl = buildTimeline(ir!);
    const m = buildMannequin();
    tl.sample(tl.segments[0]!.end - 1e-4, m.bones);
    m.root.updateMatrixWorld(true);
    return m;
  }

  it("drops the body and plants the foot mesh for a feet-only squat", () => {
    const m = posedRaw(
      [
        'posecode exercise "Squat"',
        "  rig humanoid",
        "  pose start = standing",
        '  step "Descend" 1s ease-in-out:',
        "    hips: flex 80",
        "    knees: flex 95",
        "    ground-lock: feet",
      ].join("\n"),
    );
    applyGroundLock(m, ["feet"]);
    m.root.updateMatrixWorld(true);
    // Pelvis well below standing rest (~0.95m): the body lowered into a squat.
    const pelvisY = m.bones.get("pelvis")!.getWorldPosition(new THREE.Vector3()).y;
    expect(pelvisY).toBeLessThan(0.85);
    // Foot MESH sole rests on the floor (ankle bone rides ~0.04m above it).
    const soleY = new THREE.Box3().setFromObject(m.bones.get("ankle_left")!).min.y;
    expect(Math.abs(soleY)).toBeLessThan(0.01);
  });

  it("plants only the requested foot for a single-foot ground lock", () => {
    const m = posedRaw(
      [
        'posecode exercise "One-leg balance"',
        "  rig humanoid",
        "  pose start = standing",
        '  step "Lift left" 1s linear:',
        "    hip_left: flex 55",
        "    knee_left: flex 75",
        "    ground-lock: foot_right",
      ].join("\n"),
    );
    applyGroundLock(m, ["foot_right"]);
    m.root.updateMatrixWorld(true);
    const rightSole = new THREE.Box3().setFromObject(m.bones.get("ankle_right")!).min.y;
    const leftSole = new THREE.Box3().setFromObject(m.bones.get("ankle_left")!).min.y;
    expect(Math.abs(rightSole)).toBeLessThan(0.01);
    expect(leftSole).toBeGreaterThan(0.1);
  });

  it("normalizes and plants a human-readable single-foot lock", () => {
    const source = [
      'posecode exercise "Layup"',
      "  rig humanoid",
      "  pose start = standing",
      '  step "Plant" 1s settle:',
      "    knee_left: flex 86",
      "    hip_left: flex 62",
      "    ground-lock: left foot",
    ].join("\n");
    const { ir, errors } = parse(source);
    expect(errors).toEqual([]);
    expect(ir?.phases[0]?.groundLock).toEqual(["foot_left"]);

    const m = posedRaw(source);
    applyGroundLock(m, ir!.phases[0]!.groundLock);
    const soleY = new THREE.Box3().setFromObject(m.bones.get("ankle_left")!).min.y;
    expect(Math.abs(soleY)).toBeLessThan(0.01);
  });

  it("plants the torso surface for a supine back lock", () => {
    const m = buildMannequin();
    const spec = poseFor("supine");
    m.root.position.set(...spec.root!.position!);
    const [rx, ry, rz] = spec.root!.rotationDeg!;
    m.root.rotation.set(rx * DEG, ry * DEG, rz * DEG);
    // Put the limbs into an asymmetric dead-bug phase before solving contact.
    m.bones.get("shoulder_right")!.rotation.x = -150 * DEG;
    m.bones.get("hip_left")!.rotation.x = -20 * DEG;
    m.bones.get("knee_left")!.rotation.x = 5 * DEG;
    m.root.updateMatrixWorld(true);

    applyGroundLock(m, ["back"]);

    // Measure meshes owned by the pelvis/spine/chest only. Descendant limbs
    // are intentionally excluded: moving an arm must not lift the back.
    const boneNodes = new Set(m.bones.values());
    const backBox = new THREE.Box3();
    for (const id of ["pelvis", "spine", "chest"]) {
      for (const child of m.bones.get(id)!.children) {
        if (!boneNodes.has(child)) backBox.union(new THREE.Box3().setFromObject(child));
      }
    }
    expect(backBox.min.y).toBeCloseTo(0, 3);
  });

  it("is a no-op when no effectors are ground-locked", () => {
    const m = posedRaw(
      [
        'posecode posture "Reach"',
        "  rig humanoid",
        '  step "Up" 1s linear:',
        "    shoulders: flex 90",
      ].join("\n"),
    );
    const before = m.root.position.clone();
    applyGroundLock(m, []);
    expect(m.root.position.equals(before)).toBe(true);
  });

  it("groundFigure drops the lowest mesh point onto the floor", () => {
    const m = posedRaw(
      [
        'posecode posture "Stand"',
        "  rig humanoid",
        "  pose start = standing",
        '  step "Hold" 1s linear:',
        "    spine: hold neutral",
      ].join("\n"),
    );
    m.root.position.y += 0.5; // lift off the floor
    m.root.updateMatrixWorld(true);
    groundFigure(m);
    m.root.updateMatrixWorld(true);
    expect(new THREE.Box3().setFromObject(m.root).min.y).toBeCloseTo(0, 2);
  });
});

describe("contact pins", () => {
  // Replicate the viewer's applyPins: translate the root so the pinned effector
  // sits on the anchor, then read the pelvis height.
  const BONE: Record<string, string> = {
    hand_left: "wrist_left",
    hand_right: "wrist_right",
    foot_left: "ankle_left",
    foot_right: "ankle_right",
  };
  function pelvisYPinned(
    source: string,
    t: number,
    anchors: Map<string, THREE.Vector3>,
  ): number {
    const { ir } = parse(source);
    const tl = buildTimeline(ir!);
    const m = buildMannequin();
    const info = tl.sample(t, m.bones);
    m.root.updateMatrixWorld(true);
    const delta = new THREE.Vector3();
    let n = 0;
    for (const p of info.pins) {
      const eff = m.bones.get(BONE[p.effector] ?? p.effector);
      const a = anchors.get(p.anchor);
      if (!eff || !a) continue;
      delta.add(a.clone().sub(eff.getWorldPosition(new THREE.Vector3())));
      n++;
    }
    if (n > 0) {
      m.root.position.add(delta.multiplyScalar(1 / n));
      m.root.updateMatrixWorld(true);
    }
    return m.bones.get("pelvis")!.getWorldPosition(new THREE.Vector3()).y;
  }

  const PULLUP = [
    'posecode exercise "Pull-up"',
    "  rig humanoid",
    "  prop bar",
    "  pose start = standing",
    '  step "Hang" 1.5s ease-in-out:',
    "    shoulders: flex 175",
    "    elbows: flex 5",
    "    pin: hands bar",
    '  step "Pull up" 1.2s ease-out:',
    "    shoulders: flex 150",
    "    elbows: flex 130",
    "    pin: hands bar",
    "  repeat 2",
  ].join("\n");

  it("parses pins into the IR", () => {
    const { ir, errors, warnings } = parse(PULLUP);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    expect(ir!.props).toContain("bar");
    expect(ir!.phases[0]!.pins).toEqual([
      { effector: "hand_left", anchor: "bar" },
      { effector: "hand_right", anchor: "bar" },
    ]);
  });

  it("raises the body when pinned to the bar and the elbows flex", () => {
    const anchors = buildProps(["bar"]).anchors;
    // Sample inside each phase (not on the boundary, where sample() returns the
    // next keyframe's empty pins).
    const hang = pelvisYPinned(PULLUP, 1.49, anchors); // straight-arm hang
    const top = pelvisYPinned(PULLUP, 2.69, anchors); // elbows flexed → pulled up
    expect(top).toBeGreaterThan(hang + 0.2); // pelvis climbs toward the bar
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

describe("ROM-constrained reach-IK", () => {
  // The viewer's radian limit boxes, minus the current-pose widening (the rig
  // starts at rest here, which is inside every box).
  function limitsFor(id: string) {
    const rom = eulerRomFor(id);
    if (!rom) return null;
    const r = (d: number) => d * DEG;
    return {
      x: [r(rom.x.min), r(rom.x.max)] as [number, number],
      y: [r(rom.y.min), r(rom.y.max)] as [number, number],
      z: [r(rom.z.min), r(rom.z.max)] as [number, number],
    };
  }

  function armChain(m: ReturnType<typeof buildMannequin>) {
    const shoulder = m.bones.get("shoulder_right")!;
    const elbow = m.bones.get("elbow_right")!;
    return {
      joints: [shoulder, elbow],
      limits: [limitsFor("shoulder_right"), limitsFor("elbow_right")],
      effector: m.bones.get("wrist_right")!,
    };
  }

  it("still converges on a reachable in-front target", () => {
    const m = buildMannequin();
    m.root.updateMatrixWorld(true);
    const { joints, limits, effector } = armChain(m);
    const target = joints[0]!
      .getWorldPosition(new THREE.Vector3())
      .add(new THREE.Vector3(0.3, -0.2, 0.3));

    solveCCD({ joints, limits, effector, target }, 20);
    m.root.updateMatrixWorld(true);
    expect(
      effector.getWorldPosition(new THREE.Vector3()).distanceTo(target),
    ).toBeLessThan(0.06);
  });

  it("never pushes a chain joint past its ROM chasing an unsafe target", () => {
    const m = buildMannequin();
    m.root.updateMatrixWorld(true);
    const { joints, limits, effector } = armChain(m);
    const [shoulder, elbow] = joints;
    // High behind the back (figure faces +Z): reaching it would demand
    // shoulder extension far past the configured 60° ceiling.
    const target = shoulder!
      .getWorldPosition(new THREE.Vector3())
      .add(new THREE.Vector3(0, 0.3, -0.5));

    solveCCD({ joints, limits, effector, target }, 30);
    m.root.updateMatrixWorld(true);

    const eps = 1e-6;
    for (const [joint, lim] of [
      [shoulder!, limits[0]!],
      [elbow!, limits[1]!],
    ] as const) {
      const e = new THREE.Euler().setFromQuaternion(joint.quaternion, "XYZ");
      expect(e.x).toBeGreaterThanOrEqual(lim.x[0] - eps);
      expect(e.x).toBeLessThanOrEqual(lim.x[1] + eps);
      expect(e.y).toBeGreaterThanOrEqual(lim.y[0] - eps);
      expect(e.y).toBeLessThanOrEqual(lim.y[1] + eps);
      expect(e.z).toBeGreaterThanOrEqual(lim.z[0] - eps);
      expect(e.z).toBeLessThanOrEqual(lim.z[1] + eps);
    }
    // Sanity: unconstrained CCD DOES violate the shoulder ceiling here, so the
    // clamp above is load-bearing, not vacuous.
    const m2 = buildMannequin();
    m2.root.updateMatrixWorld(true);
    const free = armChain(m2);
    const target2 = free.joints[0]!
      .getWorldPosition(new THREE.Vector3())
      .add(new THREE.Vector3(0, 0.3, -0.5));
    solveCCD({ joints: free.joints, effector: free.effector, target: target2 }, 30);
    const eFree = new THREE.Euler().setFromQuaternion(
      free.joints[0]!.quaternion,
      "XYZ",
    );
    expect(eFree.x).toBeGreaterThan(60 * DEG + 0.05); // past configured extension
  });

  it("keeps a knee hinge-only: no lateral splay while a foot reaches", () => {
    const m = buildMannequin();
    m.root.updateMatrixWorld(true);
    const hip = m.bones.get("hip_right")!;
    const knee = m.bones.get("knee_right")!;
    const ankle = m.bones.get("ankle_right")!;
    // A target out to the side tempts unconstrained CCD to twist the knee
    // sideways; the ROM box zeroes the knee's Y/Z axes.
    const target = hip
      .getWorldPosition(new THREE.Vector3())
      .add(new THREE.Vector3(-0.5, -0.3, 0.2));

    solveCCD(
      {
        joints: [hip, knee],
        limits: [limitsFor("hip_right"), limitsFor("knee_right")],
        effector: ankle,
        target,
      },
      30,
    );
    const e = new THREE.Euler().setFromQuaternion(knee.quaternion, "XYZ");
    expect(Math.abs(e.y)).toBeLessThan(1e-6);
    expect(Math.abs(e.z)).toBeLessThan(1e-6);
  });
});

describe("frontal plane direction", () => {
  it("abduction carries arms and legs AWAY from the midline on both sides", () => {
    const { ir, errors } = parse(
      [
        'posecode exercise "Open"',
        "  rig humanoid",
        "  pose start = standing",
        '  step "Open" 1s linear:',
        "    shoulders: abduct 80",
        "    hips: abduct 30",
        "  repeat 1",
      ].join("\n"),
    );
    expect(errors).toEqual([]);
    const tl = buildTimeline(ir!);
    const m = buildMannequin();
    tl.sample(1, m.bones);
    m.root.updateMatrixWorld(true);

    // Each distal joint must sit FURTHER from the midline (|x|) than its
    // proximal joint, on the SAME side: the inverted sign swung all four
    // limbs across the body instead.
    for (const [distal, proximal] of [
      ["wrist_left", "shoulder_left"],
      ["wrist_right", "shoulder_right"],
      ["ankle_left", "hip_left"],
      ["ankle_right", "hip_right"],
    ] as const) {
      const d = m.bones.get(distal)!.getWorldPosition(new THREE.Vector3());
      const p = m.bones.get(proximal)!.getWorldPosition(new THREE.Vector3());
      expect(Math.sign(d.x)).toBe(Math.sign(p.x));
      expect(Math.abs(d.x)).toBeGreaterThan(Math.abs(p.x));
    }
  });
});

describe("face marker", () => {
  it("marks the head's front (+Z) so facing and neck turns are readable", () => {
    const m = buildMannequin();
    const face = m.bones.get("head")!.getObjectByName("face");
    expect(face).toBeTruthy();
    expect(face!.children.length).toBeGreaterThanOrEqual(3); // nose + two eyes
    // Every face element sits on the figure's front side of the head ball.
    for (const part of face!.children) {
      expect(part.position.z).toBeGreaterThan(0.04);
    }
  });
});

describe("hand rig articulation", () => {
  it("finger bones carry their own digit meshes, so curls are visible", () => {
    const m = buildMannequin();
    m.root.updateMatrixWorld(true);
    const index = m.bones.get("index_right")!;
    expect(index.children.length).toBeGreaterThan(0); // the digit capsule

    // Curl the finger 90° and check the digit's far end actually moves.
    const digit = index.children[0]!;
    const tipBefore = digit.getWorldPosition(new THREE.Vector3());
    index.rotation.x = -90 * DEG;
    m.root.updateMatrixWorld(true);
    const tipAfter = digit.getWorldPosition(new THREE.Vector3());
    expect(tipBefore.distanceTo(tipAfter)).toBeGreaterThan(0.015);
  });
});

describe("dip bars prop", () => {
  it("exposes a `bars` grip anchor at support height", () => {
    const { anchors, group } = buildProps(["dip-bars"]);
    expect(anchors.has("bars")).toBe(true);
    const grip = anchors.get("bars")!;
    expect(grip.y).toBeGreaterThan(0.9); // high enough that feet clear the floor
    expect(grip.y).toBeLessThan(1.6); // but well below the pull-up bar
    expect(group.children.length).toBeGreaterThan(0);
    expect(anchors.get("bars_left")!.x).toBeGreaterThan(0);
    expect(anchors.get("bars_right")!.x).toBeLessThan(0);
    expect(anchors.get("bars_left")!.y).toBeCloseTo(grip.y, 6);
    expect(anchors.get("bars_left")!.distanceTo(anchors.get("bars_right")!)).toBeGreaterThan(0.4);
  });

  // Same root-translation logic as the viewer's applyPins (see contact pins).
  function pelvisYAt(source: string, t: number, anchors: Map<string, THREE.Vector3>): number {
    const BONE: Record<string, string> = {
      hand_left: "wrist_left",
      hand_right: "wrist_right",
      foot_left: "ankle_left",
      foot_right: "ankle_right",
    };
    const { ir } = parse(source);
    const tl = buildTimeline(ir!);
    const m = buildMannequin();
    const info = tl.sample(t, m.bones);
    m.root.updateMatrixWorld(true);
    const delta = new THREE.Vector3();
    let n = 0;
    for (const pin of info.pins) {
      const eff = m.bones.get(BONE[pin.effector] ?? pin.effector);
      const a = anchors.get(pin.anchor);
      if (!eff || !a) continue;
      delta.add(a.clone().sub(eff.getWorldPosition(new THREE.Vector3())));
      n++;
    }
    if (n > 0) {
      m.root.position.add(delta.multiplyScalar(1 / n));
      m.root.updateMatrixWorld(true);
    }
    return m.bones.get("pelvis")!.getWorldPosition(new THREE.Vector3()).y;
  }

  it("lowers the body between the bars as the elbows flex (dip bottom)", () => {
    const dips = [
      'posecode exercise "Dips"',
      "  rig humanoid",
      "  prop dip-bars",
      "  pose start = standing",
      '  step "Support" 1s ease-out:',
      "    elbows: flex 5",
      "    knees: flex 70",
      "    pin: hands bars",
      '  step "Lower" 1s ease-in-out:',
      "    shoulders: extend 30",
      "    elbows: flex 90",
      "    knees: flex 70",
      "    pin: hands bars",
      "  repeat 4",
    ].join("\n");
    const anchors = buildProps(["dip-bars"]).anchors;
    const support = pelvisYAt(dips, 0.99, anchors);
    const bottom = pelvisYAt(dips, 1.99, anchors);
    expect(support).toBeGreaterThan(0.9); // hips held up at bar height
    expect(bottom).toBeLessThan(support - 0.08); // body sinks into the dip
  });
});

describe("cobra", () => {
  it("arches the chest and head up off the floor during the Lift", () => {
    const src = [
      'posecode stretch "Cobra"',
      "  rig humanoid",
      "  pose start = prone",
      '  step "Lift" 2.5s ease-in-out:',
      "    spine: extend 30",
      "    chest: extend 15",
      "    neck: extend 25",
      "    shoulders: flex 50",
      "    elbows: flex 25",
      "    reach: hands floor",
      "  repeat 1",
    ].join("\n");
    const { ir, errors, warnings } = parse(src);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    const tl = buildTimeline(ir!);
    const m = buildMannequin();

    // Apply the prone base root like the viewer does.
    const base = tl.basePose.root!;
    m.root.rotation.set(...(base.rotationDeg!.map((d) => d * DEG) as [number, number, number]));

    tl.sample(0, m.bones);
    m.root.updateMatrixWorld(true);
    const headFlat = m.bones.get("head")!.getWorldPosition(new THREE.Vector3()).y;
    const pelvisFlat = m.bones.get("pelvis")!.getWorldPosition(new THREE.Vector3()).y;

    tl.sample(2.5, m.bones);
    m.root.updateMatrixWorld(true);
    const headUp = m.bones.get("head")!.getWorldPosition(new THREE.Vector3()).y;
    const pelvisUp = m.bones.get("pelvis")!.getWorldPosition(new THREE.Vector3()).y;

    // The head rises well above its flat height while the pelvis stays put.
    expect(headUp - headFlat).toBeGreaterThan(0.2);
    expect(Math.abs(pelvisUp - pelvisFlat)).toBeLessThan(0.05);
  });
});

describe("spline interpolation (L2)", () => {
  it("interpolates joints with continuous velocity through an interior keyframe", () => {
    const src = [
      'posecode exercise "flowy"',
      "  rig humanoid",
      '  step "A" 1s flow:',
      "    shoulders: flex 40",
      '  step "B" 1s flow:',
      "    shoulders: flex 120",
      '  step "C" 1s flow:',
      "    shoulders: flex 40",
    ].join("\n");
    const { ir } = parse(src);
    const tl = buildTimeline(ir!);
    const m = buildMannequin();
    const read = (t: number) => {
      tl.sample(t, m.bones);
      return m.bones.get("shoulder_left")!.quaternion.clone();
    };
    const eps = 1e-3;
    const kf = 2; // end of "B" is an interior keyframe (t=2)
    const vBefore = read(kf).angleTo(read(kf - eps)) / eps;
    const vAfter = read(kf + eps).angleTo(read(kf)) / eps;
    expect(Math.abs(vBefore - vAfter)).toBeLessThan(0.3); // flow carries velocity
  });

  it("settle brings a joint to rest at its keyframe", () => {
    const src = [
      'posecode exercise "rest"',
      "  rig humanoid",
      '  step "Down" 1s settle:',
      "    knees: flex 90",
      '  step "Up" 1s drive:',
      "    knees: flex 0",
    ].join("\n");
    const { ir } = parse(src);
    const tl = buildTimeline(ir!);
    const m = buildMannequin();
    const read = (t: number) => {
      tl.sample(t, m.bones);
      return m.bones.get("knee_left")!.quaternion.clone();
    };
    const eps = 1e-3;
    const v = read(1).angleTo(read(1 - eps)) / eps; // velocity arriving at the settle kf
    expect(v).toBeLessThan(0.2);
  });
});

describe("foot-flat correction (L3.1)", () => {
  it("rests a squatting foot flatter on the floor (not on the toes)", () => {
    const src = [
      'posecode exercise "sq"',
      "  rig humanoid",
      "  pose start = standing",
      '  step "Descend" 1s settle:',
      "    hips: flex 80",
      "    knees: flex 95",
      "    pelvis: hinge 25",
      "    ground-lock: feet",
    ].join("\n");
    const { ir } = parse(src);
    const tl = buildTimeline(ir!);
    const m = buildMannequin();
    tl.sample(1, m.bones);
    m.root.updateMatrixWorld(true);
    groundFigure(m);
    applyGroundLock(m, ["feet"]);
    const soleDot = () => {
      const ankle = m.bones.get("ankle_left")!;
      return new THREE.Vector3(0, -1, 0)
        .applyQuaternion(ankle.getWorldQuaternion(new THREE.Quaternion()))
        .normalize()
        .dot(new THREE.Vector3(0, -1, 0));
    };
    const before = soleDot();
    levelPlantedFeet(m, ["feet"]);
    m.root.updateMatrixWorld(true);
    // Leveling makes the sole markedly flatter than raw ground-lock leaves it.
    expect(soleDot()).toBeGreaterThan(before);
    expect(soleDot()).toBeGreaterThan(0.9);
  });
});

describe("bar grip (L3.2)", () => {
  it("exposes two-point bar grip anchors shoulder-width apart", () => {
    const { anchors } = buildProps(["bar"]);
    const l = anchors.get("bar_left");
    const r = anchors.get("bar_right");
    expect(l).toBeDefined();
    expect(r).toBeDefined();
    expect(l!.x).toBeGreaterThan(0); // left hand grips the +X side
    expect(r!.x).toBeLessThan(0);
    expect(Math.abs(l!.x - r!.x)).toBeCloseTo(0.36, 2);
    expect(l!.y).toBeCloseTo(r!.y, 5); // same bar height
  });

  it("wraps the fingers of a gripping hand into a curl", () => {
    const m = buildMannequin();
    const restIndex = m.bones.get("index_left")!.rotation.x;
    const restThumb = m.bones.get("thumb_left")!.rotation.x;
    wrapGrip(m, [{ effector: "hand_left", anchor: "bar_left" }]);
    // Finger flexion is local -X in the rig/parser ROM convention. The former
    // positive renderer curl was actually extension (digits bent off the palm).
    expect(m.bones.get("index_left")!.rotation.x).toBeLessThan(restIndex - 0.5);
    expect(m.bones.get("middle_left")!.rotation.x).toBeLessThan(-0.5);
    expect(m.bones.get("thumb_left")!.rotation.x).toBeLessThan(restThumb - 0.3);
    // the un-gripped right hand is untouched
    expect(m.bones.get("index_right")!.rotation.x).toBeCloseTo(0, 5);
  });
});

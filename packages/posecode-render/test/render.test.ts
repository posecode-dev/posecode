import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { buildMannequin } from "../src/mannequin.js";
import { buildTimeline } from "../src/timeline.js";
import { solveCCD } from "../src/ik.js";
import { poseFor } from "../src/poses.js";
import { buildProps } from "../src/props.js";
import { applyGroundLock, groundFigure } from "../src/groundlock.js";
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
    expect(m.effectors.feet).toEqual(["ankle_left", "ankle_right"]);
  });
});

describe("timeline", () => {
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
    "    pin: hand_left bar",
    "    pin: hand_right bar",
    '  step "Pull up" 1.2s ease-out:',
    "    shoulders: flex 150",
    "    elbows: flex 130",
    "    pin: hand_left bar",
    "    pin: hand_right bar",
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
    // shoulder extension far past the 60° healthy ceiling.
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
    expect(eFree.x).toBeGreaterThan(60 * DEG + 0.05); // past healthy extension
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

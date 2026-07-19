import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { Proportions } from "posecode-render";
import { loadXbotCharacter } from "../src/xbot.js";
import {
  loadFixtures,
  probeMovement,
  renderReport,
  runEval,
  torsoPitchDeg,
  kneeFlexionDeg,
  balanceOverflow,
  footSkateDistance,
  footWorldSkateDistance,
  headPropClearance,
  palmFloorAngleDeg,
  phaseMaxLandmarkSpeed,
  spineCurlDeg,
} from "../src/index.js";

const examplesDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../spec/examples",
);

describe("probe", () => {
  it("reports parse errors instead of throwing", () => {
    const r = probeMovement("not posecode at all");
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.phases).toEqual([]);
  });

  it("returns world-space bones for every phase", () => {
    const r = probeMovement(
      ['posecode exercise "t"', "  rig humanoid", '  step "go" 1s linear:', "    elbows: flex 90"].join("\n"),
    );
    expect(r.ok).toBe(true);
    expect(r.phases).toHaveLength(1);
    expect(r.phases[0]!.bones.size).toBeGreaterThanOrEqual(17);
  });

  it("fails an unreachable declared hand-to-floor contact instead of silently passing", () => {
    const source = [
      'posecode posture "Unreachable floor reach"',
      "  rig humanoid",
      "  pose start = standing",
      '  step "Reach" 1s settle:',
      "    reach: hand_left floor",
      "    ground-lock: feet",
    ].join("\n");
    const result = runEval([{ movement: "unreachable-floor-reach", source }]);
    const contact = probeMovement(source).phases[0]!.contactResiduals[0]!;

    expect(contact.status).toBe("resolved");
    expect(contact.error).toBeGreaterThan(0.03);
    expect(result.movements[0]!.checks).toContainEqual(expect.objectContaining({
      id: expect.stringContaining("contact-position:Reach:reach:hand_left:floor"),
      pass: false,
    }));
  });

  it("forms a semantic fist before measuring its production floor target", () => {
    const source = [
      'posecode posture "Fist contact"',
      "  rig humanoid",
      "  pose start = standing",
      '  step "Plant" 1s settle:',
      "    pelvis: hinge 110",
      "    reach: fist_left floor",
      "    ground-lock: foot_right",
    ].join("\n");
    const phase = probeMovement(source).phases[0]!;
    const finger = phase.boneQuaternions.get("index_left")!;
    const contact = phase.contactResiduals[0]!;

    expect(finger).not.toEqual([0, 0, 0, 1]);
    expect(contact.effector).toBe("fist_left");
    expect(contact.effectorBone).toBe("wrist_left");
    expect(contact.targetPosition).not.toBeNull();
  });

  it("uses supplied character proportions throughout runEval", () => {
    const source = [
      'posecode posture "Proportion probe"',
      "  rig humanoid",
      "  pose start = standing",
      '  step "Reach" 1s settle:',
      "    reach: hand_left knee_left",
      "    ground-lock: feet",
    ].join("\n");
    const longLeftArm: Proportions = {
      offsets: {
        elbow_left: [0, -0.47, 0],
        wrist_left: [0, -0.47, 0],
      },
    };
    const contactPasses = (proportions?: Proportions): boolean => {
      const report = runEval(
        [{ movement: "proportion-probe", source }],
        proportions ? { proportions } : {},
      );
      return report.movements[0]!.checks.find((check) =>
        check.id.startsWith("contact-position:"),
      )!.pass;
    };

    expect(contactPasses()).toBe(false);
    expect(contactPasses(longLeftArm)).toBe(true);
  });
});

describe("clip-wide constraint diagnostics", () => {
  const fixtures = loadFixtures(examplesDir);
  const source = (name: string) => fixtures.find((fixture) => fixture.movement === name)!.source;

  it("keeps the deadlift heels planted through the hinge and still flags the demi-plié lift", () => {
    const deadlift = probeMovement(source("deadlift"));
    const plie = probeMovement(source("demi-plie"));

    expect(deadlift.diagnostics.sampleCount).toBeGreaterThan(deadlift.phases.length);
    // The hip hinge keeps soft knees (18°) inside the ankle's dorsiflexion ROM
    // (20°), so both soles stay flat on the floor across the whole clip.
    expect(deadlift.diagnostics.feet.left.maxHeelHeightMeters).toBeLessThan(0.005);
    expect(deadlift.diagnostics.warnings).toHaveLength(0);

    // The demi-plié still drives the ankle past its dorsiflexion ROM, so it
    // remains the exemplar of a reported heel-lift / grounding conflict.
    expect(plie.diagnostics.feet.left.maxHeelHeightMeters).toBeGreaterThan(0.02);
    expect(plie.diagnostics.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "clip-heel-height:foot_left", phaseName: "Plié" }),
      expect.objectContaining({
        id: "clip-grounding-rom-conflict:foot_left",
        phaseName: "Plié",
        kind: "grounding-rom-conflict",
      }),
    ]));
  });

  it("detects the residual arm collision while touch-toes lowers its arms", () => {
    const result = probeMovement(source("touch-toes"));
    const collision = result.diagnostics.warnings.find((warning) =>
      warning.id === "self-collision:arm_left:body",
    );

    expect(collision).toEqual(expect.objectContaining({
      kind: "self-collision",
      phaseName: "Rise",
    }));
    expect(collision!.value).toBeGreaterThan(0.08);
    expect(collision!.timeSec).toBeGreaterThan(2.5);
    expect(collision!.timeSec).toBeLessThan(4.5);
  });

  it("keeps strict diagnostics visible but non-gating in EvalReport and CLI text", () => {
    const report = runEval([{ movement: "demi-plie", source: source("demi-plie") }]);
    const movement = report.movements[0]!;
    const text = renderReport(report);

    expect(movement.passed).toBe(movement.total);
    expect(movement.diagnostics.warnings.length).toBeGreaterThan(0);
    expect(report.summary.constraintWarnings).toBe(movement.diagnostics.warnings.length);
    expect(text).toContain("⚠ clip-heel-height:foot_left");
    expect(text).toContain("constraint warnings");
  });

  it("accepts a bounded diagnostic sampling rate", () => {
    const low = probeMovement(source("deadlift"), undefined, undefined, {
      diagnosticSampleRateHz: 4,
    });
    const high = probeMovement(source("deadlift"), undefined, undefined, {
      diagnosticSampleRateHz: 24,
    });
    expect(low.diagnostics.sampleRateHz).toBe(4);
    expect(high.diagnostics.sampleRateHz).toBe(24);
    expect(high.diagnostics.sampleCount).toBeGreaterThan(low.diagnostics.sampleCount);
  });

  it("anchors intentional rises at the toe while retaining real planted drift", () => {
    for (const movement of ["heel-raises", "releve"]) {
      const result = probeMovement(source(movement));
      expect(result.diagnostics.warnings.some((warning) =>
        warning.kind === "foot-drift",
      )).toBe(false);
      expect(result.diagnostics.feet.left.maxTiptoeDriftMeters).toBeGreaterThan(0);
    }

    const translated = probeMovement(source("jumping-jacks"));
    expect(translated.diagnostics.warnings).toContainEqual(expect.objectContaining({
      id: "clip-foot-drift:foot_left",
      kind: "foot-drift",
      phaseName: "Out",
    }));
    expect(translated.diagnostics.feet.left.maxPlantigradeDriftMeters).toBeGreaterThan(0.4);
  });

  it("keeps XBot heel raises and relevé below the toe-anchor drift warning", async () => {
    const xbot = await loadXbotCharacter(new URL(
      "../../../playground/public/models/xbot.glb",
      import.meta.url,
    ));
    try {
      for (const movement of ["heel-raises", "releve"]) {
        const result = probeMovement(source(movement), xbot.proportions, xbot);
        expect(result.diagnostics.warnings.some((warning) =>
          warning.kind === "foot-drift",
        )).toBe(false);
        expect(result.diagnostics.feet.left.maxTiptoeDriftMeters).toBeLessThan(0.04);
      }
    } finally {
      xbot.dispose();
    }
  });
});

describe("metrics", () => {
  const hinged = probeMovement(
    ['posecode exercise "t"', "  rig humanoid", '  step "go" 1s linear:', "    pelvis: hinge 70"].join("\n"),
  ).phases[0]!;
  const standing = probeMovement(
    ['posecode posture "t"', "  rig humanoid", '  step "go" 1s linear:', "    spine: hold neutral"].join("\n"),
  ).phases[0]!;

  it("measures torso pitch: ~0 standing, ~70 hinged", () => {
    expect(torsoPitchDeg(standing)).toBeLessThan(3);
    expect(torsoPitchDeg(hinged)).toBeGreaterThan(60);
  });

  it("measures knee flexion: straight legs ≈ 0", () => {
    expect(kneeFlexionDeg(standing, "left")).toBeLessThan(3);
    expect(kneeFlexionDeg(hinged, "left")).toBeLessThan(3);
  });

  it("a hinge keeps the spine straight (no curl)", () => {
    expect(spineCurlDeg(hinged)).toBeLessThan(5);
  });

  it("measures semantic contact, balance, prop clearance, and transition speed", () => {
    const fixtures = loadFixtures(examplesDir);
    const movement = (name: string) => probeMovement(fixtures.find((f) => f.movement === name)!.source);

    const palmDownQuaternions = new Map(standing.boneQuaternions);
    const halfTurn = Math.SQRT1_2;
    palmDownQuaternions.set("wrist_left", [halfTurn, 0, 0, halfTurn]);
    expect(palmFloorAngleDeg({ ...standing, boneQuaternions: palmDownQuaternions }, "left")).toBeLessThan(0.01);

    const deadlift = movement("deadlift");
    expect(footSkateDistance(deadlift.phases[0]!, deadlift.phases[1]!, "left")).toBeLessThan(0.2);
    expect(balanceOverflow(deadlift.phases[0]!)).toBeLessThan(0.3);
    expect(phaseMaxLandmarkSpeed(deadlift.phases[0]!, deadlift.phases[1]!)).toBeLessThan(4);

    const pullUp = movement("pull-up");
    expect(Math.min(...pullUp.phases.map((p) => headPropClearance(pullUp, p)))).toBeGreaterThan(-0.01);

    // A dead bug moves opposite limbs while the torso remains planted. This
    // catches the old silent `ground-lock: back` no-op, where whole-figure
    // floor reconciliation could move the torso with whichever limb was lowest.
    const deadBug = movement("dead-bug");
    for (const id of ["pelvis", "chest"]) {
      const heights = deadBug.phases.map((p) => p.bones.get(id)![1]);
      expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(0.01);
    }

    const lunge = movement("forward-lunge");
    // The back-foot pin is fixed in the scene. Removing authored travel from
    // its measurement fabricates 30 cm of skate even though world drift is 0.
    expect(footWorldSkateDistance(lunge.phases[0]!, lunge.phases[1]!, "left")).toBeLessThan(1e-4);
    expect(footSkateDistance(lunge.phases[0]!, lunge.phases[1]!, "left")).toBeGreaterThan(0.25);
  });

  it("does not auto-pass a single support point", () => {
    const bones = new Map(standing.bones);
    for (const [id, point] of bones) {
      if (id === "ankle_left") continue;
      bones.set(id, [point[0] + 1, point[1], point[2]]);
    }
    const offBalance = { ...standing, groundLock: ["foot_left"], bones };

    expect(balanceOverflow(offBalance)).toBeGreaterThan(0.5);
  });

  it("carries a solved ground-lock support into a newly introduced floor pin", () => {
    const source = [
      'posecode exercise "Support handoff"',
      "  rig humanoid",
      "  pose start = standing",
      '  step "Lower" 1s settle:',
      "    hip_left: flex 80",
      "    knee_left: flex 95",
      "    ground-lock: foot_left",
      '  step "Transfer" 0.5s settle:',
      "    pin: foot_left floor",
    ].join("\n");
    const result = probeMovement(source);
    expect(result.errors).toEqual([]);
    expect(footWorldSkateDistance(result.phases[0]!, result.phases[1]!, "left")).toBeLessThan(0.03);
  });
});

describe("fixture scorecard", () => {
  it("scores every declared canonical contact and keeps the fallback catalog green", () => {
    const fixtures = loadFixtures(examplesDir);
    // This test validates the scorecard/contact catalog, not diagnostic peak
    // sampling. Keep one clip-wide sample per second so the full fixture pass
    // remains stable on slower shared CI runners.
    const report = runEval(fixtures, { diagnosticSampleRateHz: 1 });
    const declaredContacts = fixtures.reduce(
      (count, fixture) => count + probeMovement(
        fixture.source,
        undefined,
        undefined,
        { diagnosticSampleRateHz: 1 },
      ).contactResiduals.length,
      0,
    );
    const contactChecks = report.movements.flatMap((movement) =>
      movement.checks.filter((check) => check.id.startsWith("contact-")),
    );

    expect(contactChecks).toHaveLength(declaredContacts);
    expect(contactChecks.every((check) => check.pass)).toBe(true);
    expect(report.summary.parseFailures).toBe(0);
    expect(report.summary.clampWarnings).toBe(0);
    expect(report.summary.checksPassed).toBe(report.summary.checksTotal);
  }, 20_000);

  it("does not give the supplied bad superhero landing a perfect score", () => {
    const source = `posecode posture "Superhero Three-Point Landing"
  rig humanoid
  pose start = standing

  step "Drop into the landing" 0.7s drive:
    pelvis: hinge 35
    hip_left: flex 95
    hip_right: flex 65
    knee_left: flex 125
    knee_right: flex 90
    ankle_left: dorsiflex 12
    ankle_right: dorsiflex 15
    chest: rotate-out 18
    shoulder_left: flex 55
    shoulder_right: flex 145
    elbow_left: flex 20
    elbow_right: flex 95
    fingers: flex 65
    ground-lock: feet
    cue "Drop low with the right foot forward and the left knee close to the floor"

  step "Plant the fist" 0.35s settle:
    pelvis: hinge 50
    hip_left: flex 110
    hip_right: flex 80
    knee_left: flex 138
    knee_right: flex 105
    ankle_left: dorsiflex 10
    ankle_right: dorsiflex 15
    shoulder_left: flex 70
    shoulder_right: flex 150
    shoulder_right: abduct 35
    elbow_left: flex 10
    elbow_right: flex 105
    wrist_left: hold neutral 0
    wrist_right: flex 20
    fingers_left: flex 70
    fingers_right: flex 55
    reach: hand_left floor
    ground-lock: feet
    cue "Plant the left fist beside the body while the right arm arcs overhead"

  step "Hero pose" 1.5s linear:
    neck: extend 8
    head: rotate-out 12
    chest: extend 10
    chest: rotate-out 22
    shoulder_left: flex 70
    shoulder_right: flex 155
    shoulder_right: abduct 40
    elbow_left: flex 8
    elbow_right: flex 110
    wrist_right: flex 25
    fingers_left: flex 75
    fingers_right: flex 60
    reach: hand_left floor
    ground-lock: feet
    cue "Hold the low three-point stance with the chest open and the raised arm curved overhead"

  repeat 1`;
    const supplied = runEval([{ movement: "superhero-landing", source }]).movements[0]!;
    expect(supplied.passed).toBeLessThan(supplied.total);

    // Strict language validation may reject the supplied trailing `0`. Remove
    // only that syntax error and verify the kinematic/contact score still fails:
    // a parse failure must not be the evaluator's sole line of defence.
    const syntacticallyValid = source.replace("wrist_left: hold neutral 0", "wrist_left: hold neutral");
    const movement = runEval([{ movement: "superhero-landing", source: syntacticallyValid }]).movements[0]!;
    const failed = movement.checks.filter((check) => !check.pass);
    expect(movement.parseOk).toBe(true);
    expect(movement.passed).toBeLessThan(movement.total);
    expect(failed.some((check) => check.id.startsWith("contact-position:"))).toBe(true);
  });

  it("rejects a superhero landing whose planted fist faces away from the body", () => {
    const fixtures = loadFixtures(examplesDir);
    const source = fixtures.find((fixture) => fixture.movement === "superhero-landing")!.source;
    const outward = source.replace("elbow_left: pronate 80", "elbow_left: supinate 80");
    const check = runEval([{ movement: "superhero-landing", source: outward }])
      .movements[0]!.checks.find((item) => item.id === "planted-fist-palm-inward");

    expect(check).toEqual(expect.objectContaining({ pass: false }));
  });
});

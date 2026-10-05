import { describe, it, expect } from "vitest";
import { parse } from "posecode-parser";
import { probeMovement } from "../src/index.js";
import { kneeFlexionDeg, heightOf } from "../src/metrics.js";

const PROBE_540 = `posecode exercise "540 Kick Capability Probe"
  rig humanoid
  pose start = standing

  step "Cheat prep" 0.45s flow:
    turn: 90
    hip_left: flex 25
    knee_left: flex 35
    hip_right: flex 15
    knee_right: flex 25
    ground-lock: feet
    cue "Cheat step and torso dip to generate rotational momentum"

  step "Takeoff plant" 0.25s flow:
    turn: 180
    hip_left: flex 35
    knee_left: flex 45
    hip_right: flex 40
    knee_right: flex 30
    shoulder_right: flex 120
    shoulder_left: flex 120
    pin: foot_left floor
    cue "Plant left foot explosively, swing right leg and arms upward"

  step "Inversion and chamber" 0.25s flow:
    turn: 270
    knee_left: flex 95
    hip_left: flex 85
    hip_right: abduct 45
    cue "Launch into air, chamber non-kicking left knee tightly to chest"

  step "Apex crescent kick" 0.25s flow:
    turn: 360
    hip_right: abduct 45
    hip_right: flex 70
    knee_right: extend 0
    ankle_right: plantarflex 35
    knee_left: flex 90
    cue "Apex of jump: whip right leg through high crescent kick"

  step "Scissor switch" 0.20s flow:
    turn: 450
    hip_right: flex 35
    knee_right: flex 25
    hip_left: extend 10
    knee_left: flex 45
    cue "Switch legs mid-air: right leg reaches down to receive landing"

  step "Single-leg landing" 0.35s settle:
    turn: 540
    hip_right: flex 40
    knee_right: flex 45
    ankle_right: dorsiflex 12
    hip_left: flex 30
    knee_left: flex 75
    pin: foot_right floor
    cue "Land cleanly on the kicking right leg, absorbing shock through the knee"

  step "Recovery" 0.50s settle:
    turn: 540
    knees: flex 15
    ground-lock: feet
    cue "Step down with left foot into balanced guard stance"
`;

describe("540 kick capability probe (Issue #106)", () => {
  it("parses the complete 540 movement sequence with zero errors and zero ROM warnings", () => {
    const { ir, errors, warnings } = parse(PROBE_540);
    expect(errors).toHaveLength(0);
    expect(warnings).toHaveLength(0);
    expect(ir?.phases).toHaveLength(7);
  });

  it("verifies multi-turn yaw (540°) and single-leg landing semantics", () => {
    const probe = probeMovement(PROBE_540);
    expect(probe.ok).toBe(true);
    expect(probe.phases).toHaveLength(7);

    const takeoff = probe.phases.find((p) => p.name === "Takeoff plant")!;
    const chamber = probe.phases.find((p) => p.name === "Inversion and chamber")!;
    const apex = probe.phases.find((p) => p.name === "Apex crescent kick")!;
    const landing = probe.phases.find((p) => p.name === "Single-leg landing")!;

    // Takeoff plants on left foot
    expect(takeoff.pins.some((p) => p.effector === "foot_left")).toBe(true);

    // Mid-air chamber has non-kicking left knee deeply bent
    expect(kneeFlexionDeg(chamber, "left")).toBeGreaterThan(80);

    // Apex crescent kick has kicking leg extended
    expect(kneeFlexionDeg(apex, "right")).toBeLessThan(5);

    // Single-leg landing lands on the KICKING right foot (the core 540 signature)
    expect(landing.pins.some((p) => p.effector === "foot_right")).toBe(true);
    expect(kneeFlexionDeg(landing, "right")).toBeGreaterThan(35);

    // Yaw reaches 540 degrees (3π radians)
    expect(Math.abs(landing.rootYaw - 3 * Math.PI)).toBeLessThan(0.05);
  });

  it("identifies the free-flight grounding gap: lowest joint drops to floor in absence of elevation channel", () => {
    const probe = probeMovement(PROBE_540);
    const apex = probe.phases.find((p) => p.name === "Apex crescent kick")!;

    // In physical reality, apex height is ~0.8m above floor.
    // In current Posecode runtime (Gap 1), bounding-box drop forces the lowest foot near 0.
    const lowestFootY = Math.min(
      heightOf(apex, "ankle_left"),
      heightOf(apex, "ankle_right"),
    );
    // Proves that lowest point sits on the floor rather than in ballistic flight
    expect(lowestFootY).toBeLessThan(0.35);
  });
});

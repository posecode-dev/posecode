import { describe, it, expect } from "vitest";
import { romFor } from "../src/rom.js";
import { expandJoint, actionAxis } from "../src/joints.js";

describe("rom table", () => {
  it("knows the knee flexion ceiling (research Table 2: 144°)", () => {
    expect(romFor("knee_left", "flex")).toEqual({ min: 0, max: 144 });
  });

  it("knows the elbow flexion ceiling (research Table 1: 154°)", () => {
    expect(romFor("elbow_right", "flex")).toEqual({ min: 0, max: 154 });
  });

  it("limits knee hyperextension to a few degrees", () => {
    const rom = romFor("knee_left", "extend");
    expect(rom).not.toBeNull();
    expect(rom!.max).toBeLessThanOrEqual(10);
  });

  it("returns null for an unknown joint/action pair", () => {
    expect(romFor("head", "plantarflex")).toBeNull();
  });
});

describe("joint vocabulary", () => {
  it("expands symmetric groups into left/right bones", () => {
    expect(expandJoint("elbows").sort()).toEqual(["elbow_left", "elbow_right"]);
    expect(expandJoint("shoulders").sort()).toEqual([
      "shoulder_left",
      "shoulder_right",
    ]);
  });

  it("passes through an explicit single bone", () => {
    expect(expandJoint("knee_left")).toEqual(["knee_left"]);
  });

  it("maps flex/extend to opposite signs on the same axis", () => {
    const flex = actionAxis("flex");
    const extend = actionAxis("extend");
    expect(flex!.axis).toBe(extend!.axis);
    expect(Math.sign(flex!.sign)).toBe(-Math.sign(extend!.sign));
  });

  it("returns null for an unknown action", () => {
    expect(actionAxis("teleport")).toBeNull();
  });
});

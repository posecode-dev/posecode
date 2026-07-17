import { describe, it, expect } from "vitest";
import { romFor, eulerRomFor } from "../src/rom.js";
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

describe("euler ROM boxes (eulerRomFor)", () => {
  it("unions elbow flex/extend into a signed X range (flex is -X off the knee)", () => {
    const box = eulerRomFor("elbow_right")!;
    expect(box.x).toEqual({ min: -154, max: 10 }); // flex 154 → -X, extend 10 → +X
  });

  it("locks axes with no ROM entry, making the knee a pure hinge", () => {
    const box = eulerRomFor("knee_right")!;
    expect(box.x).toEqual({ min: -5, max: 144 }); // knee flexes toward +X
    expect(box.y).toEqual({ min: 0, max: 0 });
    expect(box.z).toEqual({ min: 0, max: 0 });
  });

  it("mirrors Y/Z ranges on left-side bones", () => {
    const right = eulerRomFor("elbow_right")!;
    const left = eulerRomFor("elbow_left")!;
    // supinate 92 / pronate 84 flip sides under the mirror.
    expect(right.y).toEqual({ min: -92, max: 84 });
    expect(left.y).toEqual({ min: -84, max: 92 });
    // X (sagittal) is never mirrored.
    expect(left.x).toEqual(right.x);
  });

  it("covers the ankle via dorsiflex/plantarflex and the pelvis via hinge", () => {
    // Toes point +Z: dorsiflexion (toes up) is -X, plantarflexion +X.
    expect(eulerRomFor("ankle_left")!.x).toEqual({ min: -15, max: 50 });
    // The pelvis' torso child points up: the forward hinge is +X.
    expect(eulerRomFor("pelvis")!.x).toEqual({ min: 0, max: 120 });
  });

  it("bounds the upper-cervical head share independently from the neck", () => {
    const box = eulerRomFor("head")!;
    expect(box.x).toEqual({ min: -25, max: 25 });
    expect(box.y).toEqual({ min: -40, max: 40 });
    expect(box.z).toEqual({ min: -20, max: 20 });
  });
});

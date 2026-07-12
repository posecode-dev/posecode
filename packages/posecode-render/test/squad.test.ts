import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { squad, squadControl } from "../src/squad.js";

const q = (x: number, y: number, z: number) =>
  new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, "XYZ"));

describe("squad", () => {
  it("passes exactly through segment endpoints", () => {
    const q0 = q(0, 0, 0);
    const q1 = q(0, 1, 0);
    const s0 = squadControl(q(0, -0.5, 0), q0, q1);
    const s1 = squadControl(q0, q1, q(0, 1.5, 0));
    const at0 = squad(q0, s0, s1, q1, 0);
    const at1 = squad(q0, s0, s1, q1, 1);
    expect(at0.angleTo(q0)).toBeLessThan(1e-6);
    expect(at1.angleTo(q1)).toBeLessThan(1e-6);
  });

  it("is C1-continuous across a shared interior keyframe (slerp is not)", () => {
    const k0 = q(0, 0, 0);
    const k1 = q(0, 1, 0);
    const k2 = q(0, 1.2, 0.8); // direction change at k1
    const c_before = squadControl(k0, k1, k2); // control at k1 for both segs
    const c0 = squadControl(q(0, -1, 0), k0, k1); // control at k0
    const c2 = squadControl(k1, k2, q(0, 0.4, 1.6)); // control at k2

    const eps = 1e-3;
    const before = squad(k0, c0, c_before, k1, 1 - eps);
    const atK1a = squad(k0, c0, c_before, k1, 1);
    const atK1b = squad(k1, c_before, c2, k2, 0);
    const after = squad(k1, c_before, c2, k2, eps);

    const vBefore = atK1a.angleTo(before) / eps;
    const vAfter = after.angleTo(atK1b) / eps;
    expect(atK1a.angleTo(atK1b)).toBeLessThan(1e-6); // C0
    expect(Math.abs(vBefore - vAfter)).toBeLessThan(0.15); // C1 within tolerance
  });

  it("falls back cleanly when neighbors are identical (no NaN)", () => {
    const a = q(0, 0, 0);
    const s = squadControl(a, a, a);
    const mid = squad(a, s, s, a, 0.5);
    expect(Number.isNaN(mid.x)).toBe(false);
    expect(mid.angleTo(a)).toBeLessThan(1e-6);
  });
});

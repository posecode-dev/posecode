import { describe, expect, it } from "vitest";
import type { ConstraintDiagnostic } from "posecode-render";
import { renderWarnings } from "../src/warnings.js";

function target(): HTMLElement {
  return { innerHTML: "" } as HTMLElement;
}

function diagnostic(
  kind: ConstraintDiagnostic["kind"],
  id: string,
  detail: string,
): ConstraintDiagnostic {
  return { id, kind, detail, pass: false, value: 0.04, limit: 0.02, unit: "m" };
}

describe("playground solver diagnostics", () => {
  it("surfaces grounding/ROM conflicts without duplicating the heel warning", () => {
    const el = target();
    renderWarnings(el, [], [], [], [
      diagnostic("heel-height", "grounding:foot_left:heel-height", "heel is high"),
      diagnostic(
        "grounding-rom-conflict",
        "grounding-rom-conflict:foot_left",
        "foot_left heel is off floor while ankle is at its ROM limit",
      ),
    ]);

    expect(el.innerHTML).toContain("grounding vs ROM");
    expect(el.innerHTML).toContain("ankle is at its ROM limit");
    expect(el.innerHTML).not.toContain("heel is high");
  });

  it("surfaces residual self-collision and escapes diagnostic text", () => {
    const el = target();
    renderWarnings(el, [], [], [], [
      diagnostic(
        "self-collision",
        "self-collision:arm_left:body",
        "arm_left < body overlap",
      ),
    ]);

    expect(el.innerHTML).toContain("residual collision");
    expect(el.innerHTML).toContain("arm_left &lt; body overlap");
  });

  it("omits passing constraint outcomes", () => {
    const el = target();
    renderWarnings(el, [], [], [], [{
      ...diagnostic("sole-angle", "grounding:foot_left:sole-angle", "flat"),
      pass: true,
      value: 0,
    }]);
    expect(el.innerHTML).toBe("");
  });
});

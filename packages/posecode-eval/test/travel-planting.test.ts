import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { probeMovement } from "../src/index.js";

const examplesDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../spec/examples",
);

function load(name: string): string {
  return readFileSync(resolve(examplesDir, `${name}.posecode`), "utf8");
}

/**
 * A traveling movement declares where the BODY goes via `travel:`. A floor
 * foot-pin means the stance foot stays planted while the body travels over it,
 * so the solved root must actually reach each authored travel waypoint (the
 * floor-guide circles). Previously the pin translated the whole body back onto
 * the planted foot, cancelling the travel — the figure marched in place while
 * the circles moved away from it.
 */
describe("travel + floor foot-pin", () => {
  for (const name of ["box-step", "grapevine", "chasse", "waltz-box"]) {
    it(`${name}: the body reaches each authored travel waypoint`, () => {
      const result = probeMovement(load(name));
      expect(result.ok).toBe(true);
      for (const phase of result.phases) {
        const hips = phase.bones.get("pelvis");
        expect(hips, `pelvis bone present for ${phase.name}`).toBeTruthy();
        const [tx, , tz] = phase.rootOffset;
        const dx = hips![0] - tx;
        const dz = hips![2] - tz;
        const error = Math.hypot(dx, dz);
        // Feet are ~0.1m either side of the root; a planted step should keep
        // the body within a comfortable margin of its authored waypoint.
        expect(
          error,
          `${name} "${phase.name}": body at (${hips![0].toFixed(2)}, ${hips![2].toFixed(
            2,
          )}) but authored travel is (${tx.toFixed(2)}, ${tz.toFixed(2)})`,
        ).toBeLessThan(0.15);
      }
    });
  }
});

import { describe, expect, it } from "vitest";
import {
  FEATURED_LIBRARY_MOVEMENT_ID,
  prioritizeFeaturedMovement,
} from "../src/library-order.js";
import { PRESETS } from "../src/presets.js";

describe("movement library ordering", () => {
  it("promotes Jumping jacks ahead of otherwise stable results", () => {
    const movements = [
      { id: "squat" },
      { id: FEATURED_LIBRARY_MOVEMENT_ID },
      { id: "deadlift" },
    ];

    expect(prioritizeFeaturedMovement(movements).map((movement) => movement.id)).toEqual([
      "jumping-jacks",
      "squat",
      "deadlift",
    ]);
    expect(movements.map((movement) => movement.id)).toEqual([
      "squat",
      "jumping-jacks",
      "deadlift",
    ]);
  });

  it("preserves result order when Jumping jacks does not match the filters", () => {
    const movements = [{ id: "squat" }, { id: "deadlift" }];

    expect(prioritizeFeaturedMovement(movements)).toEqual(movements);
  });

  it("keeps the unreviewed ballet examples experimental", () => {
    // The ballet examples are unreviewed and must not surface as launch-ready
    // until a dancer signs off on turnout, naming (Relevé vs Elevé), and step
    // mechanics (see #91 / #103). Ballroom steps (box step, grapevine, waltz
    // box) are separate and remain ready, so the Dance domain still appears in
    // the launch-ready gallery.
    const byId = new Map(PRESETS.map((preset) => [preset.id, preset]));
    for (const balletId of ["demi-plie", "releve", "tendu", "chasse"]) {
      expect(byId.get(balletId)?.status).toBe("experimental");
    }

    const readyDomains = new Set(
      PRESETS.filter((preset) => preset.status === "ready").map((preset) => preset.domain),
    );
    expect(readyDomains.has("Dance")).toBe(true);
  });
});

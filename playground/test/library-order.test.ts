import { describe, expect, it } from "vitest";
import {
  FEATURED_LIBRARY_MOVEMENT_ID,
  prioritizeFeaturedMovement,
} from "../src/library-order.js";

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
});

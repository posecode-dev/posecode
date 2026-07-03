/**
 * Movement sources for the harness.
 *
 * The fixture generator reads the canonical `spec/examples` — the regression
 * baseline. LLM generators implement the same interface so "ask model X for a
 * deadlift, score what it wrote" plugs straight into `runEval` (they need API
 * keys, so they live with the caller, not here).
 */

import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { MovementSource } from "./report.js";

export interface MovementGenerator {
  /** Produce `.movit` source for the named movements. */
  generate(movements: readonly string[]): Promise<MovementSource[]>;
}

/** Load every `.movit` fixture in a directory (movement id = file stem). */
export function loadFixtures(dir: string): MovementSource[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".movit"))
    .sort()
    .map((f) => ({
      movement: basename(f, ".movit"),
      source: readFileSync(join(dir, f), "utf8"),
    }));
}

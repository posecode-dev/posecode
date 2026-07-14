#!/usr/bin/env node
/**
 * Regenerates the README movement GIFs from the real renderer.
 *
 * Thin wrapper over scripts/lib/gif-capture.mjs (the shared capture core, also
 * used by capture-launch-gifs.mjs). Not wired into `npm run build`: run it
 * manually when the figure or a showcased movement changes, and commit output.
 *
 * Usage:
 *   node scripts/capture-gifs.mjs            # all README gifs
 *   node scripts/capture-gifs.mjs squat      # just one
 */
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { captureGifs } from "./lib/gif-capture.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

/** README media set. `size` matches the committed GIFs' dimensions. */
const TARGETS = [
  { id: "jumping-jacks", size: [480, 534], fps: 14 },
  { id: "squat", size: [420, 582], fps: 14 },
  { id: "deadlift", size: [420, 582], fps: 14 },
  { id: "lateral", out: "lateral-raise", size: [420, 582], fps: 14 },
];

const only = process.argv[2];
const targets = TARGETS.filter((t) => !only || t.id === only || t.out === only);
if (targets.length === 0) {
  console.error(`no such target: ${only}`);
  process.exit(1);
}

await captureGifs(targets, { repoRoot, outDir: "docs/media" });

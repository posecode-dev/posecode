#!/usr/bin/env node
/**
 * Launch-asset GIFs (Phase 2 "ammunition"), separate from the README set.
 *
 * These are the shareable atoms for the launch: tight looping clips, ~420px
 * wide, sized per movement so floor poses (dead bug) get a landscape frame and
 * standing poses stay portrait. Output lands in docs/launch-media/ so it's
 * committed and reusable anytime.
 *
 * Usage:
 *   node scripts/capture-launch-gifs.mjs             # all launch gifs
 *   node scripts/capture-launch-gifs.mjs wall-sit    # just one
 */
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { captureGifs } from "./lib/gif-capture.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

/** Per-movement framing: standing poses portrait, floor poses landscape. */
const TARGETS = [
  { id: "wall-sit", size: [420, 560], fps: 14 },
  { id: "jumping-jacks", size: [480, 534], fps: 14 },
  { id: "jab-cross", size: [480, 540], fps: 14 },
  { id: "dead-bug", size: [560, 420], fps: 14, anchorY: 0.68 },
];

const only = process.argv[2];
const targets = TARGETS.filter((t) => !only || t.id === only || t.out === only);
if (targets.length === 0) {
  console.error(`no such target: ${only}`);
  process.exit(1);
}

await captureGifs(targets, { repoRoot, outDir: "docs/launch-media" });

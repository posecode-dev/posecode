/**
 * The Movit authoring guide, served to agents so they can write `.movit`
 * without a human first pasting in a system prompt. Reads the canonical
 * `spec/llm-authoring.md` from the repo; falls back to a compact inline grammar
 * if that file isn't reachable (e.g. the package running standalone).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

let cached: string | null = null;

export function authoringGuide(): string {
  if (cached !== null) return cached;
  let guide: string;
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // src/ (or dist/) → packages/movit-mcp → packages → repo root → spec/
    const path = resolve(here, "../../../spec/llm-authoring.md");
    guide = readFileSync(path, "utf8");
  } catch {
    guide = FALLBACK_GUIDE;
  }
  cached = guide;
  return guide;
}

const FALLBACK_GUIDE = `# Authoring Movit

Output ONLY a \`.movit\` document in a code block — no prose.

## Grammar
\`\`\`
movit <kind> "<Name>"          # kind = exercise | stretch | posture
  rig humanoid
  pose start = <pose>          # neutral | standing | plank
  step "<Phase>" <Ns> <easing>:  # easing = linear | ease-in | ease-out | ease-in-out
    <joint>: <action> <degrees>
    ground-lock: <effectors>   # hands and/or feet pinned to the floor
    cue "<short coaching cue>"
  repeat <count>
\`\`\`

Joints: neck head spine chest pelvis, and (singular or plural) shoulders elbows
wrists hips knees ankles. Actions (degrees are absolute targets): flex/extend,
abduct/adduct, rotate-in/rotate-out, dorsiflex/plantarflex, hold neutral.
Stay within healthy range of motion; the renderer hard-clamps anything beyond.`;

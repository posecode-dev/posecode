/**
 * The Posecode authoring guide, served to agents so they can write `.posecode`
 * without a human first pasting in a system prompt. Reads the guide copied into
 * the npm package, or the canonical `spec/llm-authoring.md` during repository
 * development; falls back to a compact inline grammar if neither is reachable.
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

let cached: string | null = null;

export function authoringGuide(): string {
  if (cached !== null) return cached;
  let guide: string;
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const packagedGuide = resolve(here, "llm-authoring.md");
    const repositoryGuide = resolve(here, "../../../spec/llm-authoring.md");
    guide = readFileSync(
      existsSync(packagedGuide) ? packagedGuide : repositoryGuide,
      "utf8",
    );
  } catch {
    guide = FALLBACK_GUIDE;
  }
  cached = guide;
  return guide;
}

const FALLBACK_GUIDE = `# Authoring Posecode

Output ONLY a \`.posecode\` document in a code block, no prose.

## Grammar
\`\`\`
posecode <kind> "<Name>"          # kind = exercise | stretch | posture
  rig humanoid
  pose start = <pose>          # neutral | standing | plank
  step "<Phase>" <Ns> <mode>:  # mode = flow | settle | drive | snap | linear
    <joint>: <action> <degrees>
    ground-lock: <contacts>    # feet/hands/forearms/back, or foot_left / left foot
    cue "<short coaching cue>"
  repeat <count>
\`\`\`

Joints: neck head spine chest pelvis, and (singular or plural) shoulders elbows
wrists hips knees ankles. Actions (degrees are absolute targets): flex/extend,
abduct/adduct, rotate-in/rotate-out, dorsiflex/plantarflex, hold neutral, and
hinge (hips only, closed-chain hip flexion: torso tips over planted feet with
a neutral spine; use for deadlift / forward fold instead of hips: flex).
Stay within healthy range of motion; the renderer hard-clamps anything beyond.
Use ground-lock: feet when standing, hands and feet in a high plank, forearms
and feet in a forearm plank, and back for supine floor work such as a dead bug.
Do not invent other contact names.`;

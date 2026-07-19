/**
 * The Posecode authoring guide, served to agents so they can write `.posecode`
 * without a human first pasting in a system prompt. Reads the guide copied into
 * the npm package, or the canonical `spec/llm-authoring.md` during repository
 * development; falls back to a compact inline grammar if neither is reachable.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

let cached: string | null = null;

export function authoringGuide(): string {
  if (cached !== null) return cached;
  const here = dirname(fileURLToPath(import.meta.url));
  // Published builds ship a generated copy beside the bundle. Repository
  // development reads the canonical spec directly. Trying both fixes the old
  // package behavior where every installed MCP server silently fell back to a
  // stale, much smaller grammar because `../../../spec` was not published.
  const candidates = [
    resolve(here, "llm-authoring.md"),
    resolve(here, "../../../spec/llm-authoring.md"),
  ];
  let guide = "";
  for (const path of candidates) {
    try {
      guide = readFileSync(path, "utf8");
      break;
    } catch {
      // Try the next distribution layout.
    }
  }
  if (!guide) guide = FALLBACK_GUIDE;
  cached = guide;
  return guide;
}

const FALLBACK_GUIDE = `# Authoring Posecode

When the request is representable, output ONLY the raw \`.posecode\` document,
with no Markdown fence or prose. If it needs free flight, multiple people,
arbitrary equipment, exact sign language, or detailed facial/scapular motion,
say that Posecode cannot yet represent the missing capability.

## Grammar
\`\`\`
posecode <kind> "<Name>"          # kind = exercise | stretch | posture
  rig humanoid
  prop <type>                  # optional: chair | wall | bar | box | dip-bars
  pose start = <pose>          # neutral | standing | first-position | plank | supine | prone | seated
  # Or use \`pose start = <pose>:\` with indented, sparse joint overrides.
  step "<Phase>" <Ns> <mode>:  # mode = flow | settle | drive | snap | linear
    <joint>: <action> <degrees>
    ground-lock: <contacts>    # repeat feet/hands/forearms/back or side-specific supports
    reach: <effector> <target> # supported hand/fist/elbow/knee/foot toward a validated target
    pin: <effector> <anchor>   # move the body around one primary contact
    grip: hands <anchor>       # declared bar / rails, two independent hand contacts
    cue "<short coaching cue>"
  repeat <count>
\`\`\`

Joints: neck head spine chest pelvis, and (singular or plural) shoulders elbows
forearms wrists hips knees ankles. \`forearms\` aliases the elbow bones for palm
roll. Actions (degrees are absolute targets): flex/extend,
abduct/adduct, rotate-in/rotate-out (shoulder/hip), twist-left/twist-right
(axial joints), supinate/pronate (forearm roll), dorsiflex/plantarflex, hold
neutral, and hinge (pelvis only). With upright arms at the sides,
\`forearms: pronate 80\` faces the palms inward toward the thighs.
At zero degrees, \`pronate 0\` and \`supinate 0\` are the same absolute target.
To customize the opening shape, append \`:\` to \`pose start = <pose>\` and
indent joint targets beneath it. These ROM-clamped targets sparsely overlay the
built-in pose, consume no time, and become the deterministic loop-reset pose.
Use only joint/action pairs and declared prop anchors accepted by the validator.
Author the gross pose before reach; a parsed reach is not proof of contact.
Keep cues, sides, and declared contacts consistent through every phase. Floor
contacts are a closed vocabulary: use feet when standing, hands and feet in a
high plank, forearms and feet in a forearm plank, and back for supine work.`;

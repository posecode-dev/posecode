/**
 * Showcase mocap-clip map: clip name (as written in a doc's `clip "<name>"`
 * directive) → retargeted animation asset URL. Shared by the playground viewer
 * and the landing hero so both play the same Mixamo-sourced motion for the
 * marketing surfaces, while the procedural DSL stays the source of truth for
 * every un-clipped movement.
 *
 * The FBX binaries live in `public/clips/`. The `jumping-jacks` showcase clip is
 * committed so Vercel serves it directly (production has no /clips CDN rewrite);
 * the other, unused clips stay gitignored. A movement plays its clip only when it
 * declares `clip "<name>"` AND the skinned character is active; anything missing
 * (e.g. an un-committed clip that 404s in prod) falls back to procedural.
 */
export const SHOWCASE_CLIPS: Record<string, string> = {
  walk: "/clips/walk.fbx",
  squat: "/clips/back-squat.fbx",
  "bicycle-crunch": "/clips/bicycle-crunch.fbx",
  "jab-cross": "/clips/jab-cross.fbx",
  "jumping-jacks": "/clips/jumping-jacks.fbx",
  shuffling: "/clips/shuffling.fbx",
};

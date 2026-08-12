/**
 * Turn a `<posecode-player>`'s attributes into a validated options object.
 *
 * Pure and DOM-free so it is unit-testable in node: the element hands us a
 * plain record of its attribute values. Boolean attributes follow a friendly
 * variant of HTML semantics: present means true, but an explicit `"false"`
 * (or `"0"` / `"no"`) turns them off, which reads better in hand-written embeds.
 */

export interface PlayerOptions {
  /** Start playing as soon as the movement loads. */
  autoplay: boolean;
  /** Loop the timeline. */
  loop: boolean;
  /** Show the playback control bar. */
  controls: boolean;
  /** Slowly orbit the camera when idle. */
  autoRotate: boolean;
  /** Playback speed multiplier (0.1–4). */
  speed: number;
  /**
   * Realistic skinned figure pinned to one GLB URL, from an explicit
   * `character="<url>"` attribute. `""` when the attribute is absent (rig
   * picks the character from `characterUrls` instead) or the character is
   * disabled. Load failures fall back to the procedural figure, so an offline
   * page degrades instead of blanking.
   */
  characterUrl: string;
  /** True when `character="off"` (or another falsey word) explicitly disables any skinned character. */
  characterDisabled: boolean;
  /**
   * Rig name (the loaded document's `rig` directive) → character GLB URL,
   * applied when `characterUrl` is unset and the character isn't disabled.
   * Defaults to the hosted characters for every built-in rig name.
   */
  characterUrls: Record<string, string>;
}

/** The character the hosted playground uses, served from the same origin. */
export const DEFAULT_CHARACTER_URL = "https://posecode.org/models/xbot.glb";

/** Hosted character per built-in rig name, keyed by posecode-parser's RigName. */
export const DEFAULT_CHARACTER_URLS: Record<string, string> = {
  humanoid: DEFAULT_CHARACTER_URL,
  avatar1: "https://posecode.org/models/avatar1.glb",
  avatar2: "https://posecode.org/models/avatar2.glb",
  avatar3: "https://posecode.org/models/avatar3.glb",
};

export const DEFAULT_OPTIONS: PlayerOptions = {
  autoplay: true,
  loop: true,
  controls: true,
  autoRotate: true,
  speed: 1,
  characterUrl: "",
  characterDisabled: false,
  characterUrls: DEFAULT_CHARACTER_URLS,
};

const SPEED_MIN = 0.1;
const SPEED_MAX = 4;

/** Attribute values as read from the element (null = attribute absent). */
export interface RawAttributes {
  autoplay?: string | null;
  loop?: string | null;
  controls?: string | null;
  autorotate?: string | null;
  speed?: string | null;
  character?: string | null;
}

const FALSEY = new Set(["false", "0", "no", "off"]);

/** Present attribute is true unless its value is an explicit falsey word. */
function boolAttr(value: string | null | undefined, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback;
  return !FALSEY.has(value.trim().toLowerCase());
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function parseOptions(attrs: RawAttributes): PlayerOptions {
  const speedRaw = attrs.speed != null ? Number(attrs.speed) : NaN;
  // `character` accepts a GLB URL (pinned regardless of the document's rig),
  // a falsey word to disable any skinned character, or absent to let each
  // loaded document's `rig` directive pick from characterUrls.
  const characterRaw = attrs.character?.trim();
  const characterDisabled =
    characterRaw !== undefined && characterRaw !== null && FALSEY.has(characterRaw.toLowerCase());
  const characterUrl = characterRaw && !characterDisabled ? characterRaw : "";
  return {
    autoplay: boolAttr(attrs.autoplay, DEFAULT_OPTIONS.autoplay),
    loop: boolAttr(attrs.loop, DEFAULT_OPTIONS.loop),
    controls: boolAttr(attrs.controls, DEFAULT_OPTIONS.controls),
    autoRotate: boolAttr(attrs.autorotate, DEFAULT_OPTIONS.autoRotate),
    speed: Number.isFinite(speedRaw)
      ? clamp(speedRaw, SPEED_MIN, SPEED_MAX)
      : DEFAULT_OPTIONS.speed,
    characterUrl,
    characterDisabled,
    characterUrls: DEFAULT_OPTIONS.characterUrls,
  };
}

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
   * Realistic skinned figure: a GLB URL, the default hosted character when
   * absent, or `""` (attribute `character="off"`) for the procedural figure.
   * Load failures fall back to the procedural figure, so an offline page
   * degrades instead of blanking.
   */
  characterUrl: string;
}

/** The character the hosted playground uses, served from the same origin. */
export const DEFAULT_CHARACTER_URL = "https://posecode.org/models/xbot.glb";

export const DEFAULT_OPTIONS: PlayerOptions = {
  autoplay: true,
  loop: true,
  controls: true,
  autoRotate: true,
  speed: 1,
  characterUrl: DEFAULT_CHARACTER_URL,
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
  // `character` accepts a GLB URL, a falsey word to opt out, or absent for
  // the hosted default.
  const characterRaw = attrs.character?.trim();
  const characterUrl =
    characterRaw === undefined || characterRaw === null
      ? DEFAULT_OPTIONS.characterUrl
      : FALSEY.has(characterRaw.toLowerCase())
        ? ""
        : characterRaw;
  return {
    autoplay: boolAttr(attrs.autoplay, DEFAULT_OPTIONS.autoplay),
    loop: boolAttr(attrs.loop, DEFAULT_OPTIONS.loop),
    controls: boolAttr(attrs.controls, DEFAULT_OPTIONS.controls),
    autoRotate: boolAttr(attrs.autorotate, DEFAULT_OPTIONS.autoRotate),
    speed: Number.isFinite(speedRaw)
      ? clamp(speedRaw, SPEED_MIN, SPEED_MAX)
      : DEFAULT_OPTIONS.speed,
    characterUrl,
  };
}

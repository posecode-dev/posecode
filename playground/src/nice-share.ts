/**
 * A readable share link for the 70+ built-in movements: `#doc=squat` instead
 * of a base64 blob of the whole document. posecode-share stays preset-agnostic
 * (it's also used by posecode-embed and posecode-mcp, which know nothing about
 * this app's catalogue), so the preset shortcut lives here instead, one layer
 * up. Anything edited or custom still falls back to the full encoded token.
 */

import { buildShareHash, readShareHash, SHARE_PARAM } from "posecode-share";
import { PRESETS } from "./presets.js";

const presetsById = new Map(PRESETS.map((p) => [p.id, p]));

/** Build the URL hash for a document, preferring a preset's short id. */
export function buildNiceShareHash(source: string): string {
  const preset = PRESETS.find((p) => p.source === source);
  return preset ? `#${SHARE_PARAM}=${preset.id}` : buildShareHash(source);
}

/** Reverse of buildNiceShareHash. Never throws — an invalid link is just "no shared doc". */
export function resolveSharedSource(hash: string): string | null {
  if (typeof hash !== "string") return null;
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const prefix = `${SHARE_PARAM}=`;
  if (raw.startsWith(prefix)) {
    const preset = presetsById.get(raw.slice(prefix.length));
    if (preset) return preset.source;
  }
  return readShareHash(hash);
}

/**
 * Readable routes for the 70+ built-in movements: `/play/squat` instead of a
 * base64 blob of the whole document. posecode-share stays preset-agnostic
 * (it's also used by posecode-embed and posecode-mcp, which know nothing about
 * this app's catalogue), so the preset shortcut lives here instead, one layer
 * up. Anything edited or custom still falls back to the full encoded token.
 */

import { buildShareHash, readShareHash, SHARE_PARAM } from "posecode-share";
import { PRESETS } from "./presets.js";

const presetsById = new Map(PRESETS.map((p) => [p.id, p]));

/** Return the built-in movement encoded by a friendly `/play/:id` path. */
export function resolveSharedPath(pathname: string): string | null {
  const match = pathname.match(/^\/play\/([^/]+)\/?$/);
  if (!match) return null;
  try {
    return presetsById.get(decodeURIComponent(match[1]!))?.source ?? null;
  } catch {
    return null;
  }
}

/** Canonical playground path for a document (custom documents live at `/play`). */
export function buildNicePlayPath(source: string): string {
  const preset = PRESETS.find((p) => p.source === source);
  return preset ? `/play/${encodeURIComponent(preset.id)}` : "/play";
}

/** Build the URL hash for a document, preferring a preset's short id. */
export function buildNiceShareHash(source: string): string {
  const preset = PRESETS.find((p) => p.source === source);
  return preset ? `#${SHARE_PARAM}=${preset.id}` : buildShareHash(source);
}

/** Reverse of buildNiceShareHash. Never throws: an invalid link is just "no shared doc". */
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

/**
 * Resolve a `<posecode-player>`'s movement source from its three input modes,
 * in precedence order:
 *
 *   1. `doc="<token>"`   — a posecode-share token (how permalinks travel)
 *   2. `src="<url>"`     — fetch a `.posecode` file
 *   3. inline text       — the element's own text content
 *
 * DOM-free: the element passes a plain descriptor, so this is unit-testable in
 * node. Never throws — every failure comes back as `{ ok: false, error }` so
 * the element can render a friendly message instead of a blank canvas.
 */

import { decodePosecode, MAX_SOURCE_LENGTH } from "posecode-share";

export interface SourceInput {
  doc?: string | null;
  src?: string | null;
  /** The element's inline text content. */
  text?: string | null;
}

export type Resolved =
  | { ok: true; source: string }
  | { ok: false; error: string };

export async function resolveSource(
  input: SourceInput,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<Resolved> {
  const doc = input.doc?.trim();
  if (doc) {
    try {
      return { ok: true, source: decodePosecode(doc) };
    } catch {
      return { ok: false, error: "Could not decode the movement token." };
    }
  }

  const src = input.src?.trim();
  if (src) {
    if (!fetchImpl) {
      return { ok: false, error: "No fetch available to load the src URL." };
    }
    try {
      const res = await fetchImpl(src);
      if (!res.ok) {
        return { ok: false, error: `Could not load ${src} (HTTP ${res.status}).` };
      }
      const source = await res.text();
      return validateLength(source);
    } catch {
      return { ok: false, error: `Could not fetch ${src}.` };
    }
  }

  const inline = input.text?.trim();
  if (inline) return validateLength(inline);

  return {
    ok: false,
    error: "No movement to render — set a doc token, a src URL, or inline text.",
  };
}

function validateLength(source: string): Resolved {
  if (source.length > MAX_SOURCE_LENGTH) {
    return { ok: false, error: "Movement source is too large to render." };
  }
  return { ok: true, source };
}

/**
 * posecode-embed — public API.
 *
 * Importing this module in a browser auto-registers `<posecode-player>`, so the
 * common case is zero-config:
 *
 *   import "posecode-embed";
 *   // <posecode-player doc="…"></posecode-player> now works
 *
 * For frameworks that want to control timing, call `definePosecodePlayer()`
 * yourself (it is idempotent).
 */

import { PosecodePlayerElement } from "./element.js";

export { PosecodePlayerElement } from "./element.js";
export { parseOptions, DEFAULT_OPTIONS } from "./options.js";
export type { PlayerOptions } from "./options.js";
export { resolveSource } from "./source.js";
export type { SourceInput, Resolved } from "./source.js";

export const version = "0.1.0";

/**
 * Register the `<posecode-player>` custom element. Safe to call more than once
 * and safe to call in a non-browser environment (it no-ops).
 */
export function definePosecodePlayer(): void {
  if (typeof customElements === "undefined") return;
  if (customElements.get(PosecodePlayerElement.tagName)) return;
  customElements.define(PosecodePlayerElement.tagName, PosecodePlayerElement);
}

// Auto-register on import in a browser — the batteries-included default.
definePosecodePlayer();

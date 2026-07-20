/** Public compatibility metadata and no-render validation for CDN consumers. */

import { parse, POSECODE_VERSION } from "posecode-parser";
import type { ParseResult } from "posecode-parser";

/** Version of the posecode-embed package/bundle. */
export const version = "0.4.0";

/** Version of the Posecode language understood by this bundle. */
export const languageVersion = POSECODE_VERSION;

/** Validate source without creating a renderer or WebGL context. */
export function validatePosecode(source: string): ParseResult {
  return parse(source);
}

/**
 * CDN entry: bundled to a single IIFE (`dist/posecode-embed.js`) that exposes a
 * global `Posecode` and auto-registers `<posecode-player>`. Drop it on any page:
 *
 *   <script src="https://.../posecode-embed.js"></script>
 *   <posecode-player doc="…"></posecode-player>
 *
 * Importing ./index already calls definePosecodePlayer(); we simply re-export
 * the API so it hangs off the `Posecode` global for programmatic use.
 */

export * from "./index.js";

/**
 * posecode-mcp — public API.
 *
 * A Model Context Protocol server that lets LLM agents author, validate, and
 * render Posecode movements natively. See `stdio.ts` for the runnable entry
 * point.
 */

export { createPosecodeServer } from "./server.js";
export type { PosecodeServerOptions } from "./server.js";
export {
  analyzePosecode,
  renderPosecode,
  DEFAULT_BASE_URL,
} from "./analyze.js";
export type {
  ValidationSummary,
  RenderResult,
  PhaseSummary,
} from "./analyze.js";
export { authoringGuide } from "./guide.js";

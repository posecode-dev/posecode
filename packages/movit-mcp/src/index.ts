/**
 * movit-mcp — public API.
 *
 * A Model Context Protocol server that lets LLM agents author, validate, and
 * render Movit movements natively. See `stdio.ts` for the runnable entry point.
 */

export { createMovitServer } from "./server.js";
export type { MovitServerOptions } from "./server.js";
export {
  analyzeMovit,
  renderMovit,
  DEFAULT_BASE_URL,
} from "./analyze.js";
export type {
  ValidationSummary,
  RenderResult,
  PhaseSummary,
} from "./analyze.js";
export { authoringGuide } from "./guide.js";

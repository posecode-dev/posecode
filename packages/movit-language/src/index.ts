/**
 * movit-language — editor-agnostic language service for `.movit`.
 *
 * Pure functions over document text + a 0-based position. Consumed by the
 * playground's CodeMirror editor and by the LSP server, so both share one
 * implementation of diagnostics, completions, and hovers.
 */

export { getDiagnostics } from "./diagnostics.js";
export type { Diagnostic, Severity } from "./diagnostics.js";
export { getCompletions } from "./completion.js";
export type { CompletionItem, CompletionKind } from "./completion.js";
export { getHover } from "./hover.js";
export type { HoverInfo } from "./hover.js";
export {
  KINDS,
  POSES,
  EFFECTORS,
  TOP_KEYWORDS,
  CHILD_KEYWORDS,
  KEYWORD_DOCS,
  JOINT_NAMES,
  ACTION_NAMES,
  EASINGS,
} from "./vocab.js";

/**
 * Pure, transport-agnostic core of the Movit MCP server.
 *
 * Turns a `.movit` document into the structured results the MCP tools return:
 * a validation summary (errors + ROM-safety clamps) and a render result that
 * adds a playground permalink. No MCP or I/O here — just parse → shape — so it
 * is trivially unit-testable.
 */

import { parse, type Warning } from "movit-parser";
import { buildShareHash } from "movit-share";

/** Production playground that renders a shared `.movit` link. */
export const DEFAULT_BASE_URL = "https://movit-fawn.vercel.app";

export interface PhaseSummary {
  name: string;
  durationSec: number;
  easing: string;
  cue?: string;
}

export interface ValidationSummary {
  /** True when the document parsed into a renderable movement. */
  ok: boolean;
  kind?: string;
  name?: string;
  startPose?: string;
  totalDurationSec?: number;
  repeat?: number;
  phases?: PhaseSummary[];
  /** Fatal parse/validation errors (empty when ok). */
  errors: { line: number; message: string }[];
  /** Angles that exceeded a healthy range of motion and were clamped. */
  romWarnings: Warning[];
}

export interface RenderResult extends ValidationSummary {
  /** A URL that renders this movement, present only when ok. */
  permalink?: string;
}

/** Parse and ROM-validate a `.movit` document into a structured summary. */
export function analyzeMovit(source: string): ValidationSummary {
  const { ir, warnings, errors } = parse(source);

  if (!ir) {
    return { ok: false, errors, romWarnings: warnings };
  }

  const phases: PhaseSummary[] = ir.phases.map((p) => ({
    name: p.name,
    durationSec: p.durationSec,
    easing: p.easing,
    ...(p.cue ? { cue: p.cue } : {}),
  }));

  return {
    ok: true,
    kind: ir.kind,
    name: ir.name,
    ...(ir.startPose ? { startPose: ir.startPose } : {}),
    totalDurationSec: ir.phases.reduce((sum, p) => sum + p.durationSec, 0),
    repeat: ir.repeat,
    phases,
    errors: [],
    romWarnings: warnings,
  };
}

/**
 * Validate a document and, when valid, attach a playground permalink that
 * renders it. A document too large to encode degrades to a clear error rather
 * than an unusable link.
 */
export function renderMovit(
  source: string,
  baseUrl: string = DEFAULT_BASE_URL,
): RenderResult {
  const summary = analyzeMovit(source);
  if (!summary.ok) return summary;

  try {
    const hash = buildShareHash(source);
    return { ...summary, permalink: `${stripTrailingSlash(baseUrl)}/${hash}` };
  } catch (err) {
    return {
      ...summary,
      ok: false,
      errors: [
        {
          line: 0,
          message:
            err instanceof Error
              ? err.message
              : "could not build a shareable link",
        },
      ],
    };
  }
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

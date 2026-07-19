/**
 * Run the harness over a set of movements and produce a scorecard.
 * Pure data-in/data-out so it can drive a CLI, CI gate, or LLM benchmark.
 */

import { probeMovement } from "./probe.js";
import { genericChecks, MOVEMENT_CHECKS, type CheckOutcome } from "./checks.js";
import type { Character, Proportions } from "posecode-render";
import type { ClipDiagnostics } from "./diagnostics.js";

export interface MovementSource {
  /** Identifier matched against MOVEMENT_CHECKS (e.g. file stem "deadlift"). */
  movement: string;
  source: string;
}

export interface MovementReport {
  movement: string;
  parseOk: boolean;
  clampWarnings: number;
  checks: CheckOutcome[];
  /** Strict clip-wide constraint diagnostics; warnings do not change CI pass counts. */
  diagnostics: ClipDiagnostics;
  passed: number;
  total: number;
}

export interface EvalReport {
  movements: MovementReport[];
  summary: {
    movements: number;
    parseFailures: number;
    clampWarnings: number;
    checksPassed: number;
    checksTotal: number;
    constraintWarnings: number;
  };
}

export interface EvalOptions {
  /** Driver proportions used by the production character being evaluated. */
  proportions?: Proportions;
  /** Optional retargeted visible character sampled after each solved phase. */
  character?: Character;
  /** Sampling rate for clip-wide grounding/collision diagnostics. Defaults to 12Hz. */
  diagnosticSampleRateHz?: number;
}

export function runEval(
  sources: readonly MovementSource[],
  options: EvalOptions = {},
): EvalReport {
  const movements = sources.map((s) => evalMovement(s, options));
  return {
    movements,
    summary: {
      movements: movements.length,
      parseFailures: movements.filter((m) => !m.parseOk).length,
      clampWarnings: movements.reduce((n, m) => n + m.clampWarnings, 0),
      checksPassed: movements.reduce((n, m) => n + m.passed, 0),
      checksTotal: movements.reduce((n, m) => n + m.total, 0),
      constraintWarnings: movements.reduce((n, m) => n + m.diagnostics.warnings.length, 0),
    },
  };
}

function evalMovement(
  { movement, source }: MovementSource,
  options: EvalOptions,
): MovementReport {
  const result = probeMovement(
    source,
    options.proportions,
    options.character,
    { diagnosticSampleRateHz: options.diagnosticSampleRateHz },
  );
  const specific = MOVEMENT_CHECKS.find((m) => m.movement === movement);
  const checks = [
    ...genericChecks(result),
    ...(specific?.checks.map((c) => c(result)) ?? []),
  ];
  return {
    movement,
    parseOk: result.ok,
    clampWarnings: result.warnings.length,
    checks,
    diagnostics: result.diagnostics,
    passed: checks.filter((c) => c.pass).length,
    total: checks.length,
  };
}

/** Render a compact human-readable scorecard. */
export function renderReport(report: EvalReport): string {
  const lines: string[] = [];
  for (const m of report.movements) {
    const mark = m.passed === m.total ? "✓" : "✗";
    lines.push(`${mark} ${m.movement}  ${m.passed}/${m.total}`);
    for (const c of m.checks.filter((c) => !c.pass)) {
      lines.push(`    ✗ ${c.id}: ${c.detail}`);
    }
    for (const warning of m.diagnostics.warnings) {
      lines.push(`    ⚠ ${warning.id}: ${warning.detail}`);
    }
  }
  const s = report.summary;
  lines.push("");
  lines.push(
    `${s.checksPassed}/${s.checksTotal} checks · ${s.movements} movements · ` +
      `${s.parseFailures} parse failures · ${s.clampWarnings} clamp warnings · ` +
      `${s.constraintWarnings} constraint warnings`,
  );
  return lines.join("\n");
}

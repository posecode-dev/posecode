/**
 * Diagnostics: run the parser and map its structured errors + ROM-clamp
 * warnings onto source lines, deduping a joint group's left/right warnings into
 * a single message (e.g. `knees: flex 200` → one "knee" diagnostic, not two).
 */

import { parse, boneType } from "movit-parser";

export type Severity = "error" | "warning";

export interface Diagnostic {
  /** 1-based source line. */
  line: number;
  severity: Severity;
  message: string;
}

export function getDiagnostics(text: string): Diagnostic[] {
  const { errors, warnings } = parse(text);
  const diagnostics: Diagnostic[] = [];

  for (const e of errors) {
    diagnostics.push({ line: e.line, severity: "error", message: e.message });
  }

  const seen = new Set<string>();
  for (const w of warnings) {
    const joint = boneType(w.joint); // collapse knee_left / knee_right → knee
    const key = `${w.line}|${joint}|${w.action}|${w.requested}|${w.clamped}`;
    if (seen.has(key)) continue;
    seen.add(key);
    diagnostics.push({
      line: w.line,
      severity: "warning",
      message: `${joint} ${w.action} ${w.requested}° exceeds range of motion — clamped to ${w.clamped}° (safe ${w.limit.min}–${w.limit.max}°)`,
    });
  }

  return diagnostics;
}

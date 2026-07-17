/**
 * Diagnostics: run the parser and map its structured errors + ROM-clamp
 * warnings onto source lines, deduping a joint group's left/right warnings into
 * a single message (e.g. `knees: flex 200` → one "knee" diagnostic, not two).
 */

import { parse, boneType } from "posecode-parser";
import { LEGACY_MODE_ALIASES } from "./vocab.js";

export type Severity = "error" | "warning" | "hint";

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
      message: `${joint} ${w.action} ${w.requested}° exceeds the configured range, clamped to ${w.clamped}° (${w.limit.min}–${w.limit.max}°)`,
    });
  }

  // Deprecation hints: legacy easing names still parse (via aliases) but nudge
  // authors toward the canonical timing modes. Scanned lexically so the hint
  // survives even when the rest of the document has errors.
  const lines = text.split(/\r?\n/);
  lines.forEach((lineText, idx) => {
    const m = /^\s*step\s+"[^"]*"\s+[0-9.]+s\s+([\w-]+)\s*:/.exec(lineText);
    const tok = m?.[1];
    if (tok && tok !== "linear" && tok in LEGACY_MODE_ALIASES) {
      diagnostics.push({
        line: idx + 1,
        severity: "hint",
        message: `"${tok}" is deprecated; use "${LEGACY_MODE_ALIASES[tok]}"`,
      });
    }

    const axial = /^\s*(spine|chest|neck|head)\s*:\s*(rotate-in|rotate-out)\b/.exec(
      lineText,
    );
    if (axial) {
      const replacement = axial[2] === "rotate-in" ? "twist-left" : "twist-right";
      diagnostics.push({
        line: idx + 1,
        severity: "hint",
        message: `"${axial[2]}" is ambiguous on ${axial[1]}; use "${replacement}"`,
      });
    }
  });

  return diagnostics;
}

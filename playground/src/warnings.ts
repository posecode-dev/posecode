/** Render parse errors and ROM-clamp warnings into the side panel. */
import type { ParseError, Warning } from "posecode-parser";

export function renderWarnings(
  el: HTMLElement,
  errors: ParseError[],
  warnings: Warning[],
): void {
  const rows: string[] = [];

  for (const e of errors) {
    rows.push(`<div class="row err">✗ line ${e.line}: ${escape(e.message)}</div>`);
  }
  for (const w of warnings) {
    rows.push(
      `<div class="row warn">⚠ ${escape(w.phase)} · ${escape(w.joint)} ${escape(
        w.action,
      )} ${w.requested}° → clamped to ${w.clamped}° (ROM ${w.limit.min}–${w.limit.max}°)</div>`,
    );
  }

  el.innerHTML = rows.join("");
}

function escape(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  );
}

/** Render source validation plus live contact-solve diagnostics. */
import type { ParseError, Warning } from "posecode-parser";
import type { ReachResidual } from "posecode-render";

export function renderWarnings(
  el: HTMLElement,
  errors: ParseError[],
  warnings: Warning[],
  contacts: readonly ReachResidual[] = [],
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

  const seenContacts = new Set<string>();
  for (const contact of contacts) {
    // A reach intentionally blends in through a phase. Diagnose only once it
    // is fully active, otherwise every normal transition would flash red.
    if (contact.weight < 0.98 || contact.reached) continue;
    const key = `${contact.effector}|${contact.target}`;
    if (seenContacts.has(key)) continue;
    seenContacts.add(key);
    if (contact.distance === null) {
      rows.push(
        `<div class="row err">✗ contact ${escape(contact.effector)} → ${escape(
          contact.target,
        )} could not be solved${contact.reason ? ` (${escape(contact.reason)})` : ""}</div>`,
      );
    } else {
      rows.push(
        `<div class="row warn">⚠ contact miss · ${escape(contact.effector)} → ${escape(
          contact.target,
        )} remains ${Math.round(contact.distance * 100)} cm away</div>`,
      );
    }
  }

  el.innerHTML = rows.join("");
}

function escape(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  );
}

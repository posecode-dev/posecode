import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const main = readFileSync(resolve(import.meta.dirname, "../src/main.ts"), "utf8");

describe("paused scrub diagnostics", () => {
  it("refreshes warnings after the seeked viewer frame has been solved", () => {
    expect(main).toMatch(
      /function scheduleScrubDiagnosticsRefresh\(\)[\s\S]*?requestAnimationFrame\(\(\) => \{[\s\S]*?refreshContactDiagnostics\(true\)/,
    );
    expect(main).toMatch(
      /scrub\.addEventListener\("input",[\s\S]*?viewer\.seek\([\s\S]*?scheduleScrubDiagnosticsRefresh\(\)/,
    );
  });
});

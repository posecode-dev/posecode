import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  resolve(import.meta.dirname, "../src/style.css"),
  "utf8",
);

function declarations(selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "g"))]
    .map((match) => match[1] ?? "");
}

describe("mobile viewer layout", () => {
  it("keeps phase count from consuming the canvas height", () => {
    const viewerRules = declarations(".viewer-pane").join("\n");
    const ribbonRules = declarations(".ribbon").join("\n");
    const chipRules = declarations(".ribbon .chip").join("\n");

    expect(viewerRules).toMatch(/display:\s*grid/);
    expect(viewerRules).toMatch(/grid-template-rows:\s*minmax\(0,\s*1fr\)\s+auto\s+auto/);
    expect(ribbonRules).toMatch(/flex-wrap:\s*nowrap/);
    expect(ribbonRules).toMatch(/overflow-x:\s*auto/);
    expect(ribbonRules).toMatch(/scrollbar-width:\s*none/);
    expect(ribbonRules).not.toMatch(/flex-wrap:\s*wrap(?:\s|;|$)/);
    expect(chipRules).toMatch(/flex:\s*0\s+0\s+auto/);
  });
});

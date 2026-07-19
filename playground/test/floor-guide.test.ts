import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const html = readFileSync(resolve(import.meta.dirname, "../play.html"), "utf8");
const main = readFileSync(resolve(import.meta.dirname, "../src/main.ts"), "utf8");
const css = readFileSync(resolve(import.meta.dirname, "../src/style.css"), "utf8");

describe("playground floor guide", () => {
  it("explains origin, facing, metric scale, and optional travel without covering the canvas", () => {
    expect(html).toContain('id="floor-guide-key"');
    expect(html).toMatch(/id="floor-guide-key"[\s\S]*?role="img"[\s\S]*?aria-label=/);
    expect(html).toContain('id="floor-guide-travel" hidden');
    expect(html).toContain('id="floor-guide-reset" hidden');
    expect(html).toContain("origin</span>");
    expect(html).toContain("facing</span>");
    expect(html).toContain("1 m</span>");
    expect(css).toMatch(/\.floor-guide-key\s*\{[\s\S]*?pointer-events:\s*none/);
    expect(html.match(/class="floor-key-[^"]+" aria-hidden="true"/g)).toHaveLength(5);
  });

  it("shows the travel key only when the loaded viewer reports authored travel", () => {
    expect(main).toContain("viewer?.getFloorGuideInfo()");
    expect(main).toContain("floorGuideTravel.hidden = !info?.hasTravel");
    expect(main).toContain("floorGuideReset.hidden = !info?.hasLoopReset");
    expect(main).toContain('describedFeatures.push("dashed loop reset")');
    expect(main).toMatch(/viewer\.load\(ir\);\s*updateFloorGuideKey\(\);/);
  });

  it("keeps the key compact at the mobile viewer breakpoint", () => {
    expect(css).toMatch(
      /@media \(max-width: 860px\)[\s\S]*?\.floor-guide-key\s*\{[\s\S]*?max-width:\s*calc\(100% - 24px\)/,
    );
    expect(css).toMatch(
      /@media \(max-width: 860px\)[\s\S]*?\.floor-guide-key\s*\{[\s\S]*?top:\s*96px/,
    );
  });
});

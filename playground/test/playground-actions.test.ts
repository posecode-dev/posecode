import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const playground = readFileSync(resolve(root, "playground/play.html"), "utf8");
const main = readFileSync(resolve(root, "playground/src/main.ts"), "utf8");

describe("playground header actions", () => {
  it("keeps both motion formats behind one Export menu", () => {
    expect(playground).toContain('id="export-menu-button"');
    expect(playground).toContain('aria-haspopup="menu"');
    expect(playground).toContain('id="export-menu"');
    expect(playground).toContain('id="download-bvh"');
    expect(playground).toContain('id="download-gltf"');
    expect(playground.match(/>Download BVH</g)).toBeNull();
    expect(playground.match(/>Download glTF</g)).toBeNull();
  });

  it("links the GitHub action to the repository instead of issue creation", () => {
    expect(playground).toContain('href="https://github.com/posecode-dev/posecode"');
    expect(playground).not.toContain("posecode-dev/posecode/issues/new");
    expect(playground).toContain("Open the Posecode repository on GitHub");
  });

  it("supports dismissal and keyboard navigation for the export menu", () => {
    expect(main).toContain("function setExportMenu(open: boolean)");
    expect(main).toContain('event.key === "ArrowDown"');
    expect(main).toContain('event.key === "ArrowUp"');
    expect(main).toContain('e.key === "Escape"');
  });
});

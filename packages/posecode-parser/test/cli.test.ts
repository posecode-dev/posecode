import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderValidation, validatePaths } from "../src/cli.js";

const SPORTS_MOVE = `posecode exercise "Jump shot"
  rig humanoid
  pose start = standing
  step "Gather" 0.4s settle:
    knees: flex 70
    ground-lock: feet
  step "Explode" 0.3s drive:
    knees: flex 10
    ankles: plantarflex 26
    travel: 0 0.12
    ground-lock: feet
  step "Release" 0.2s snap:
    shoulders: flex 160
    wrists: flex 34
  repeat 1
`;

describe("posecode validator", () => {
  it("recursively validates third-party movement libraries using timing modes", () => {
    const root = mkdtempSync(join(tmpdir(), "posecode-validator-"));
    const nested = join(root, "basketball");
    mkdirSync(nested);
    writeFileSync(join(nested, "jump-shot.posecode"), SPORTS_MOVE);

    const summary = validatePaths([root]);

    expect(summary).toMatchObject({ fileCount: 1, errorCount: 0, warningCount: 0 });
  });

  it("prints file and line diagnostics for invalid timing modes", () => {
    const root = mkdtempSync(join(tmpdir(), "posecode-validator-"));
    const file = join(root, "broken.posecode");
    writeFileSync(file, SPORTS_MOVE.replace("0.3s drive", "0.3s turbo"));

    const summary = validatePaths([file]);
    const output = renderValidation(summary);

    expect(summary.errorCount).toBe(1);
    expect(output).toContain(`${file}:7: error:`);
    expect(output).toContain('unknown timing mode "turbo"');
  });
});

/**
 * Eval CLI: score the canonical spec/examples fixtures.
 * Run from the repo root:  npm run eval
 * Exits non-zero if any check fails, so it can gate CI.
 */

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadFixtures } from "./generator.js";
import { renderReport, runEval } from "./report.js";
import { loadXbotCharacter } from "./xbot.js";

const here = dirname(fileURLToPath(import.meta.url));
const examplesDir = resolve(here, "../../../spec/examples");
const xbotAsset = new URL("../../../playground/public/models/xbot.glb", import.meta.url);

// Both figures ship in production: XBot is the default, while the procedural
// mannequin is the deliberate fallback when the character asset cannot load.
// Limb-length differences materially affect contacts, so neither result may
// stand in for the other at the launch gate.
const fixtures = loadFixtures(examplesDir);
const xbot = await loadXbotCharacter(xbotAsset);
const reports = [
  {
    label: "XBot visible skeleton + skinned floor (production default)",
    report: runEval(fixtures, { proportions: xbot.proportions, character: xbot }),
  },
  {
    label: "Procedural mannequin (production fallback)",
    report: runEval(fixtures),
  },
] as const;

for (const { label, report } of reports) {
  console.log(`=== ${label} ===`);
  console.log(renderReport(report));
  console.log("");
}
xbot.dispose();

const passed = reports.every(({ report }) =>
  report.summary.checksPassed === report.summary.checksTotal,
);
process.exitCode = passed ? 0 : 1;

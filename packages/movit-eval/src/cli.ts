/**
 * Eval CLI: score the canonical spec/examples fixtures.
 * Run from the repo root:  npm run eval
 * Exits non-zero if any check fails, so it can gate CI.
 */

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadFixtures } from "./generator.js";
import { renderReport, runEval } from "./report.js";

const here = dirname(fileURLToPath(import.meta.url));
const examplesDir = resolve(here, "../../../spec/examples");

const report = runEval(loadFixtures(examplesDir));
console.log(renderReport(report));

const { checksPassed, checksTotal } = report.summary;
process.exit(checksPassed === checksTotal ? 0 : 1);

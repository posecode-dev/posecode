import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "./packages/posecode-parser/dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = here;

const originalDeadlift = readFileSync(resolve(repoRoot, "spec/examples/deadlift.posecode"), "utf-8");

const modified = originalDeadlift.replace(
  "knees: flex 25",
  "knees: flex 25\n    ankles: plantarflex 20"
);

console.log("=== Modified posecode ===");
console.log(modified);

const { ir, errors, warnings } = parse(modified);
console.log("=== Parse results ===");
console.log("Errors:", errors);
console.log("Warnings:", warnings);
console.log("Parsed targets for Lower phase:");
console.log(JSON.stringify(ir.phases[0].targets, null, 2));

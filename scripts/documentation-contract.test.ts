import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACTION_NAMES,
  MODES,
  MOVEMENT_KINDS,
  PROP_TYPES,
  RIG_NAMES,
  START_POSE_NAMES,
  parse,
} from "../packages/posecode-parser/src/index.js";

const specification = readFileSync(resolve(import.meta.dirname, "../spec/SPEC.md"), "utf8");
const authoringGuide = readFileSync(
  resolve(import.meta.dirname, "../spec/llm-authoring.md"),
  "utf8",
);

const closedVocabulary = [
  ...MOVEMENT_KINDS,
  ...RIG_NAMES,
  ...START_POSE_NAMES,
  ...PROP_TYPES,
  ...MODES,
  ...ACTION_NAMES,
];

describe("authoring documentation contract", () => {
  it("keeps every Posecode example in the LLM guide parseable and warning-free", () => {
    const fences = [...authoringGuide.matchAll(/^([ \t]*)```posecode[ \t]*\n([\s\S]*?)^\1```[ \t]*$/gm)];
    expect(fences.length).toBeGreaterThan(0);

    for (const [index, fence] of fences.entries()) {
      const indent = fence[1] ?? "";
      const source = (fence[2] ?? "")
        .split("\n")
        .map((line) => line.startsWith(indent) ? line.slice(indent.length) : line)
        .join("\n");
      const documentSource = source.trimStart().startsWith("posecode ")
        ? source
        : [
            'posecode posture "Guide snippet"',
            "  rig humanoid",
            "  pose start = standing",
            "",
            ...source.split("\n").map((line) => `  ${line}`),
            "",
            "  repeat 1",
          ].join("\n");
      const { ir, errors, warnings } = parse(documentSource);
      expect({ example: index + 1, errors }).toEqual({ example: index + 1, errors: [] });
      expect({ example: index + 1, warnings }).toEqual({ example: index + 1, warnings: [] });
      expect(ir).not.toBeNull();
    }
  });

  it.each([
    ["the normative specification", specification],
    ["the pasteable LLM guide", authoringGuide],
  ])("keeps the parser's core closed vocabulary in %s", (_label, document) => {
    for (const token of closedVocabulary) {
      expect(document, `missing parser token: ${token}`).toContain(token);
    }
  });

  it.each([
    ["the normative specification", specification],
    ["the pasteable LLM guide", authoringGuide],
  ])("defines contact behavior and display-only cues in %s", (_label, document) => {
    for (const directive of ["ground-lock", "reach", "pin", "grip"]) {
      expect(document, `missing contact directive: ${directive}`).toContain(`\`${directive}\``);
    }
    expect(document).toMatch(/cue[^\n]*(display-only|display only)/i);
  });

  it.each([
    ["the normative specification", specification],
    ["the pasteable LLM guide", authoringGuide],
  ])("documents scoped, sparse custom start poses in %s", (_label, document) => {
    expect(document).toMatch(/pose start = (?:standing|<pose>):/);
    expect(document).toMatch(/sparse[^\n]*(overlay|joint)/i);
    expect(document).toMatch(/loop-reset|loops/i);
  });
});

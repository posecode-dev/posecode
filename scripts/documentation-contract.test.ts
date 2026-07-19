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

import { describe, it, expect } from "vitest";
import { tokenize } from "../src/tokenizer.js";

describe("tokenize", () => {
  it("drops blank lines and comments, keeps indentation", () => {
    const lines = tokenize(
      [
        'movit exercise "Push-up"',
        "  # a comment",
        "",
        "  rig humanoid   // trailing comment",
      ].join("\n"),
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]!.indent).toBe(0);
    expect(lines[1]!.indent).toBe(2);
    expect(lines[1]!.line).toBe(4);
  });

  it("lexes strings, durations, numbers, words and punctuation", () => {
    const [header, step, joint] = tokenize(
      [
        'movit exercise "Push-up"',
        '  step "Lower" 2s ease-in:',
        "    elbows: flex 90",
      ].join("\n"),
    );

    expect(header!.tokens).toEqual([
      { type: "word", value: "movit" },
      { type: "word", value: "exercise" },
      { type: "str", value: "Push-up" },
    ]);

    expect(step!.tokens.map((t) => t.type)).toEqual([
      "word",
      "str",
      "dur",
      "word",
      "colon",
    ]);
    expect(step!.tokens[2]).toEqual({ type: "dur", value: "2s" });

    expect(joint!.tokens).toEqual([
      { type: "word", value: "elbows" },
      { type: "colon", value: ":" },
      { type: "word", value: "flex" },
      { type: "num", value: "90" },
    ]);
  });

  it("lexes negative and decimal numbers", () => {
    const [line] = tokenize("  knee: extend -5.5");
    expect(line!.tokens[3]).toEqual({ type: "num", value: "-5.5" });
  });

  it("lexes comma-separated effector lists", () => {
    const [line] = tokenize("    ground-lock: hands, feet");
    expect(line!.tokens.map((t) => t.value)).toEqual([
      "ground-lock",
      ":",
      "hands",
      ",",
      "feet",
    ]);
  });
});

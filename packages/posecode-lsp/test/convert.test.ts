import { describe, it, expect } from "vitest";
import {
  DiagnosticSeverity,
  CompletionItemKind,
  MarkupKind,
} from "vscode-languageserver";
import { toDiagnostics, toCompletions, toHover } from "../src/convert.js";

const DOC = [
  'posecode exercise "Test"',
  "  rig humanoid",
  "  pose start = standing",
  '  step "Lower" 2s ease-in:',
  "    knees: flex 200", // over ROM
  "  repeat 1",
].join("\n");

describe("toDiagnostics", () => {
  it("maps a ROM clamp to a warning on the right 0-based line", () => {
    const warn = toDiagnostics(DOC).find(
      (d) => d.severity === DiagnosticSeverity.Warning,
    );
    expect(warn?.range.start.line).toBe(4); // 0-based line of `knees: flex 200`
    expect(warn?.message).toContain("144");
    expect(warn?.source).toBe("posecode");
  });

  it("maps a parse error to an Error diagnostic", () => {
    const d = toDiagnostics('posecode exercise "X"\n  not valid here');
    expect(d.some((x) => x.severity === DiagnosticSeverity.Error)).toBe(true);
  });
});

describe("toCompletions", () => {
  it("returns actions (as Function items) after `<joint>: `", () => {
    const text = 'posecode exercise "x"\n    knees: ';
    const items = toCompletions(text, 1, 11);
    expect(items.map((i) => i.label)).toEqual(
      expect.arrayContaining(["flex", "extend"]),
    );
    expect(items[0]?.kind).toBe(CompletionItemKind.Function);
  });
});

describe("toHover", () => {
  it("returns markdown ROM info over an action", () => {
    const line = "    knees: flex 200";
    const h = toHover(line, 0, line.indexOf("flex") + 1);
    expect(h?.contents).toMatchObject({ kind: MarkupKind.Markdown });
    expect((h?.contents as { value: string }).value).toContain("144");
  });

  it("returns null over whitespace", () => {
    expect(toHover("    ", 0, 2)).toBeNull();
  });
});

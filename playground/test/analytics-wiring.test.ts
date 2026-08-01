import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const main = readFileSync(resolve(root, "playground/src/main.ts"), "utf8");
const editor = readFileSync(resolve(root, "playground/src/editor.ts"), "utf8");
const landing = readFileSync(resolve(root, "playground/src/landing.ts"), "utf8");
const products = readFileSync(
  resolve(root, "playground/src/for-products.ts"),
  "utf8",
);

describe("product analytics UI wiring", () => {
  it("distinguishes user editor transactions from programmatic document loads", () => {
    expect(editor).toContain("Transaction.userEvent");
    expect(main).toContain("if (userInitiated)");
    expect(main).toContain("usageSession.trackFirstEdit");
  });

  it("tracks render only after a successful viewer load", () => {
    const load = main.indexOf("viewer.load(ir)");
    const tracked = main.indexOf("usageSession.trackSuccessfulRender", load);
    expect(load).toBeGreaterThan(-1);
    expect(tracked).toBeGreaterThan(load);
  });

  it("tracks a movement attempt only after a valid custom editor render", () => {
    const load = main.indexOf("viewer.load(ir)");
    const valid = main.indexOf('errors.length === 0', load);
    const editorChange = main.indexOf(
      'pendingRenderTrigger === "editor_change"',
      valid,
    );
    const custom = main.indexOf('documentKind() === "custom"', editorChange);
    const tracked = main.indexOf(
      "usageSession.trackFirstValidCustomMovement()",
      custom,
    );

    expect(load).toBeGreaterThan(-1);
    expect(valid).toBeGreaterThan(load);
    expect(editorChange).toBeGreaterThan(valid);
    expect(custom).toBeGreaterThan(editorChange);
    expect(tracked).toBeGreaterThan(custom);
  });

  it("tracks prompt copy only after clipboard success on both entry points", () => {
    const playgroundCopy = main.indexOf(
      "await navigator.clipboard.writeText(llmPrompt)",
    );
    const playgroundTracked = main.indexOf(
      'usageSession.trackPromptCopied("playground")',
      playgroundCopy,
    );
    const landingCopy = landing.indexOf("await writeClipboard(llmPrompt)");
    const landingTracked = landing.indexOf(
      'usageSession.trackPromptCopied("landing")',
      landingCopy,
    );

    expect(playgroundCopy).toBeGreaterThan(-1);
    expect(playgroundTracked).toBeGreaterThan(playgroundCopy);
    expect(landingCopy).toBeGreaterThan(-1);
    expect(landingTracked).toBeGreaterThan(landingCopy);
  });

  it("tracks share only after the link reaches the clipboard", () => {
    const copied = main.indexOf("await navigator.clipboard.writeText(url)");
    const tracked = main.indexOf("usageSession.trackSuccessfulShare", copied);
    expect(copied).toBeGreaterThan(-1);
    expect(tracked).toBeGreaterThan(copied);
  });

  it("tracks install copy only in the clipboard success branch", () => {
    const copied = products.indexOf("await navigator.clipboard.writeText(command)");
    const tracked = products.indexOf(
      "USAGE_EVENT_NAMES.installCommandCopied",
      copied,
    );
    expect(copied).toBeGreaterThan(-1);
    expect(tracked).toBeGreaterThan(copied);
  });
});

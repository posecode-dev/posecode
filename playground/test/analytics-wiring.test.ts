import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const main = readFileSync(resolve(root, "playground/src/main.ts"), "utf8");
const editor = readFileSync(resolve(root, "playground/src/editor.ts"), "utf8");
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

  it("tracks share only after the link reaches the clipboard", () => {
    const copied = main.indexOf("await navigator.clipboard.writeText(url)");
    const tracked = main.indexOf("USAGE_EVENT_NAMES.shareCreated", copied);
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

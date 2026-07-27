import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const home = readFileSync(resolve(root, "playground/index.html"), "utf8");
const productPage = readFileSync(resolve(root, "playground/for-products.html"), "utf8");
const playground = readFileSync(resolve(root, "playground/play.html"), "utf8");
const landingCss = readFileSync(resolve(root, "playground/src/landing.css"), "utf8");
const contentCss = readFileSync(resolve(root, "playground/public/content-theme.css"), "utf8");
const readme = readFileSync(resolve(root, "README.md"), "utf8");

describe("format-first product positioning", () => {
  it("leads with an inspectable movement format instead of an AI generator", () => {
    expect(home).toContain("A readable format for human movement");
    expect(home).toContain("Movement you can <span class=\"hl\">inspect.</span>");
    expect(home).toContain("animation tools, agents, and web");
    expect(home).not.toContain("Give your LLM<br");
  });

  it("makes AI an optional authoring path", () => {
    expect(home).toContain("Write Posecode directly or start with an agent draft.");
    expect(home).toContain("Copy agent authoring guide");
    expect(playground).toContain("Copy agent guide");
    expect(playground).toContain("Use an agent if you want a draft.");
  });

  it("shows real source beside its deterministic output", () => {
    expect(home).toContain("Readable source");
    expect(home).toContain("Live render");
    expect(home).toContain("source text");
    expect(home).toContain("typed IR");
    expect(home).toContain("validated motion");
    expect(home).toContain("Same document, same validated motion.");
  });

  it("explains the integration layers", () => {
    expect(home).toContain("Parser + typed IR");
    expect(home).toContain("Three.js runtime");
    expect(home).toContain("Embed + agent tools");
  });

  it("uses the same core visual tokens across marketing, tool, and content pages", () => {
    for (const css of [landingCss, contentCss]) {
      const compact = css.replace(/\s/g, "");
      expect(compact).toContain("--bg:#0b0c0d");
      expect(compact).toContain("--accent:#d4ff3f");
    }
  });

  it("keeps the product page and repository introduction aligned", () => {
    expect(productPage).toContain("Build with inspectable movement.");
    expect(readme).toContain("An inspectable, editable movement format for animation tools, agents, and web products.");
    expect(readme).toContain("Posecode keeps those decisions in readable source.");
  });
});

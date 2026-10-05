import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const html = readFileSync(resolve(import.meta.dirname, "../play.html"), "utf8");

describe("playground authoring help", () => {
  it("links directly to the normative language specification", () => {
    expect(html).toMatch(/id="spec-link"[\s\S]*?href="\/spec\.html"/);
    expect(html).toContain("The <a href=\"/spec.html\">language specification</a> is the normative");
  });

  it("labels cues as display-only coaching text", () => {
    expect(html).toContain('aria-label="Display-only coaching cue"');
    expect(html).toContain("A <code>cue</code> is display-only coaching text");
  });

  it("links capabilities and limitations near the prompt action", () => {
    expect(html).toContain('href="/llm-guide.html#what-posecode-is-not"');
    expect(html).toContain("Capabilities &amp; limits →");
  });

  it("explains that pin moves the body and reach moves the limb", () => {
    expect(html).toContain("<code>pin</code> moves the body");
    expect(html).toContain("<code>reach</code> moves\n            a limb");
  });
});

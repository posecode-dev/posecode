import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { esc } from "./lib/shell.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("generated content pages", () => {
  it("publishes the canonical product page in the sitemap", () => {
    const sitemap = readFileSync(
      resolve(root, "playground/public/sitemap.xml"),
      "utf8",
    );

    expect(sitemap).toContain(
      "<loc>https://www.posecode.org/for-products</loc>",
    );
    expect(sitemap).not.toContain("<loc>https://posecode.org/");
  });

  it("uses the current embed release in product integration docs", () => {
    const page = readFileSync(
      resolve(root, "playground/for-products.html"),
      "utf8",
    );

    expect(page).toContain("posecode-embed@0.5.0");
    expect(page).not.toContain("posecode-embed@0.2.2");
  });

  it("embeds the canonical superhero landing source exactly", () => {
    const source = readFileSync(
      resolve(root, "spec/examples/superhero-landing.posecode"),
      "utf8",
    );
    const html = readFileSync(
      resolve(root, "playground/public/moves/superhero-landing.html"),
      "utf8",
    );

    expect(html).toContain(
      `<pre class="code-block"><code>${esc(source)}</code></pre>`,
    );
  });

  it("publishes the canonical authoring contract and cue semantics", () => {
    const spec = readFileSync(resolve(root, "playground/public/spec.html"), "utf8");
    const guide = readFileSync(resolve(root, "playground/public/llm-guide.html"), "utf8");
    const movement = readFileSync(
      resolve(root, "playground/public/moves/superhero-landing.html"),
      "utf8",
    );

    expect(spec).toContain("normative language and IR contract");
    expect(guide).toContain("normative language and IR contract");
    expect(spec).toContain("display-only coaching metadata");
    expect(guide).toContain("display-only coaching text");
    expect(spec).toContain("pose start = standing:");
    expect(guide).toContain("pose start = &lt;pose&gt;:");
    expect(movement).toContain("Phase cues are display-only coaching text");
  });
});

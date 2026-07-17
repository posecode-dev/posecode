import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { esc } from "./lib/shell.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("generated content pages", () => {
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
});

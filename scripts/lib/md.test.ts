import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./md.mjs";

describe("minimal Markdown renderer", () => {
  it("keeps wrapped list prose inside one list item", () => {
    const html = renderMarkdown("- First line\n  continued line\n");
    expect(html).toBe("<ul><li>First line continued line</li></ul>");
  });

  it("renders an indented fenced example as a code block", () => {
    const html = renderMarkdown([
      "- Example:",
      "",
      "  ```posecode",
      "  step \"Hold\" 1s linear:",
      "    ground-lock: feet",
      "  ```",
    ].join("\n"));
    expect(html).toContain('data-lang="posecode"');
    expect(html).toContain('step &quot;Hold&quot; 1s linear:');
    expect(html).not.toContain("```");
  });
});

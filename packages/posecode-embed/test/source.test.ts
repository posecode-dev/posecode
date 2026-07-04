import { describe, it, expect } from "vitest";
import { resolveSource } from "../src/source.js";
import { encodePosecode } from "posecode-share";

const DOC = [
  'posecode exercise "t"',
  "  rig humanoid",
  '  step "go" 1s linear:',
  "    elbows: flex 90",
].join("\n");

describe("resolveSource", () => {
  it("decodes a share token from the doc attribute (highest precedence)", async () => {
    const token = encodePosecode(DOC);
    const r = await resolveSource({ doc: token, text: "ignored inline" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.source).toBe(DOC);
  });

  it("reports a friendly error for a malformed token instead of throwing", async () => {
    const r = await resolveSource({ doc: "!!!not-a-token!!!" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/token|decode/i);
  });

  it("falls back to inline text when no doc/src is given", async () => {
    const r = await resolveSource({ text: `  \n${DOC}\n  ` });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.source).toBe(DOC); // trimmed
  });

  it("fetches a src URL when doc is absent", async () => {
    const fetchImpl = async (url: string) => {
      expect(url).toBe("https://example.test/squat.posecode");
      return { ok: true, text: async () => DOC } as Response;
    };
    const r = await resolveSource(
      { src: "https://example.test/squat.posecode" },
      fetchImpl as typeof fetch,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.source).toBe(DOC);
  });

  it("reports an error when the src fetch fails", async () => {
    const fetchImpl = async () => ({ ok: false, status: 404 }) as Response;
    const r = await resolveSource(
      { src: "https://example.test/missing.posecode" },
      fetchImpl as typeof fetch,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/404|load|fetch/i);
  });

  it("reports an error when there is no source at all", async () => {
    const r = await resolveSource({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/no.*(movement|source)/i);
  });
});

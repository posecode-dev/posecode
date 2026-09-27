import { describe, expect, it } from "vitest";

import { checkSiteHealth, formatHealthReport } from "./check-site-health.mjs";

function response(body: string, status = 200) {
  return new Response(body, { status });
}

describe("site health monitor", () => {
  it("accepts healthy canonical pages and sitemap", async () => {
    const fetchImpl = async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/robots.txt")) return response("Sitemap: https://www.posecode.org/sitemap.xml");
      if (url.endsWith("/sitemap.xml")) return response("<loc>https://www.posecode.org/for-products</loc>");
      if (url.endsWith("/play/superhero-landing")) return response("Posecode");
      return response('<link rel="canonical" href="https://www.posecode.org/" />');
    };

    const report = await checkSiteHealth({ fetchImpl });
    expect(report.ok).toBe(true);
    expect(formatHealthReport(report)).toContain("Posecode production health: OK");
  });

  it("flags failed routes and non-www sitemap URLs", async () => {
    const fetchImpl = async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/sitemap.xml")) {
        return response("<loc>https://posecode.org/moves</loc>");
      }
      return response("not found", 404);
    };

    const report = await checkSiteHealth({ fetchImpl });
    expect(report.ok).toBe(false);
    expect(formatHealthReport(report)).toContain("sitemap contains non-www canonical URLs");
  });
});

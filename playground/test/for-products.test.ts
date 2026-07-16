import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const page = readFileSync(resolve(root, "playground/for-products.html"), "utf8");
const home = readFileSync(resolve(root, "playground/index.html"), "utf8");
const vercel = JSON.parse(readFileSync(resolve(root, "vercel.json"), "utf8")) as {
  redirects: Array<{ source: string; destination: string }>;
  rewrites: Array<{ source: string; destination: string }>;
};

describe("product integration page", () => {
  it("publishes the clean route and makes it discoverable", () => {
    expect(vercel.rewrites).toContainEqual({ source: "/for-products", destination: "/for-products.html" });
    expect(vercel.redirects).toContainEqual({ source: "/for-products.html", destination: "/for-products", permanent: true });
    expect(home).toContain('href="/for-products"');
  });

  it("includes canonical and social metadata", () => {
    expect(page).toContain("<title>Use Posecode in Your Product");
    expect(page).toContain('rel="canonical" href="https://www.posecode.org/for-products"');
    expect(page).toContain('property="og:title"');
    expect(page).toContain('name="twitter:card"');
  });

  it("keeps current and potential capabilities explicitly separate", () => {
    expect(page).toContain('id="today"');
    expect(page).toContain('id="exploring"');
    expect(page).toContain("No hosted commercial platform yet");
    expect(page).toContain("None of these capabilities is generally available today");
    expect(page).toContain("There is no published commercial pricing");
  });

  it("provides an integration-specific contact action", () => {
    expect(page).toContain("mailto:hello@posecode.org?subject=Posecode%20product%20integration");
  });
});

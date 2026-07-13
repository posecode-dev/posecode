#!/usr/bin/env node
/**
 * Renders the Posecode logo lockup (lime figure glyph + "Posecode" wordmark) to
 * PNG on a transparent and a dark background, for profiles / Product Hunt / decks.
 * Uses the real brand font (Hanken Grotesk) via Google Fonts so the wordmark
 * matches the site exactly. Output → docs/brand/.
 *
 *   posecode-logo.png        transparent background
 *   posecode-logo-dark.png   ink (#0a0d12) background
 *
 * Usage: node scripts/capture-logo.mjs
 */
import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { chromiumPath } from "./lib/gif-capture.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const outDir = resolve(repoRoot, "docs/brand");
await mkdir(outDir, { recursive: true });

const LIME = "#c6f24a";
const INK = "#0a0d12";

// Figure glyph = the favicon paths, forced lime (no color-scheme dependence).
const glyph = `
<svg width="132" height="132" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <g fill="none" stroke="${LIME}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M50 34V55"/>
    <path d="M50 35L34 26L23 15"/>
    <path d="M50 35L66 26L77 15"/>
    <path d="M50 54L36 72L28 88"/>
    <path d="M50 54L64 72L72 88"/>
  </g>
  <circle fill="${LIME}" cx="50" cy="20" r="10"/>
</svg>`;

const html = (dark) => `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@800&display=swap" rel="stylesheet">
<style>
  html,body{margin:0}
  #lockup{
    display:inline-flex;align-items:center;gap:34px;
    padding:56px 72px;
    ${dark ? `background:${INK};` : "background:transparent;"}
    font-family:"Hanken Grotesk",system-ui,sans-serif;
  }
  #lockup .mark{display:flex}
  #lockup .word{font-weight:800;font-size:132px;line-height:1;letter-spacing:-0.02em}
  #lockup .word .p{color:#f4f7fb}
  #lockup .word .c{color:${LIME}}
</style></head>
<body><div id="lockup">
  <span class="mark">${glyph}</span>
  <span class="word"><span class="p">Pose</span><span class="c">code</span></span>
</div></body></html>`;

const browser = await chromium.launch({ executablePath: chromiumPath() });
const page = await browser.newPage({ deviceScaleFactor: 2 });
try {
  for (const [name, dark] of [["posecode-logo", false], ["posecode-logo-dark", true]]) {
    await page.setContent(html(dark), { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(200);
    const el = await page.$("#lockup");
    await el.screenshot({
      path: resolve(outDir, `${name}.png`),
      omitBackground: !dark,
    });
    console.log(`wrote docs/brand/${name}.png${dark ? " (ink bg)" : " (transparent)"}`);
  }
} finally {
  await browser.close();
}

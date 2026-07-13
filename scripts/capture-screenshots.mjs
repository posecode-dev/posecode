#!/usr/bin/env node
/**
 * Launch-asset screenshots (Phase 2 "static images"), rendered from the real
 * playground at 2x device scale for crisp PNGs. Output → docs/launch-media/.
 *
 *   play-desktop.png    full editor + viewer (1440x900 @2x)
 *   play-transport.png  close-up of the transport bar
 *   play-mobile.png     mobile viewport (390x844 @3x)
 *
 * Usage: node scripts/capture-screenshots.mjs
 */
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { bootPlayground, gotoDoc } from "./lib/gif-capture.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const outDir = resolve(repoRoot, "docs/launch-media");
await mkdir(outDir, { recursive: true });

const HERO_DOC = "jumping-jacks";
const HERO_SEEK = 0.5; // fraction of duration: arms overhead, legs wide

// --- Desktop: full editor + viewer, plus a transport close-up ---------------
{
  const { page, origin, close } = await bootPlayground({
    repoRoot,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  try {
    await gotoDoc(page, origin, HERO_DOC);
    await page.evaluate((f) => {
      const v = window.__posecodeViewer;
      v.pause();
      v.seek(v.duration * f);
      v.captureFrame?.();
    }, HERO_SEEK);
    await page.waitForTimeout(300);

    await page.screenshot({ path: resolve(outDir, "play-desktop.png") });
    console.log("wrote docs/launch-media/play-desktop.png (1440x900 @2x)");

    const transport = await page.$(".transport");
    if (transport) {
      await transport.screenshot({ path: resolve(outDir, "play-transport.png") });
      console.log("wrote docs/launch-media/play-transport.png");
    } else {
      console.warn("!! .transport not found — skipped transport close-up");
    }
  } finally {
    await close();
  }
}

// --- Mobile: portrait viewport ----------------------------------------------
{
  const { page, origin, close } = await bootPlayground({
    repoRoot,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
  });
  try {
    await gotoDoc(page, origin, HERO_DOC);
    await page.evaluate((f) => {
      const v = window.__posecodeViewer;
      v.pause();
      v.seek(v.duration * f);
      v.captureFrame?.();
    }, HERO_SEEK);
    await page.waitForTimeout(300);

    await page.screenshot({ path: resolve(outDir, "play-mobile.png") });
    console.log("wrote docs/launch-media/play-mobile.png (390x844 @3x)");
  } finally {
    await close();
  }
}

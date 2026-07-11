#!/usr/bin/env node
/**
 * Regenerates the README movement GIFs from the real renderer.
 *
 * Boots the playground with Vite, drives the live viewer headlessly with
 * Playwright (seek → captureFrame per animation frame), and encodes looping
 * GIFs with gifenc. Frames are composed to the target size inside the page
 * (cover-crop of the viewer canvas), so no image tooling is needed in node.
 *
 * Not wired into `npm run build`: run it manually when the figure or a
 * showcased movement changes, and commit the output.
 *
 * Usage:
 *   node scripts/capture-gifs.mjs            # all README gifs
 *   node scripts/capture-gifs.mjs squat      # just one
 *
 * The Chromium binary is resolved from PLAYWRIGHT_BROWSERS_PATH/chromium or
 * POSECODE_CHROMIUM.
 */
import { createServer } from "vite";
import { chromium } from "playwright-core";
import gifencPkg from "gifenc"; // CJS: no named ESM exports
const { GIFEncoder, quantize, applyPalette } = gifencPkg;
import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

/** README media set. `size` matches the committed GIFs' dimensions. */
const TARGETS = [
  { id: "jumping-jacks", size: [480, 534], fps: 14 },
  { id: "squat", size: [420, 582], fps: 14 },
  { id: "deadlift", size: [420, 582], fps: 14 },
  { id: "lateral", out: "lateral-raise", size: [420, 582], fps: 14 },
];

function chromiumPath() {
  if (process.env.POSECODE_CHROMIUM) return process.env.POSECODE_CHROMIUM;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (base && existsSync(`${base}/chromium`)) return `${base}/chromium`;
  return chromium.executablePath();
}

const only = process.argv[2];
const targets = TARGETS.filter((t) => !only || t.id === only || t.out === only);
if (targets.length === 0) {
  console.error(`no such target: ${only}`);
  process.exit(1);
}

const server = await createServer({
  configFile: resolve(repoRoot, "playground/vite.config.ts"),
  server: { port: 0 },
  logLevel: "error",
});
await server.listen();
const port = server.config.server.port ?? server.httpServer.address().port;
const origin = `http://127.0.0.1:${port}`;

const browser = await chromium.launch({ executablePath: chromiumPath() });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on("pageerror", (e) => console.error("[page]", e.message));

for (const t of targets) {
  const [w, h] = t.size;
  await page.goto(`${origin}/play/${t.id}`, { waitUntil: "load" });
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => window.__posecodeViewer?.duration > 0, null, {
    timeout: 60000,
  });
  await page.waitForFunction(() => window.__posecodeViewer.characterActive === true, null, {
    timeout: 60000,
  });
  await page.waitForTimeout(1600); // let the auto-framing camera settle

  const duration = await page.evaluate(() => {
    const v = window.__posecodeViewer;
    v.pause();
    return v.duration;
  });
  const frameCount = Math.round(duration * t.fps);
  const delayMs = Math.round(1000 / t.fps);

  const gif = GIFEncoder();
  let palette = null;
  for (let i = 0; i < frameCount; i++) {
    const time = (i / t.fps) % duration;
    const b64 = await page.evaluate(
      ({ time, w, h }) => {
        const v = window.__posecodeViewer;
        v.seek(time);
        v.captureFrame();
        const src = document.getElementById("canvas");
        // Cover-crop the viewer canvas into the target frame.
        const scale = Math.max(w / src.width, h / src.height);
        const sw = w / scale;
        const sh = h / scale;
        const sx = (src.width - sw) / 2;
        const sy = (src.height - sh) / 2;
        const out = new OffscreenCanvas(w, h);
        const ctx = out.getContext("2d");
        ctx.drawImage(src, sx, sy, sw, sh, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h).data;
        let bin = "";
        for (let j = 0; j < data.length; j += 8192) {
          bin += String.fromCharCode.apply(null, data.subarray(j, j + 8192));
        }
        return btoa(bin);
      },
      { time, w, h },
    );
    const rgba = Uint8Array.from(Buffer.from(b64, "base64"));
    // One palette for the whole clip keeps the loop flicker-free (the scene
    // lighting is static; only the figure moves).
    if (!palette) palette = quantize(rgba, 256);
    const indexed = applyPalette(rgba, palette);
    gif.writeFrame(indexed, w, h, { palette: i === 0 ? palette : undefined, delay: delayMs });
  }
  gif.finish();

  const outName = `${t.out ?? t.id}.gif`;
  const outPath = resolve(repoRoot, "docs/media", outName);
  await writeFile(outPath, gif.bytes());
  console.log(`wrote docs/media/${outName} (${frameCount} frames @ ${t.fps}fps, ${w}x${h})`);
}

await browser.close();
await server.close();

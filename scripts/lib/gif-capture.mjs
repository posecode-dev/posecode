/**
 * Shared GIF-capture core for the posecode playground.
 *
 * Boots the playground with Vite, drives the live viewer headlessly with
 * Playwright (seek → captureFrame per animation frame), and encodes looping
 * GIFs with gifenc. Frames are composed to the target size inside the page
 * (cover-crop of the viewer canvas), so no image tooling is needed in node.
 *
 * The Chromium binary is resolved from PLAYWRIGHT_BROWSERS_PATH/chromium or
 * POSECODE_CHROMIUM, falling back to playwright-core's bundled binary.
 */
import { createServer } from "vite";
import { chromium } from "playwright-core";
import gifencPkg from "gifenc"; // CJS: no named ESM exports
const { GIFEncoder, quantize, applyPalette } = gifencPkg;
import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export function chromiumPath() {
  if (process.env.POSECODE_CHROMIUM) return process.env.POSECODE_CHROMIUM;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (base && existsSync(`${base}/chromium`)) return `${base}/chromium`;
  return chromium.executablePath();
}

/**
 * Boots the Vite playground + a headless Chromium page against it. Returns the
 * page, its origin, and a `close()` that tears both down. Shared by the GIF and
 * screenshot capture scripts so there is one boot path.
 *
 * @param {{repoRoot:string, viewport?:{width:number,height:number}, deviceScaleFactor?:number}} opts
 */
export async function bootPlayground({ repoRoot, viewport, deviceScaleFactor }) {
  const server = await createServer({
    configFile: resolve(repoRoot, "playground/vite.config.ts"),
    server: { port: 0, host: "127.0.0.1" },
    logLevel: "error",
  });
  await server.listen();
  // With `port: 0`, config.server.port stays 0, so read the listening socket.
  const port = server.httpServer.address().port;
  const origin = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch({ executablePath: chromiumPath() });
  const page = await browser.newPage({
    viewport: viewport ?? { width: 1600, height: 1000 },
    deviceScaleFactor: deviceScaleFactor ?? 1,
  });
  page.on("pageerror", (e) => console.error("[page]", e.message));

  const close = async () => {
    await browser.close();
    await server.close();
  };
  return { page, origin, close };
}

/** Wait for the viewer + Xbot character to be ready for a given doc. */
export async function gotoDoc(page, origin, id) {
  await page.goto(`${origin}/play.html#doc=${id}`, { waitUntil: "load" });
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => window.__posecodeViewer?.duration > 0, null, {
    timeout: 60000,
  });
  await page.waitForFunction(
    () => window.__posecodeViewer.characterActive === true,
    null,
    { timeout: 60000 },
  );
  await page.waitForTimeout(1600); // let the auto-framing camera settle
}

/**
 * @param {Array<{id:string,out?:string,size:[number,number],fps:number}>} targets
 * @param {{repoRoot:string,outDir:string}} opts  outDir is relative to repoRoot.
 */
export async function captureGifs(targets, { repoRoot, outDir }) {
  if (targets.length === 0) throw new Error("no capture targets");

  const outAbs = resolve(repoRoot, outDir);
  await mkdir(outAbs, { recursive: true });

  const { page, origin, close } = await bootPlayground({ repoRoot });

  const written = [];
  try {
    for (const t of targets) {
      const [w, h] = t.size;
      const anchorY = t.anchorY ?? 0.5; // vertical crop bias (0 top, 1 bottom)
      await gotoDoc(page, origin, t.id);

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
          ({ time, w, h, anchorY }) => {
            const v = window.__posecodeViewer;
            v.seek(time);
            v.captureFrame();
            const src = document.getElementById("canvas");
            // Cover-crop the viewer canvas into the target frame.
            const scale = Math.max(w / src.width, h / src.height);
            const sw = w / scale;
            const sh = h / scale;
            const sx = (src.width - sw) / 2;
            const sy = (src.height - sh) * anchorY;
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
          { time, w, h, anchorY },
        );
        const rgba = Uint8Array.from(Buffer.from(b64, "base64"));
        // One palette for the whole clip keeps the loop flicker-free (scene
        // lighting is static; only the figure moves).
        if (!palette) palette = quantize(rgba, 256);
        const indexed = applyPalette(rgba, palette);
        gif.writeFrame(indexed, w, h, {
          palette: i === 0 ? palette : undefined,
          delay: delayMs,
        });
      }
      gif.finish();

      const outName = `${t.out ?? t.id}.gif`;
      const outPath = resolve(outAbs, outName);
      await writeFile(outPath, gif.bytes());
      const kb = (gif.bytes().length / 1024).toFixed(0);
      console.log(
        `wrote ${outDir}/${outName} (${frameCount} frames @ ${t.fps}fps, ${w}x${h}, ${kb}KB)`,
      );
      written.push(outPath);
    }
  } finally {
    await close();
  }
  return written;
}

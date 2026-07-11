import { createServer } from "vite";
import { chromium } from "playwright-core";
import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = here;

function chromiumPath() {
  if (process.env.POSECODE_CHROMIUM) return process.env.POSECODE_CHROMIUM;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (base && existsSync(`${base}/chromium`)) return `${base}/chromium`;
  try {
    return chromium.executablePath();
  } catch (e) {
    return undefined;
  }
}

async function capture() {
  const server = await createServer({
    configFile: resolve(repoRoot, "playground/vite.config.ts"),
    server: { port: 0, host: "127.0.0.1" },
    logLevel: "error",
  });
  await server.listen();
  const port = server.config.server.port ?? server.httpServer.address().port;
  const origin = `http://127.0.0.1:${port}`;

  const execPath = chromiumPath();
  const browser = await chromium.launch(execPath ? { executablePath: execPath } : undefined);
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });

  console.log("Navigating to Deadlift...");
  await page.goto(`${origin}/play/deadlift`, { waitUntil: "load" });
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => window.__posecodeViewer?.duration > 0, null, { timeout: 30000 });
  await page.waitForTimeout(2000); // let auto-camera settle

  // Seek to the bottom of the deadlift (1.6s)
  await page.evaluate(() => {
    const v = window.__posecodeViewer;
    v.pause();
    v.seek(1.6);
  });
  await page.waitForTimeout(500);

  const b64 = await page.evaluate(() => {
    const canvas = document.getElementById("canvas");
    if (window.__posecodeViewer) {
      window.__posecodeViewer.captureFrame();
    }
    return canvas.toDataURL("image/png").replace(/^data:image\/png;base64,/, "");
  });

  await writeFile(resolve(here, "deadlift_lower.png"), Buffer.from(b64, "base64"));
  console.log("Deadlift screenshot saved.");

  await browser.close();
  await server.close();
}

capture().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});

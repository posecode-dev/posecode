/** Load the TypeScript preset catalog through the playground's own Vite dependency. */
import { createServer } from "vite";

export async function loadPlaygroundPresets(playgroundRoot) {
  const server = await createServer({
    root: playgroundRoot,
    appType: "custom",
    server: { middlewareMode: true, hmr: false, ws: false },
  });
  try {
    const module = await server.ssrLoadModule("/src/presets.ts");
    return module.PRESETS;
  } finally {
    await server.close();
  }
}

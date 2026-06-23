import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

export default defineConfig({
  root: here,
  resolve: {
    alias: {
      "movit-parser": resolve(repoRoot, "packages/movit-parser/src/index.ts"),
      "movit-render": resolve(repoRoot, "packages/movit-render/src/index.ts"),
      "movit-share": resolve(repoRoot, "packages/movit-share/src/index.ts"),
    },
    dedupe: ["three"],
  },
  build: {
    rollupOptions: {
      input: {
        // Two pages: the landing (/) and the playground (/play.html).
        main: resolve(here, "index.html"),
        play: resolve(here, "play.html"),
      },
    },
  },
  server: {
    // Allow importing .movit examples and llm-authoring.md from spec/.
    fs: { allow: [repoRoot] },
  },
});

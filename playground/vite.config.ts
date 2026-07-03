import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

export default defineConfig({
  root: here,
  resolve: {
    alias: {
      "posecode-parser": resolve(repoRoot, "packages/posecode-parser/src/index.ts"),
      "posecode-render": resolve(repoRoot, "packages/posecode-render/src/index.ts"),
      "posecode-share": resolve(repoRoot, "packages/posecode-share/src/index.ts"),
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
    // Allow importing .posecode examples and llm-authoring.md from spec/.
    fs: { allow: [repoRoot] },
  },
});

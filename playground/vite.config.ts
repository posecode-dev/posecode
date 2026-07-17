import { defineConfig, type Plugin } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

/** Mirror the production Vercel rewrites during local dev and `vite preview`. */
function friendlyPlayRoutes(): Plugin {
  const rewrite = (url: string | undefined): string | undefined => {
    if (!url) return url;
    const queryStart = url.indexOf("?");
    const pathname = queryStart === -1 ? url : url.slice(0, queryStart);
    const query = queryStart === -1 ? "" : url.slice(queryStart);
    if (pathname === "/play" || /^\/play\/[^/]+\/?$/.test(pathname)) {
      return `/play.html${query}`;
    }
    return url;
  };
  const install = (middlewares: { use: (handler: (
    req: { url?: string },
    res: unknown,
    next: () => void,
  ) => void) => void }): void => {
    middlewares.use((req, _res, next) => {
      req.url = rewrite(req.url);
      next();
    });
  };
  return {
    name: "posecode-friendly-play-routes",
    configureServer(server) {
      install(server.middlewares);
    },
    configurePreviewServer(server) {
      install(server.middlewares);
    },
  };
}

export default defineConfig({
  root: here,
  plugins: [friendlyPlayRoutes()],
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
        // Build files behind the public `/`, `/play[/movement]`, and
        // `/for-products` routes.
        main: resolve(here, "index.html"),
        play: resolve(here, "play.html"),
        forProducts: resolve(here, "for-products.html"),
      },
    },
  },
  server: {
    // Allow importing .posecode examples and llm-authoring.md from spec/.
    fs: { allow: [repoRoot] },
  },
});

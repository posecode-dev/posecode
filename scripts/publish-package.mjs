#!/usr/bin/env node
/**
 * Publishes one packages/* library to npm with a dist-based manifest, without
 * disturbing the source-first package.json the monorepo relies on for dev
 * (Vite/vitest/tsc all resolve these packages via "main": "./src/index.ts").
 *
 * npm has no built-in way to swap main/types/exports at publish time. That's
 * a Yarn Berry feature, not npm's: verified empirically, `npm pack` ignores
 * `publishConfig.main/types/exports`. So this script does it by hand: build
 * dist/, temporarily rewrite package.json to point at dist/, publish, then
 * always restore the original package.json, even on failure.
 *
 * Usage:
 *   node scripts/publish-package.mjs posecode-parser            # dry run
 *   node scripts/publish-package.mjs posecode-parser --live     # real publish
 *
 * Requires `npm login` first (this script does not handle auth).
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

const [name, ...rest] = process.argv.slice(2);
const live = rest.includes("--live");

if (!name) {
  console.error("Usage: node scripts/publish-package.mjs <package-name> [--live]");
  process.exit(1);
}

const pkgDir = resolve(repoRoot, "packages", name);
const pkgJsonPath = resolve(pkgDir, "package.json");
const original = readFileSync(pkgJsonPath, "utf8");
const pkg = JSON.parse(original);

function run(cmd, args) {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { cwd: pkgDir, stdio: "inherit" });
}

try {
  console.log(`\n== Building ${name} ==`);
  run("npm", ["run", "build"]);

  const published = {
    ...pkg,
    main: "./dist/index.js",
    types: "./dist/index.d.ts",
    exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } },
  };
  writeFileSync(pkgJsonPath, JSON.stringify(published, null, 2) + "\n");

  console.log(`\n== ${live ? "Publishing" : "Dry-run publishing"} ${name} ==`);
  run("npm", ["publish", "--access", "public", ...(live ? [] : ["--dry-run"])]);
} finally {
  writeFileSync(pkgJsonPath, original);
  console.log(`\n== Restored ${name}/package.json to its source-first form ==`);
}

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";

const root = resolve(import.meta.dirname, "..");
const npmCache = mkdtempSync(join(tmpdir(), "posecode-npm-cache-"));
const publicPackages = [
  "posecode-parser",
  "posecode-render",
  "posecode-share",
  "posecode-embed",
  "posecode-mcp",
];

const manifests = new Map(
  publicPackages.map((name) => {
    const directory = resolve(root, "packages", name);
    const manifest = JSON.parse(readFileSync(resolve(directory, "package.json"), "utf8"));
    return [name, { directory, manifest }];
  }),
);

const errors = [];
const versions = new Set([...manifests.values()].map(({ manifest }) => manifest.version));
if (versions.size !== 1) {
  errors.push(`Public package versions differ: ${[...versions].join(", ")}`);
}

for (const [name, { directory, manifest }] of manifests) {
  if (manifest.private) errors.push(`${name} must not be private.`);
  if (manifest.publishConfig?.access !== "public") {
    errors.push(`${name} must set publishConfig.access to public.`);
  }
  if (!manifest.files?.includes("dist") || !manifest.files?.includes("README.md")) {
    errors.push(`${name} must publish dist and README.md.`);
  }

  const targets = new Set();
  collectTargets(manifest.main, targets);
  collectTargets(manifest.types, targets);
  collectTargets(manifest.exports, targets);
  collectTargets(manifest.bin, targets);

  for (const target of targets) {
    if (!target.startsWith("./dist/") && !target.startsWith("dist/")) {
      errors.push(`${name} exposes a non-dist entry point: ${target}`);
      continue;
    }
    if (!existsSync(resolve(directory, target))) {
      errors.push(`${name} entry point does not exist after build: ${target}`);
    }
  }

  for (const section of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    for (const [dependency, range] of Object.entries(manifest[section] ?? {})) {
      const internal = manifests.get(dependency);
      if (internal && range !== internal.manifest.version) {
        errors.push(
          `${name} ${section}.${dependency} is ${range}; expected ${internal.manifest.version}.`,
        );
      }
    }
  }

  const packed = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: directory,
    encoding: "utf8",
    env: { ...process.env, npm_config_cache: npmCache },
  });
  if (packed.status !== 0) {
    errors.push(`${name} could not be packed:\n${packed.stderr.trim()}`);
    continue;
  }

  try {
    const report = JSON.parse(packed.stdout)[0];
    const files = new Set(report.files.map(({ path }) => path));
    for (const target of targets) {
      const packedPath = target.replace(/^\.\//, "");
      if (!files.has(packedPath)) errors.push(`${name} tarball omits ${packedPath}.`);
    }
    if (name === "posecode-mcp" && !files.has("dist/llm-authoring.md")) {
      errors.push("posecode-mcp tarball omits the current authoring guide.");
    }
  } catch (error) {
    errors.push(`${name} returned an unreadable npm pack report: ${error.message}`);
  }
}

const mcpPackage = manifests.get("posecode-mcp").manifest;
const server = JSON.parse(
  readFileSync(resolve(root, "packages", "posecode-mcp", "server.json"), "utf8"),
);
if (server.name !== mcpPackage.mcpName) {
  errors.push(`server.json name ${server.name} does not match mcpName ${mcpPackage.mcpName}.`);
}
if (typeof server.description !== "string" || server.description.length > 100) {
  errors.push("server.json description must be present and no longer than 100 characters.");
}
if (server.version !== mcpPackage.version) {
  errors.push(`server.json version ${server.version} does not match ${mcpPackage.version}.`);
}
const mcpRegistryPackage = server.packages?.find(
  (pkg) => pkg.registryType === "npm" && pkg.identifier === mcpPackage.name,
);
if (!mcpRegistryPackage) {
  errors.push(`server.json does not declare the ${mcpPackage.name} npm package.`);
} else if (mcpRegistryPackage.version !== mcpPackage.version) {
  errors.push(
    `server.json npm version ${mcpRegistryPackage.version} does not match ${mcpPackage.version}.`,
  );
}

rmSync(npmCache, { recursive: true, force: true });

if (errors.length > 0) {
  console.error(`Package release validation failed:\n- ${errors.join("\n- ")}`);
  process.exitCode = 1;
} else {
  console.log(
    `Validated ${publicPackages.length} publishable packages at version ${[...versions][0]}.`,
  );
}

function collectTargets(value, targets) {
  if (typeof value === "string") {
    if (value.startsWith(".") || value.startsWith("dist/")) targets.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectTargets(item, targets);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectTargets(item, targets);
  }
}

import { readFileSync, writeFileSync } from "node:fs";

const mcpPackagePath = new URL("../packages/posecode-mcp/package.json", import.meta.url);
const serverPath = new URL("../packages/posecode-mcp/server.json", import.meta.url);
const embedPackagePath = new URL("../packages/posecode-embed/package.json", import.meta.url);
const embedSourcePath = new URL("../packages/posecode-embed/src/compat.ts", import.meta.url);

const packageJson = JSON.parse(readFileSync(mcpPackagePath, "utf8"));
const serverJson = JSON.parse(readFileSync(serverPath, "utf8"));
const embedPackageJson = JSON.parse(readFileSync(embedPackagePath, "utf8"));
const embedSource = readFileSync(embedSourcePath, "utf8");

serverJson.version = packageJson.version;
for (const pkg of serverJson.packages ?? []) {
  if (pkg.registryType === "npm" && pkg.identifier === packageJson.name) {
    pkg.version = packageJson.version;
  }
}

writeFileSync(serverPath, `${JSON.stringify(serverJson, null, 2)}\n`);

const versionDeclaration = /export const version = "[^"]+";/;
if (!versionDeclaration.test(embedSource)) {
  throw new Error("Could not find the exported posecode-embed version declaration.");
}
writeFileSync(
  embedSourcePath,
  embedSource.replace(
    versionDeclaration,
    `export const version = ${JSON.stringify(embedPackageJson.version)};`,
  ),
);

console.log(
  `Synced release metadata to ${packageJson.name}@${packageJson.version} and ` +
    `${embedPackageJson.name}@${embedPackageJson.version}.`,
);

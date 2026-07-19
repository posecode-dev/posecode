import { readFileSync, writeFileSync } from "node:fs";

const mcpPackagePath = new URL("../packages/posecode-mcp/package.json", import.meta.url);
const serverPath = new URL("../packages/posecode-mcp/server.json", import.meta.url);
const mcpServerSourcePath = new URL("../packages/posecode-mcp/src/server.ts", import.meta.url);
const embedPackagePath = new URL("../packages/posecode-embed/package.json", import.meta.url);
const embedSourcePath = new URL("../packages/posecode-embed/src/compat.ts", import.meta.url);

const packageJson = JSON.parse(readFileSync(mcpPackagePath, "utf8"));
const serverJson = JSON.parse(readFileSync(serverPath, "utf8"));
const mcpServerSource = readFileSync(mcpServerSourcePath, "utf8");
const embedPackageJson = JSON.parse(readFileSync(embedPackagePath, "utf8"));
const embedSource = readFileSync(embedSourcePath, "utf8");

serverJson.version = packageJson.version;
for (const pkg of serverJson.packages ?? []) {
  if (pkg.registryType === "npm" && pkg.identifier === packageJson.name) {
    pkg.version = packageJson.version;
  }
}

writeFileSync(serverPath, `${JSON.stringify(serverJson, null, 2)}\n`);

const mcpVersionDeclaration = /export const POSECODE_MCP_VERSION = "[^"]+";/;
if (!mcpVersionDeclaration.test(mcpServerSource)) {
  throw new Error("Could not find the Posecode MCP server version declaration.");
}
writeFileSync(
  mcpServerSourcePath,
  mcpServerSource.replace(
    mcpVersionDeclaration,
    `export const POSECODE_MCP_VERSION = ${JSON.stringify(packageJson.version)};`,
  ),
);

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

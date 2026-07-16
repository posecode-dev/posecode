import { readFileSync, writeFileSync } from "node:fs";

const packagePath = new URL("../packages/posecode-mcp/package.json", import.meta.url);
const serverPath = new URL("../packages/posecode-mcp/server.json", import.meta.url);

const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
const serverJson = JSON.parse(readFileSync(serverPath, "utf8"));

serverJson.version = packageJson.version;
for (const pkg of serverJson.packages ?? []) {
  if (pkg.registryType === "npm" && pkg.identifier === packageJson.name) {
    pkg.version = packageJson.version;
  }
}

writeFileSync(serverPath, `${JSON.stringify(serverJson, null, 2)}\n`);
console.log(`Synced MCP Registry metadata to ${packageJson.name}@${packageJson.version}.`);

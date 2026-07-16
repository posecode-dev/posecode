import { copyFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const source = new URL("../spec/llm-authoring.md", import.meta.url);
const destination = new URL("../packages/posecode-mcp/dist/llm-authoring.md", import.meta.url);

mkdirSync(dirname(fileURLToPath(destination)), { recursive: true });
copyFileSync(source, destination);

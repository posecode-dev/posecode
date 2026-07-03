#!/usr/bin/env node
/**
 * Runnable entry point: serve Posecode over stdio for MCP clients
 * (Claude Desktop, Cursor, etc.).
 *
 * Configure the playground used for render links with POSECODE_BASE_URL.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createPosecodeServer } from "./server.js";

const baseUrl = process.env.POSECODE_BASE_URL;
const server = createPosecodeServer(baseUrl ? { baseUrl } : {});

await server.connect(new StdioServerTransport());

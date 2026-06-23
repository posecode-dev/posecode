#!/usr/bin/env node
/**
 * Runnable entry point: serve Movit over stdio for MCP clients
 * (Claude Desktop, Cursor, etc.).
 *
 * Configure the playground used for render links with MOVIT_BASE_URL.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMovitServer } from "./server.js";

const baseUrl = process.env.MOVIT_BASE_URL;
const server = createMovitServer(baseUrl ? { baseUrl } : {});

await server.connect(new StdioServerTransport());

/**
 * Movit MCP server — exposes the Movit protocol to any LLM agent.
 *
 * Three tools turn "an LLM knows biomechanics" into "an LLM can show movement":
 *   - movit_authoring_guide — learn the .movit language inline
 *   - validate_movit        — parse + surface range-of-motion safety clamps
 *   - render_movit          — get a playground link that animates the movement
 *
 * The server is decoupled from any transport so it can be driven over stdio in
 * production and over an in-memory pair in tests.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { analyzeMovit, renderMovit, DEFAULT_BASE_URL } from "./analyze.js";
import { authoringGuide } from "./guide.js";

export interface MovitServerOptions {
  /** Base URL of the playground used for render permalinks. */
  baseUrl?: string;
}

export function createMovitServer(opts: MovitServerOptions = {}): McpServer {
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  const server = new McpServer({ name: "movit", version: "0.1.0" });

  const sourceSchema = {
    source: z.string().describe("The full .movit document text"),
  };

  const asText = (value: unknown, isError = false) => ({
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    isError,
  });

  server.registerTool(
    "movit_authoring_guide",
    {
      title: "How to write Movit",
      description:
        "Return the guide that teaches the Movit (.movit) language — grammar, joints, actions, and an example. Read this before writing a movement.",
      inputSchema: {},
    },
    async () => ({ content: [{ type: "text" as const, text: authoringGuide() }] }),
  );

  server.registerTool(
    "validate_movit",
    {
      title: "Validate a Movit movement",
      description:
        "Parse a .movit document and return any errors plus range-of-motion (ROM) safety clamps. Use this to check a movement before showing it to a user.",
      inputSchema: sourceSchema,
    },
    async ({ source }) => {
      const result = analyzeMovit(source);
      return asText(result, !result.ok);
    },
  );

  server.registerTool(
    "render_movit",
    {
      title: "Render a Movit movement to a link",
      description:
        "Validate a .movit document and return a permalink that animates it as a 3D figure in the Movit playground. Give the link to the user to view the movement.",
      inputSchema: sourceSchema,
    },
    async ({ source }) => {
      const result = renderMovit(source, baseUrl);
      return asText(result, !result.ok);
    },
  );

  return server;
}

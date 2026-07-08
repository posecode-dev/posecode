/**
 * Posecode MCP server: exposes the Posecode protocol to any LLM agent.
 *
 * Three tools turn "an LLM knows biomechanics" into "an LLM can show movement":
 *   - posecode_authoring_guide: learn the .posecode language inline
 *   - validate_posecode:       parse + surface range-of-motion safety clamps
 *   - render_posecode:         get a playground link that animates the movement
 *
 * The server is decoupled from any transport so it can be driven over stdio in
 * production and over an in-memory pair in tests.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { analyzePosecode, renderPosecode, DEFAULT_BASE_URL } from "./analyze.js";
import { authoringGuide } from "./guide.js";

export interface PosecodeServerOptions {
  /** Base URL of the playground used for render permalinks. */
  baseUrl?: string;
}

export function createPosecodeServer(opts: PosecodeServerOptions = {}): McpServer {
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  const server = new McpServer({ name: "posecode", version: "0.1.0" });

  const sourceSchema = {
    source: z.string().describe("The full .posecode document text"),
  };

  const asText = (value: unknown, isError = false) => ({
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    isError,
  });

  server.registerTool(
    "posecode_authoring_guide",
    {
      title: "How to write Posecode",
      description:
        "Return the guide that teaches the Posecode (.posecode) language: grammar, joints, actions, and an example. Read this before writing a movement.",
      inputSchema: {},
    },
    async () => ({ content: [{ type: "text" as const, text: authoringGuide() }] }),
  );

  server.registerTool(
    "validate_posecode",
    {
      title: "Validate a Posecode movement",
      description:
        "Parse a .posecode document and return any errors plus range-of-motion (ROM) safety clamps. Use this to check a movement before showing it to a user.",
      inputSchema: sourceSchema,
    },
    async ({ source }) => {
      const result = analyzePosecode(source);
      return asText(result, !result.ok);
    },
  );

  server.registerTool(
    "render_posecode",
    {
      title: "Render a Posecode movement to a link",
      description:
        "Validate a .posecode document and return a permalink that animates it as a 3D figure in the Posecode playground. Give the link to the user to view the movement.",
      inputSchema: sourceSchema,
    },
    async ({ source }) => {
      const result = renderPosecode(source, baseUrl);
      return asText(result, !result.ok);
    },
  );

  return server;
}

import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { readShareHash } from "movit-share";
import { analyzeMovit, renderMovit, createMovitServer } from "../src/index.js";

const VALID = [
  'movit exercise "Clamp Test"',
  "  rig humanoid",
  "  pose start = standing",
  '  step "Deep" 1s linear:',
  "    knees: flex 200", // over the 144° ROM ceiling — must clamp + warn
  '    cue "too deep"',
  "  repeat 2",
].join("\n");

const INVALID = "this is definitely not a movit document";

describe("analyzeMovit", () => {
  it("reports a valid document with a ROM clamp warning", () => {
    const r = analyzeMovit(VALID);
    expect(r.ok).toBe(true);
    expect(r.name).toBe("Clamp Test");
    expect(r.kind).toBe("exercise");
    expect(r.repeat).toBe(2);
    expect(r.phases?.[0]?.name).toBe("Deep");
    expect(r.errors).toHaveLength(0);
    expect(r.romWarnings.length).toBeGreaterThan(0);
    expect(r.romWarnings[0]?.clamped).toBe(144);
  });

  it("reports an invalid document with errors and no summary", () => {
    const r = analyzeMovit(INVALID);
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.name).toBeUndefined();
  });
});

describe("renderMovit", () => {
  it("returns a permalink that round-trips back to the source", () => {
    const r = renderMovit(VALID, "https://example.test");
    expect(r.ok).toBe(true);
    expect(r.permalink?.startsWith("https://example.test/#doc=")).toBe(true);
    const hash = r.permalink!.slice("https://example.test/".length);
    expect(readShareHash(hash)).toBe(VALID);
  });

  it("omits the permalink for an invalid document", () => {
    const r = renderMovit(INVALID, "https://example.test");
    expect(r.ok).toBe(false);
    expect(r.permalink).toBeUndefined();
  });
});

describe("Movit MCP server", () => {
  async function connect() {
    const server = createMovitServer({ baseUrl: "https://example.test" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(clientTransport);
    return client;
  }

  it("exposes validate, render, and authoring-guide tools", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "movit_authoring_guide",
      "render_movit",
      "validate_movit",
    ]);
  });

  it("validate_movit surfaces ROM warnings as a non-error result", async () => {
    const client = await connect();
    const res = await client.callTool({
      name: "validate_movit",
      arguments: { source: VALID },
    });
    const text = (res.content as { type: string; text: string }[])[0]!.text;
    const parsed = JSON.parse(text);
    expect(res.isError).toBeFalsy();
    expect(parsed.ok).toBe(true);
    expect(parsed.romWarnings.length).toBeGreaterThan(0);
  });

  it("render_movit returns a playground permalink", async () => {
    const client = await connect();
    const res = await client.callTool({
      name: "render_movit",
      arguments: { source: VALID },
    });
    const text = (res.content as { type: string; text: string }[])[0]!.text;
    const parsed = JSON.parse(text);
    expect(parsed.permalink).toContain("https://example.test/#doc=");
  });

  it("flags an invalid document as an error result", async () => {
    const client = await connect();
    const res = await client.callTool({
      name: "validate_movit",
      arguments: { source: INVALID },
    });
    expect(res.isError).toBe(true);
  });

  it("movit_authoring_guide returns the DSL guide", async () => {
    const client = await connect();
    const res = await client.callTool({
      name: "movit_authoring_guide",
      arguments: {},
    });
    const text = (res.content as { type: string; text: string }[])[0]!.text;
    expect(text).toContain("Movit");
    expect(text.toLowerCase()).toContain("grammar");
  });
});

import { describe, it, expect } from "vitest";
import {
  encodePosecode,
  decodePosecode,
  buildShareHash,
  readShareHash,
  MAX_SOURCE_LENGTH,
  SHARE_PARAM,
} from "../src/index.js";

const SAMPLE = [
  'posecode exercise "Push-up"',
  "  rig humanoid",
  "  pose start = plank",
  "",
  '  step "Lower" 2s ease-in:',
  "    elbows: flex 90",
  '    cue "Lower until elbows ~90°, body in one straight line"',
  "  repeat 8",
].join("\n");

describe("posecode-share codec", () => {
  it("round-trips an ASCII document", () => {
    const token = encodePosecode(SAMPLE);
    expect(decodePosecode(token)).toBe(SAMPLE);
  });

  it("round-trips Unicode (degree signs, curly quotes)", () => {
    const unicode = 'cue "Reach ≈90° — keep “neutral” spine"';
    expect(decodePosecode(encodePosecode(unicode))).toBe(unicode);
  });

  it("produces a URL-safe token (no +, /, =, or whitespace)", () => {
    const token = encodePosecode(SAMPLE);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("builds and reads a hash symmetrically", () => {
    const hash = buildShareHash(SAMPLE);
    expect(hash.startsWith(`#${SHARE_PARAM}=`)).toBe(true);
    expect(readShareHash(hash)).toBe(SAMPLE);
  });

  it("reads a hash that has no leading '#'", () => {
    const hash = buildShareHash(SAMPLE).slice(1);
    expect(readShareHash(hash)).toBe(SAMPLE);
  });

  it("returns null for hashes without a share token", () => {
    expect(readShareHash("")).toBeNull();
    expect(readShareHash("#")).toBeNull();
    expect(readShareHash("#section-2")).toBeNull();
    expect(readShareHash("#other=value")).toBeNull();
  });

  it("returns null (never throws) for a corrupt token", () => {
    expect(readShareHash(`#${SHARE_PARAM}=@@not-base64@@`)).toBeNull();
  });

  it("rejects empty or non-string input when encoding", () => {
    expect(() => encodePosecode("")).toThrow();
    // @ts-expect-error — guarding the runtime boundary against bad callers
    expect(() => encodePosecode(null)).toThrow();
  });

  it("rejects documents larger than MAX_SOURCE_LENGTH", () => {
    const tooBig = "x".repeat(MAX_SOURCE_LENGTH + 1);
    expect(() => encodePosecode(tooBig)).toThrow();
  });

  it("accepts a document exactly at the limit", () => {
    const atLimit = "a".repeat(MAX_SOURCE_LENGTH);
    expect(decodePosecode(encodePosecode(atLimit))).toBe(atLimit);
  });
});

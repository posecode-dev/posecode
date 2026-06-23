import { describe, it, expect } from "vitest";
import {
  encodeMovit,
  decodeMovit,
  buildShareHash,
  readShareHash,
  MAX_SOURCE_LENGTH,
  SHARE_PARAM,
} from "../src/index.js";

const SAMPLE = [
  'movit exercise "Push-up"',
  "  rig humanoid",
  "  pose start = plank",
  "",
  '  step "Lower" 2s ease-in:',
  "    elbows: flex 90",
  '    cue "Lower until elbows ~90°, body in one straight line"',
  "  repeat 8",
].join("\n");

describe("movit-share codec", () => {
  it("round-trips an ASCII document", () => {
    const token = encodeMovit(SAMPLE);
    expect(decodeMovit(token)).toBe(SAMPLE);
  });

  it("round-trips Unicode (degree signs, curly quotes)", () => {
    const unicode = 'cue "Reach ≈90° — keep “neutral” spine"';
    expect(decodeMovit(encodeMovit(unicode))).toBe(unicode);
  });

  it("produces a URL-safe token (no +, /, =, or whitespace)", () => {
    const token = encodeMovit(SAMPLE);
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
    expect(() => encodeMovit("")).toThrow();
    // @ts-expect-error — guarding the runtime boundary against bad callers
    expect(() => encodeMovit(null)).toThrow();
  });

  it("rejects documents larger than MAX_SOURCE_LENGTH", () => {
    const tooBig = "x".repeat(MAX_SOURCE_LENGTH + 1);
    expect(() => encodeMovit(tooBig)).toThrow();
  });

  it("accepts a document exactly at the limit", () => {
    const atLimit = "a".repeat(MAX_SOURCE_LENGTH);
    expect(decodeMovit(encodeMovit(atLimit))).toBe(atLimit);
  });
});

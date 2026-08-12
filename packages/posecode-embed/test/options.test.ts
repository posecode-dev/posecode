import { describe, it, expect } from "vitest";
import {
  parseOptions,
  DEFAULT_CHARACTER_URL,
  DEFAULT_CHARACTER_URLS,
  DEFAULT_OPTIONS,
} from "../src/options.js";

describe("parseOptions", () => {
  it("returns sensible defaults for an element with no attributes", () => {
    expect(parseOptions({})).toEqual(DEFAULT_OPTIONS);
    expect(DEFAULT_CHARACTER_URL).toBe("https://posecode.org/models/xbot.glb");
    // No explicit `character` attribute: rig-driven, not pinned to one URL.
    expect(DEFAULT_OPTIONS.characterUrl).toBe("");
    expect(DEFAULT_OPTIONS.characterDisabled).toBe(false);
    expect(DEFAULT_OPTIONS.characterUrls).toBe(DEFAULT_CHARACTER_URLS);
    expect(DEFAULT_CHARACTER_URLS.humanoid).toBe(DEFAULT_CHARACTER_URL);
  });

  it("pins an explicit character URL and disables rig-driven selection", () => {
    const o = parseOptions({ character: "https://example.com/me.glb" });
    expect(o.characterUrl).toBe("https://example.com/me.glb");
    expect(o.characterDisabled).toBe(false);
  });

  it("disables the character entirely on a falsey word", () => {
    const o = parseOptions({ character: "off" });
    expect(o.characterUrl).toBe("");
    expect(o.characterDisabled).toBe(true);
  });

  it("treats boolean attributes as present-means-true", () => {
    // HTML boolean attrs: present (even empty string) is true, absent is false.
    const o = parseOptions({ controls: "", autorotate: "false" });
    expect(o.controls).toBe(true);
    // A literal "false" value still disables: friendlier than pure HTML semantics.
    expect(o.autoRotate).toBe(false);
  });

  it("disables autoplay/loop when set to false", () => {
    const o = parseOptions({ autoplay: "false", loop: "false" });
    expect(o.autoplay).toBe(false);
    expect(o.loop).toBe(false);
  });

  it("clamps speed into a safe range and falls back on garbage", () => {
    expect(parseOptions({ speed: "2" }).speed).toBe(2);
    expect(parseOptions({ speed: "99" }).speed).toBe(4); // clamped to max
    expect(parseOptions({ speed: "0" }).speed).toBe(0.1); // clamped to min
    expect(parseOptions({ speed: "fast" }).speed).toBe(1); // fallback
  });
});

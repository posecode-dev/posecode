import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  analyticsRoute,
  initializeAnalytics,
  redactAnalyticsUrl,
} from "../src/vercel-analytics.js";

const vercel = vi.hoisted(() => ({ inject: vi.fn(), track: vi.fn() }));
vi.mock("@vercel/analytics", () => vercel);

describe("Vercel analytics privacy boundary", () => {
  beforeEach(() => {
    vercel.inject.mockClear();
  });

  it("records the load while ignoring editor-driven history mutations", () => {
    initializeAnalytics();

    expect(vercel.inject).toHaveBeenCalledOnce();
    expect(vercel.inject).toHaveBeenCalledWith({
      beforeSend: redactAnalyticsUrl,
      disableAutoTrack: true,
    });
  });

  it("groups public aliases and movement paths into bounded routes", () => {
    expect(analyticsRoute("/index.html")).toBe("/");
    expect(analyticsRoute("/play.html")).toBe("/play");
    expect(analyticsRoute("/play/superhero-landing")).toBe(
      "/play/[movement]",
    );
    expect(analyticsRoute("/play/private/person-name")).toBe(
      "/play/[movement]",
    );
    expect(analyticsRoute("/for-products.html")).toBe("/for-products");
  });

  it("removes query, hash, and movement identifiers from pageview URLs", () => {
    expect(
      redactAnalyticsUrl({
        type: "pageview",
        url: "https://www.posecode.org/play/private-name?email=a%40b.test#doc=encoded-source",
      }),
    ).toEqual({
      type: "pageview",
      url: "https://www.posecode.org/play/[movement]",
    });

    expect(
      redactAnalyticsUrl({
        type: "event",
        url: "/play?person=someone#doc=encoded-source",
      }),
    ).toEqual({ type: "event", url: "/play" });
  });
});

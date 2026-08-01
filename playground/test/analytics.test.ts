import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  configureUsageAnalytics,
  trackUsageEvent,
  UsageSession,
  USAGE_EVENT_NAMES,
  type UsageEventSink,
} from "../src/analytics.js";

describe("product usage analytics", () => {
  const sink = vi.fn<UsageEventSink>();

  beforeEach(() => {
    sink.mockClear();
    configureUsageAnalytics(sink);
  });

  it("keeps stable event names in one typed dictionary", () => {
    expect(USAGE_EVENT_NAMES).toEqual({
      presetOpened: "preset_opened",
      editorChanged: "editor_changed",
      renderSucceeded: "render_succeeded",
      promptCopied: "prompt_copied",
      movementAttempted: "movement_attempted",
      shareCreated: "share_created",
      embedDocsClicked: "embed_docs_clicked",
      installCommandCopied: "install_command_copied",
    });
  });

  it("deduplicates the first meaningful user edit per page session", () => {
    const session = new UsageSession();
    session.trackFirstEdit("preset");
    session.trackFirstEdit("custom");

    expect(sink).toHaveBeenCalledOnce();
    expect(sink).toHaveBeenCalledWith("editor_changed", {
      document_kind: "preset",
    });
  });

  it("deduplicates successful renders by internal revision", () => {
    const session = new UsageSession();
    session.trackSuccessfulRender(4, "editor_change", "custom");
    session.trackSuccessfulRender(4, "editor_change", "custom");
    session.trackSuccessfulRender(5, "preset_open", "preset");

    expect(sink).toHaveBeenCalledTimes(2);
  });

  it("deduplicates each confirmed funnel outcome per page session", () => {
    const session = new UsageSession();

    session.trackPromptCopied("landing");
    session.trackPromptCopied("playground");
    session.trackFirstValidCustomMovement();
    session.trackFirstValidCustomMovement();
    session.trackSuccessfulShare("encoded");
    session.trackSuccessfulShare("preset");

    expect(sink.mock.calls).toEqual([
      ["prompt_copied", { location: "landing" }],
      ["movement_attempted", {}],
      ["share_created", { share_kind: "encoded" }],
    ]);
  });

  it("does not let a blocked provider break product behavior", () => {
    configureUsageAnalytics((() => {
      throw new Error("blocked");
    }) as UsageEventSink);

    expect(() =>
      trackUsageEvent("share_created", { share_kind: "encoded" }),
    ).not.toThrow();
  });
});

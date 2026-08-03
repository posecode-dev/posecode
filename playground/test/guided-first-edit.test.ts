import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  configureUsageAnalytics,
  type UsageEventSink,
} from "../src/analytics.js";
import {
  GUIDED_FIRST_EDIT_EXPERIMENT,
  GuidedFirstEditSession,
  shouldOfferGuidedFirstEdit,
} from "../src/guided-first-edit.js";

const root = resolve(import.meta.dirname, "../..");
const superhero = readFileSync(
  resolve(root, "spec/examples/superhero-landing.posecode"),
  "utf8",
);

describe("guided first-edit activation", () => {
  const sink = vi.fn<UsageEventSink>();

  beforeEach(() => {
    sink.mockClear();
    configureUsageAnalytics(sink);
  });

  it("is offered only on the exact default superhero route and known source", () => {
    expect(
      shouldOfferGuidedFirstEdit(
        "/play/superhero-landing",
        "",
        superhero,
      ),
    ).toBe(true);
    expect(shouldOfferGuidedFirstEdit("/play", "", superhero)).toBe(false);
    expect(
      shouldOfferGuidedFirstEdit(
        "/play/superhero-landing",
        "#doc=private",
        superhero,
      ),
    ).toBe(false);
    expect(
      shouldOfferGuidedFirstEdit(
        "/play/superhero-landing",
        "",
        superhero.replace("knee_right: flex 123", "knee_right: flex 115"),
      ),
    ).toBe(false);
  });

  it("focuses in place on desktop and requests the Editor panel on mobile", () => {
    const desktop = new GuidedFirstEditSession();
    desktop.offer();
    expect(desktop.begin("desktop")).toEqual({
      joint: "knee_right",
      action: "flex",
      switchToEditor: false,
    });

    const mobile = new GuidedFirstEditSession();
    mobile.offer();
    expect(mobile.begin("mobile")).toEqual({
      joint: "knee_right",
      action: "flex",
      switchToEditor: true,
    });

    expect(sink.mock.calls).toContainEqual([
      "guided_edit_started",
      { experiment: GUIDED_FIRST_EDIT_EXPERIMENT, surface: "desktop" },
    ]);
    expect(sink.mock.calls).toContainEqual([
      "guided_edit_started",
      { experiment: GUIDED_FIRST_EDIT_EXPERIMENT, surface: "mobile" },
    ]);
  });

  it("dismisses from the edit state without allowing later completion", () => {
    const session = new GuidedFirstEditSession();
    session.offer();
    expect(session.dismiss()).toBe(true);
    expect(session.stage).toBe("dismissed");

    const changed = superhero.replace(
      "knee_right: flex 123",
      "knee_right: flex 115",
    );
    expect(session.noteUserEdit(changed, true)).toBe(false);
    expect(session.confirmValidCustomRender(changed)).toBe(false);
    expect(sink).toHaveBeenCalledWith("guided_edit_dismissed", {
      experiment: GUIDED_FIRST_EDIT_EXPERIMENT,
      stage: "edit",
    });
    expect(sink).not.toHaveBeenCalledWith(
      "guided_edit_completed",
      expect.anything(),
    );
  });

  it("completes only after the target user edit receives a valid custom render", () => {
    const session = new GuidedFirstEditSession();
    session.offer();
    expect(session.confirmValidCustomRender(superhero)).toBe(false);

    const unrelated = superhero.replace(
      "chest: flex 9",
      "chest: flex 10",
    );
    expect(session.noteUserEdit(unrelated, true)).toBe(false);
    expect(session.confirmValidCustomRender(unrelated)).toBe(false);

    const changed = superhero.replace(
      "knee_right: flex 123",
      "knee_right: flex 115",
    );
    expect(session.noteUserEdit(changed, false)).toBe(false);
    expect(session.noteUserEdit(changed, true)).toBe(true);
    expect(session.confirmValidCustomRender(changed)).toBe(true);
    expect(session.stage).toBe("success");
    expect(sink).toHaveBeenCalledWith("guided_edit_completed", {
      experiment: GUIDED_FIRST_EDIT_EXPERIMENT,
    });

    const analyticsPayload = JSON.stringify(sink.mock.calls);
    expect(analyticsPayload).not.toContain("knee_right");
    expect(analyticsPayload).not.toContain("115");
    expect(analyticsPayload).not.toContain("posecode posture");
  });
});

describe("guided first-edit UI wiring", () => {
  const html = readFileSync(resolve(root, "playground/play.html"), "utf8");
  const main = readFileSync(resolve(root, "playground/src/main.ts"), "utf8");
  const editor = readFileSync(resolve(root, "playground/src/editor.ts"), "utf8");

  it("provides accessible edit, Share, and dismissal controls", () => {
    expect(html).toContain('id="guided-first-edit"');
    expect(html).toContain('aria-labelledby="guided-first-edit-title"');
    expect(html).toContain('id="guided-first-edit-message" aria-live="polite"');
    expect(html).toContain('id="guided-first-edit-share"');
    expect(html).toContain('aria-label="Dismiss quick edit"');
  });

  it("switches mobile before focusing the existing direct angle control", () => {
    const switchPanel = main.indexOf(
      'if (request.switchToEditor) setMobileView("editor")',
    );
    const focusControl = main.indexOf(
      "editorApi?.focusAngleControl(request.joint, request.action)",
      switchPanel,
    );
    expect(switchPanel).toBeGreaterThan(-1);
    expect(focusControl).toBeGreaterThan(switchPanel);
    expect(editor).toContain("focusAngleControl(joint: string, action: string)");
    expect(editor).toContain("setActiveAngle.of(target)");
    expect(editor).toContain("EditorView.scrollIntoView");
  });

  it("confirms success only in the existing valid custom render branch", () => {
    const load = main.indexOf("viewer.load(ir)");
    const valid = main.indexOf('errors.length === 0', load);
    const custom = main.indexOf('documentKind() === "custom"', valid);
    const completed = main.indexOf(
      "guidedFirstEditSession?.confirmValidCustomRender(source)",
      custom,
    );
    expect(load).toBeGreaterThan(-1);
    expect(valid).toBeGreaterThan(load);
    expect(custom).toBeGreaterThan(valid);
    expect(completed).toBeGreaterThan(custom);
  });
});

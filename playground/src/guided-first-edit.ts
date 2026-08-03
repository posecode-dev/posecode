import {
  trackUsageEvent,
  USAGE_EVENT_NAMES,
  type GuidedEditSurface,
} from "./analytics.js";
import { findAngleTargets } from "./direct-manipulation.js";

export const GUIDED_FIRST_EDIT_EXPERIMENT = "superhero_first_edit_v1";

export const GUIDED_FIRST_EDIT_TARGET = {
  joint: "knee_right",
  action: "flex",
  initialDegrees: 123,
  suggestedDegrees: 115,
} as const;

export type GuidedFirstEditStage =
  | "idle"
  | "edit"
  | "success"
  | "dismissed";

export interface GuidedEditFocusRequest {
  joint: string;
  action: string;
  switchToEditor: boolean;
}

function targetDegrees(source: string): number | null {
  const target = findAngleTargets(source).find(
    ({ joint, action }) =>
      joint === GUIDED_FIRST_EDIT_TARGET.joint &&
      action === GUIDED_FIRST_EDIT_TARGET.action,
  );
  return target?.degrees ?? null;
}

/** Keep the experiment on the single intended entry point and known source. */
export function shouldOfferGuidedFirstEdit(
  pathname: string,
  hash: string,
  source: string,
): boolean {
  return (
    pathname === "/play/superhero-landing" &&
    hash === "" &&
    targetDegrees(source) === GUIDED_FIRST_EDIT_TARGET.initialDegrees
  );
}

/**
 * Small state machine for the guided activation experiment. Source is inspected
 * only in the browser and is never included in analytics properties.
 */
export class GuidedFirstEditSession {
  stage: GuidedFirstEditStage = "idle";
  private targetWasEdited = false;
  private started = false;

  offer(): boolean {
    if (this.stage !== "idle") return false;
    this.stage = "edit";
    trackUsageEvent(USAGE_EVENT_NAMES.guidedEditShown, {
      experiment: GUIDED_FIRST_EDIT_EXPERIMENT,
    });
    return true;
  }

  begin(surface: GuidedEditSurface): GuidedEditFocusRequest | null {
    if (this.stage !== "edit") return null;
    if (!this.started) {
      this.started = true;
      trackUsageEvent(USAGE_EVENT_NAMES.guidedEditStarted, {
        experiment: GUIDED_FIRST_EDIT_EXPERIMENT,
        surface,
      });
    }
    return {
      joint: GUIDED_FIRST_EDIT_TARGET.joint,
      action: GUIDED_FIRST_EDIT_TARGET.action,
      switchToEditor: surface === "mobile",
    };
  }

  noteUserEdit(source: string, userInitiated: boolean): boolean {
    if (this.stage !== "edit" || !userInitiated) return false;
    const degrees = targetDegrees(source);
    this.targetWasEdited =
      degrees !== null && degrees !== GUIDED_FIRST_EDIT_TARGET.initialDegrees;
    return this.targetWasEdited;
  }

  /** Call only after the parser has accepted and the viewer has loaded source. */
  confirmValidCustomRender(source: string): boolean {
    if (this.stage !== "edit" || !this.targetWasEdited) return false;
    const degrees = targetDegrees(source);
    if (
      degrees === null ||
      degrees === GUIDED_FIRST_EDIT_TARGET.initialDegrees
    ) {
      return false;
    }
    this.stage = "success";
    trackUsageEvent(USAGE_EVENT_NAMES.guidedEditCompleted, {
      experiment: GUIDED_FIRST_EDIT_EXPERIMENT,
    });
    return true;
  }

  dismiss(): boolean {
    if (this.stage !== "edit" && this.stage !== "success") return false;
    const stage = this.stage;
    this.stage = "dismissed";
    trackUsageEvent(USAGE_EVENT_NAMES.guidedEditDismissed, {
      experiment: GUIDED_FIRST_EDIT_EXPERIMENT,
      stage,
    });
    return true;
  }
}

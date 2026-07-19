/** posecode-eval: public API. */

export { probeMovement } from "./probe.js";
export type {
  ContactKind,
  ContactResidual,
  ContactStatus,
  ProbeOptions,
  ProbeResult,
  PhasePose,
  Quat,
  Vec3,
} from "./probe.js";
export {
  DEFAULT_DIAGNOSTIC_SAMPLE_RATE_HZ,
  PLANTED_FOOT_DRIFT_MAX,
  TIPTOE_FOOT_DRIFT_MAX,
  createClipDiagnosticsCollector,
} from "./diagnostics.js";
export type {
  ClipDiagnostics,
  ClipDiagnosticsCollector,
  ClipDiagnosticWarning,
  ClipDiagnosticWarningKind,
  DiagnosticFrame,
  DiagnosticLocation,
  FootClipDiagnostics,
  SelfCollisionClipDiagnostics,
} from "./diagnostics.js";
export {
  angleBetweenDeg,
  balanceOverflow,
  bone,
  centerOfMass,
  distanceBetween,
  feetHeight,
  feetCenterSkateDistance,
  fistFloorAngleDeg,
  footIsSupported,
  footSkateDistance,
  footWorldSkateDistance,
  forwardCoordinate,
  headPropClearance,
  heightOf,
  jointAngleDeg,
  kneeFlexionDeg,
  lowestPoint,
  palmFloorAngleDeg,
  palmForwardAngleDeg,
  palmInwardAngleDeg,
  palmUpAngleDeg,
  phaseMaxLandmarkSpeed,
  segmentTiltDeg,
  soleUpAngleDeg,
  spineCurlDeg,
  torsoForwardPitchDeg,
  torsoPitchDeg,
} from "./metrics.js";
export { CONTACT_ERROR_MAX, genericChecks, phaseCheck, MOVEMENT_CHECKS } from "./checks.js";
export type { CheckOutcome, MovementChecks } from "./checks.js";
export { runEval, renderReport } from "./report.js";
export type { EvalOptions, EvalReport, MovementReport, MovementSource } from "./report.js";
export { loadFixtures } from "./generator.js";
export type { MovementGenerator } from "./generator.js";

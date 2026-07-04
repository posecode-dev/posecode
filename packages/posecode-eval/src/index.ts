/** posecode-eval — public API. */

export { probeMovement } from "./probe.js";
export type { ProbeResult, PhasePose, Vec3 } from "./probe.js";
export {
  angleBetweenDeg,
  bone,
  feetHeight,
  heightOf,
  jointAngleDeg,
  kneeFlexionDeg,
  lowestPoint,
  segmentTiltDeg,
  spineCurlDeg,
  torsoPitchDeg,
} from "./metrics.js";
export { genericChecks, phaseCheck, MOVEMENT_CHECKS } from "./checks.js";
export type { CheckOutcome, MovementChecks } from "./checks.js";
export { runEval, renderReport } from "./report.js";
export type { EvalReport, MovementReport, MovementSource } from "./report.js";
export { loadFixtures } from "./generator.js";
export type { MovementGenerator } from "./generator.js";

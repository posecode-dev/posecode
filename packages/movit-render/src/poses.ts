/**
 * A small registry of named base poses referenced by `pose start = <name>`.
 *
 * A base pose sets the figure's root transform and a starting set of joint
 * angles. Phase targets from the `.movit` document are layered on top of it.
 * Angles are in DEGREES, in the same local convention as movit-parser.
 */

export interface PoseSpec {
  root?: {
    position?: [number, number, number];
    rotationDeg?: [number, number, number];
  };
  joints?: Record<string, [number, number, number]>;
}

const NEUTRAL: PoseSpec = {
  root: { position: [0, 0, 0], rotationDeg: [0, 0, 0] },
  joints: {},
};

// Face-down support position: torso horizontal, arms reaching to the floor.
// Ground-lock IK plants hands and feet; this just gets the gross posture right.
const PLANK: PoseSpec = {
  // Face-down diagonal: rotating the standing figure by -72° about X tips it so
  // the head/shoulders stay HIGH and the legs point forward-and-down toward the
  // floor (a value past -90 would kick the feet up instead). Arms drop straight
  // down (shoulder flex 90); toes curl under (ankle). groundFigure() then drops
  // the whole body so the lowest contact rests on the floor.
  root: { position: [0, 0.6, 0], rotationDeg: [-72, 0, 0] },
  joints: {
    shoulder_left: [90, 0, 0],
    shoulder_right: [90, 0, 0],
    ankle_left: [25, 0, 0],
    ankle_right: [25, 0, 0],
  },
};

// Standing, ready position (alias of neutral for now).
const STANDING: PoseSpec = NEUTRAL;

const POSES: Record<string, PoseSpec> = {
  neutral: NEUTRAL,
  standing: STANDING,
  plank: PLANK,
};

export function poseFor(name: string | undefined): PoseSpec {
  if (!name) return NEUTRAL;
  return POSES[name] ?? NEUTRAL;
}

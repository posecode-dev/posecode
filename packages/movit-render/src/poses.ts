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

// Standing, ready position. A relaxed human doesn't stand with the arms pinned
// dead-vertical against the torso — they hang with a small "carrying angle" so
// the hands clear the hips/thighs. Give the arms ~11° of abduction (an A-pose)
// so they sit clear of the body instead of clipping into it. Left/right use
// opposite Z signs (frontal-plane abduction, per joints.ts). Any movement that
// explicitly poses the shoulders overrides this; leg/core movements that never
// touch the shoulders keep the natural gap.
const STANDING: PoseSpec = {
  root: { position: [0, 0, 0], rotationDeg: [0, 0, 0] },
  joints: {
    shoulder_left: [0, 0, 11],
    shoulder_right: [0, 0, -11],
  },
};

// Lying face-up. Rotating the standing figure -90° about X lays it on its back:
// the original front (+Z) ends up facing the ceiling (+Y) and the head points
// toward -Z. groundFigure() (bounding-box drop) then rests the back on the floor.
const SUPINE: PoseSpec = {
  root: { position: [0, 0.5, 0], rotationDeg: [-90, 0, 0] },
  joints: {},
};

// Lying face-down (+90° about X): the front faces the floor, head toward +Z.
const PRONE: PoseSpec = {
  root: { position: [0, 0.5, 0], rotationDeg: [90, 0, 0] },
  joints: {},
};

// Long-sit on the floor: torso upright, hips flexed 90° so the legs extend
// forward, knees straight. (Hip flexion resolves to -X in the rig, matching the
// parser's flexion sign.) groundFigure() drops the glutes/legs to the floor.
const SEATED: PoseSpec = {
  root: { position: [0, 0.5, 0], rotationDeg: [0, 0, 0] },
  joints: {
    hip_left: [-90, 0, 0],
    hip_right: [-90, 0, 0],
  },
};

const POSES: Record<string, PoseSpec> = {
  neutral: NEUTRAL,
  standing: STANDING,
  plank: PLANK,
  supine: SUPINE,
  prone: PRONE,
  seated: SEATED,
};

export function poseFor(name: string | undefined): PoseSpec {
  if (!name) return NEUTRAL;
  return POSES[name] ?? NEUTRAL;
}

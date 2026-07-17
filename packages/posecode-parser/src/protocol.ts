/** Closed vocabulary for document-level Posecode protocol declarations. */

export const MOVEMENT_KINDS = ["exercise", "stretch", "posture"] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

export const RIG_NAMES = ["humanoid"] as const;
export type RigName = (typeof RIG_NAMES)[number];

export const START_POSE_NAMES = [
  "neutral",
  "standing",
  "plank",
  "supine",
  "prone",
  "seated",
] as const;
export type StartPoseName = (typeof START_POSE_NAMES)[number];

export const PROP_TYPES = ["chair", "wall", "bar", "box", "dip-bars"] as const;
export type PropType = (typeof PROP_TYPES)[number];

/** World-anchor names supplied by each built-in prop. Sided grip aliases are included. */
export const PROP_ANCHORS: Readonly<Record<PropType, readonly string[]>> = {
  chair: ["seat"],
  wall: ["wall"],
  bar: ["bar", "bar_left", "bar_right"],
  box: ["box"],
  "dip-bars": ["bars", "bars_left", "bars_right"],
};

export function isMovementKind(value: string): value is MovementKind {
  return (MOVEMENT_KINDS as readonly string[]).includes(value);
}

export function isRigName(value: string): value is RigName {
  return (RIG_NAMES as readonly string[]).includes(value);
}

export function isStartPoseName(value: string): value is StartPoseName {
  return (START_POSE_NAMES as readonly string[]).includes(value);
}

export function isPropType(value: string): value is PropType {
  return (PROP_TYPES as readonly string[]).includes(value);
}

/** The prop type that owns an anchor, or null when the word is not a prop anchor. */
export function propForAnchor(anchor: string): PropType | null {
  for (const type of PROP_TYPES) {
    if (PROP_ANCHORS[type].includes(anchor)) return type;
  }
  return null;
}

/** All anchor names made available by the props declared in one document. */
export function anchorsForProps(props: readonly string[]): Set<string> {
  const anchors = new Set<string>();
  for (const value of props) {
    if (!isPropType(value)) continue;
    for (const anchor of PROP_ANCHORS[value]) anchors.add(anchor);
  }
  return anchors;
}

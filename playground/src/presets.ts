/** Bundled example documents, loaded as raw text from spec/examples. */
import squat from "../../spec/examples/squat.movit?raw";
import biceps from "../../spec/examples/biceps-curl.movit?raw";
import lateral from "../../spec/examples/lateral-raise.movit?raw";
import shoulder from "../../spec/examples/shoulder-stretch.movit?raw";
import fold from "../../spec/examples/forward-fold.movit?raw";
import rollDown from "../../spec/examples/roll-down.movit?raw";
import deadlift from "../../spec/examples/deadlift.movit?raw";
import neck from "../../spec/examples/neck-rotation.movit?raw";
import posture from "../../spec/examples/posture-reset.movit?raw";
import twist from "../../spec/examples/spinal-twist.movit?raw";
import chair from "../../spec/examples/chair-pose.movit?raw";
import sideBend from "../../spec/examples/side-bend.movit?raw";

export interface Preset {
  id: string;
  label: string;
  /** Use-case domain, surfaced in the gallery/dropdown to show breadth. */
  domain: string;
  source: string;
}

// Ordered so the first gallery row spans several domains at a glance. The first
// entry is also the playground default and the landing hero, so it leads with a
// strong, full-body movement (the squat).
export const PRESETS: Preset[] = [
  { id: "squat", label: "Body-weight squat", domain: "Fitness", source: squat },
  { id: "deadlift", label: "Deadlift", domain: "Fitness", source: deadlift },
  { id: "neck", label: "Neck rotation", domain: "Physiotherapy", source: neck },
  { id: "posture", label: "Desk posture reset", domain: "Desk & posture", source: posture },
  { id: "chair", label: "Chair pose", domain: "Yoga", source: chair },
  { id: "fold", label: "Standing forward fold", domain: "Mobility", source: fold },
  { id: "rolldown", label: "Standing roll-down", domain: "Mobility", source: rollDown },
  { id: "twist", label: "Standing spinal twist", domain: "Desk & posture", source: twist },
  { id: "sidebend", label: "Standing side bend", domain: "Yoga", source: sideBend },
  { id: "shoulder", label: "Shoulder flexion (ROM)", domain: "Physiotherapy", source: shoulder },
  { id: "biceps", label: "Biceps curl", domain: "Fitness", source: biceps },
  { id: "lateral", label: "Lateral raise", domain: "Fitness", source: lateral },
];

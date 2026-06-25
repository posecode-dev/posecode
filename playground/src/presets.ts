/** Bundled example documents, loaded as raw text from spec/examples. */
import squat from "../../spec/examples/squat.movit?raw";
import biceps from "../../spec/examples/biceps-curl.movit?raw";
import lateral from "../../spec/examples/lateral-raise.movit?raw";
import shoulder from "../../spec/examples/shoulder-stretch.movit?raw";
import fold from "../../spec/examples/forward-fold.movit?raw";
import neck from "../../spec/examples/neck-rotation.movit?raw";
import posture from "../../spec/examples/posture-reset.movit?raw";
import twist from "../../spec/examples/spinal-twist.movit?raw";
import chair from "../../spec/examples/chair-pose.movit?raw";
import sideBend from "../../spec/examples/side-bend.movit?raw";

// Hip-hinge showcases (the v0.1 engine unlock).
import deadlift from "../../spec/examples/deadlift.movit?raw";
import bentOverRow from "../../spec/examples/bent-over-row.movit?raw";

// Anatomy / education — single-joint range-of-motion demos.
import shoulderAbduction from "../../spec/examples/shoulder-abduction-demo.movit?raw";
import hipFlexion from "../../spec/examples/hip-flexion-demo.movit?raw";
import spineRotation from "../../spec/examples/spine-rotation-demo.movit?raw";
import elbowForearm from "../../spec/examples/elbow-flexion-pronation.movit?raw";
import kneeFlexion from "../../spec/examples/knee-flexion-demo.movit?raw";

// Physiotherapy / rehab.
import heelRaises from "../../spec/examples/heel-raises.movit?raw";
import hamstringCurl from "../../spec/examples/standing-hamstring-curl.movit?raw";
import hipAbduction from "../../spec/examples/hip-abduction.movit?raw";
import goodMorning from "../../spec/examples/good-morning.movit?raw";

// Desk / workplace wellness.
import shoulderRolls from "../../spec/examples/shoulder-rolls.movit?raw";
import neckSideStretch from "../../spec/examples/neck-side-stretch.movit?raw";
import chestOpener from "../../spec/examples/chest-opener.movit?raw";
import overheadReach from "../../spec/examples/overhead-reach-reset.movit?raw";

// Sports / martial arts / warm-up.
import frontKick from "../../spec/examples/front-kick.movit?raw";
import jabCross from "../../spec/examples/jab-cross.movit?raw";
import horseStance from "../../spec/examples/horse-stance.movit?raw";
import bow from "../../spec/examples/bow.movit?raw";
import armCircles from "../../spec/examples/arm-circles.movit?raw";
import highKneeMarch from "../../spec/examples/high-knee-march.movit?raw";

// Dance / choreography (flagship domain).
import demiPlie from "../../spec/examples/demi-plie.movit?raw";
import releve from "../../spec/examples/releve.movit?raw";
import tendu from "../../spec/examples/tendu.movit?raw";
import portDeBras from "../../spec/examples/port-de-bras.movit?raw";
import dancePhrase from "../../spec/examples/dance-phrase.movit?raw";

export interface Preset {
  id: string;
  label: string;
  /** Use-case domain, surfaced in the gallery/dropdown to show breadth. */
  domain: string;
  source: string;
}

// Ordered so the first gallery row spans several domains at a glance. The first
// entry is also the playground default and the landing hero, so it leads with a
// strong, full-body movement (the squat); the dance phrase follows as the
// flagship "communicate the movement in your head" demo.
export const PRESETS: Preset[] = [
  { id: "squat", label: "Body-weight squat", domain: "Fitness", source: squat },
  { id: "dance-phrase", label: "Dance phrase (8-count)", domain: "Dance", source: dancePhrase },
  { id: "deadlift", label: "Deadlift (hip hinge)", domain: "Fitness", source: deadlift },
  { id: "shoulder-abduction", label: "Shoulder abduction (ROM)", domain: "Education", source: shoulderAbduction },
  { id: "front-kick", label: "Front kick", domain: "Martial arts", source: frontKick },
  { id: "good-morning", label: "Good morning (hinge)", domain: "Physiotherapy", source: goodMorning },
  { id: "chest-opener", label: "Chest opener", domain: "Desk & posture", source: chestOpener },

  // --- Education / anatomy: single-joint ROM demos ---
  { id: "hip-flexion", label: "Hip flexion (ROM)", domain: "Education", source: hipFlexion },
  { id: "knee-flexion", label: "Knee flexion (ROM)", domain: "Education", source: kneeFlexion },
  { id: "spine-rotation", label: "Spine rotation (ROM)", domain: "Education", source: spineRotation },
  { id: "elbow-forearm", label: "Elbow flexion & forearm rotation", domain: "Education", source: elbowForearm },

  // --- Physiotherapy / rehab ---
  { id: "heel-raises", label: "Heel raises", domain: "Physiotherapy", source: heelRaises },
  { id: "hamstring-curl", label: "Standing hamstring curl", domain: "Physiotherapy", source: hamstringCurl },
  { id: "hip-abduction", label: "Standing hip abduction", domain: "Physiotherapy", source: hipAbduction },
  { id: "shoulder", label: "Shoulder flexion (ROM)", domain: "Physiotherapy", source: shoulder },
  { id: "neck", label: "Neck rotation", domain: "Physiotherapy", source: neck },

  // --- Desk / workplace wellness ---
  { id: "posture", label: "Desk posture reset", domain: "Desk & posture", source: posture },
  { id: "twist", label: "Standing spinal twist", domain: "Desk & posture", source: twist },
  { id: "shoulder-rolls", label: "Shoulder rolls", domain: "Desk & posture", source: shoulderRolls },
  { id: "neck-side-stretch", label: "Neck side stretch", domain: "Desk & posture", source: neckSideStretch },
  { id: "overhead-reach", label: "Overhead reach reset", domain: "Desk & posture", source: overheadReach },

  // --- Sports / martial arts / warm-up ---
  { id: "jab-cross", label: "Jab-cross", domain: "Martial arts", source: jabCross },
  { id: "horse-stance", label: "Horse stance", domain: "Martial arts", source: horseStance },
  { id: "bow", label: "Standing bow (hinge)", domain: "Martial arts", source: bow },
  { id: "arm-circles", label: "Arm circles", domain: "Warm-up", source: armCircles },
  { id: "high-knee-march", label: "High-knee march", domain: "Warm-up", source: highKneeMarch },

  // --- Dance / choreography (flagship) ---
  { id: "demi-plie", label: "Demi-plié", domain: "Dance", source: demiPlie },
  { id: "releve", label: "Relevé", domain: "Dance", source: releve },
  { id: "tendu", label: "Tendu", domain: "Dance", source: tendu },
  { id: "port-de-bras", label: "Port de bras", domain: "Dance", source: portDeBras },

  // --- More fitness / mobility / yoga ---
  { id: "bent-over-row", label: "Bent-over row (hinge)", domain: "Fitness", source: bentOverRow },
  { id: "biceps", label: "Biceps curl", domain: "Fitness", source: biceps },
  { id: "lateral", label: "Lateral raise", domain: "Fitness", source: lateral },
  { id: "fold", label: "Standing roll-down", domain: "Mobility", source: fold },
  { id: "chair", label: "Chair pose", domain: "Yoga", source: chair },
  { id: "sidebend", label: "Standing side bend", domain: "Yoga", source: sideBend },
];

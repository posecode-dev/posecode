/** Bundled example documents, loaded as raw text from spec/examples. */
import squat from "../../spec/examples/squat.posecode?raw";
import biceps from "../../spec/examples/biceps-curl.posecode?raw";
import lateral from "../../spec/examples/lateral-raise.posecode?raw";
import shoulder from "../../spec/examples/shoulder-stretch.posecode?raw";
import fold from "../../spec/examples/forward-fold.posecode?raw";
import neck from "../../spec/examples/neck-rotation.posecode?raw";
import posture from "../../spec/examples/posture-reset.posecode?raw";
import twist from "../../spec/examples/spinal-twist.posecode?raw";
import chair from "../../spec/examples/chair-pose.posecode?raw";
import sideBend from "../../spec/examples/side-bend.posecode?raw";

// Hip-hinge showcases.
import deadlift from "../../spec/examples/deadlift.posecode?raw";
import bentOverRow from "../../spec/examples/bent-over-row.posecode?raw";

// Anatomy / education — single-joint range-of-motion demos.
import shoulderAbduction from "../../spec/examples/shoulder-abduction-demo.posecode?raw";
import hipFlexion from "../../spec/examples/hip-flexion-demo.posecode?raw";
import spineRotation from "../../spec/examples/spine-rotation-demo.posecode?raw";
import elbowForearm from "../../spec/examples/elbow-flexion-pronation.posecode?raw";
import kneeFlexion from "../../spec/examples/knee-flexion-demo.posecode?raw";

// Physiotherapy / rehab.
import heelRaises from "../../spec/examples/heel-raises.posecode?raw";
import hamstringCurl from "../../spec/examples/standing-hamstring-curl.posecode?raw";
import hipAbduction from "../../spec/examples/hip-abduction.posecode?raw";
import goodMorning from "../../spec/examples/good-morning.posecode?raw";

// Desk / workplace wellness.
import shoulderRolls from "../../spec/examples/shoulder-rolls.posecode?raw";
import neckSideStretch from "../../spec/examples/neck-side-stretch.posecode?raw";
import chestOpener from "../../spec/examples/chest-opener.posecode?raw";
import overheadReach from "../../spec/examples/overhead-reach-reset.posecode?raw";

// Sports / martial arts / warm-up.
import frontKick from "../../spec/examples/front-kick.posecode?raw";
import jabCross from "../../spec/examples/jab-cross.posecode?raw";
import horseStance from "../../spec/examples/horse-stance.posecode?raw";
import bow from "../../spec/examples/bow.posecode?raw";
import armCircles from "../../spec/examples/arm-circles.posecode?raw";
import highKneeMarch from "../../spec/examples/high-knee-march.posecode?raw";

// Dance / choreography.
import demiPlie from "../../spec/examples/demi-plie.posecode?raw";
import releve from "../../spec/examples/releve.posecode?raw";
import tendu from "../../spec/examples/tendu.posecode?raw";
import portDeBras from "../../spec/examples/port-de-bras.posecode?raw";
import dancePhrase from "../../spec/examples/dance-phrase.posecode?raw";

// Reach-to-target IK.
import touchToes from "../../spec/examples/touch-toes.posecode?raw";
import crossBodyReach from "../../spec/examples/cross-body-reach.posecode?raw";

// Lying & seated base poses.
import gluteBridge from "../../spec/examples/glute-bridge.posecode?raw";
import deadBug from "../../spec/examples/dead-bug.posecode?raw";
import cobra from "../../spec/examples/cobra.posecode?raw";
import seatedForwardFold from "../../spec/examples/seated-forward-fold.posecode?raw";

// Scene props + contact anchors.
import sitToStand from "../../spec/examples/chair-sit-to-stand.posecode?raw";
import boxSquat from "../../spec/examples/box-squat.posecode?raw";
import wallSit from "../../spec/examples/wall-sit.posecode?raw";
import deadHang from "../../spec/examples/dead-hang.posecode?raw";
import hangingKneeRaise from "../../spec/examples/hanging-knee-raise.posecode?raw";

// Hand / finger rig.
import makeAFist from "../../spec/examples/make-a-fist.posecode?raw";
import fingerSpell from "../../spec/examples/finger-spell-demo.posecode?raw";
import handWave from "../../spec/examples/hand-wave.posecode?raw";
import pinchGrip from "../../spec/examples/pinch-grip.posecode?raw";

// Strength & core (coverage-gap batch — see docs/coverage-gap.md).
import plankHold from "../../spec/examples/plank-hold.posecode?raw";
import mountainClimber from "../../spec/examples/mountain-climber.posecode?raw";
import crunch from "../../spec/examples/crunch.posecode?raw";
import bicycleCrunch from "../../spec/examples/bicycle-crunch.posecode?raw";
import supineLegRaise from "../../spec/examples/supine-leg-raise.posecode?raw";
import superman from "../../spec/examples/superman.posecode?raw";
import forwardLunge from "../../spec/examples/forward-lunge.posecode?raw";
import calfRaise from "../../spec/examples/single-leg-calf-raise.posecode?raw";
import jumpingJacks from "../../spec/examples/jumping-jacks.posecode?raw";
import quadStretch from "../../spec/examples/standing-quad-stretch.posecode?raw";
import boxStepTaps from "../../spec/examples/box-step-taps.posecode?raw";

// Contact-pin movements (the body moves relative to a pinned hand/foot).
import pullUp from "../../spec/examples/pull-up.posecode?raw";
import stepUp from "../../spec/examples/step-up.posecode?raw";
import tricepsDips from "../../spec/examples/triceps-dips.posecode?raw";

// Spatial choreography (turn & travel) — the figure turns and moves across the floor.
import pirouette from "../../spec/examples/pirouette.posecode?raw";
import boxStep from "../../spec/examples/box-step.posecode?raw";
import grapevine from "../../spec/examples/grapevine.posecode?raw";
import waltzBox from "../../spec/examples/waltz-box.posecode?raw";
import chasse from "../../spec/examples/chasse.posecode?raw";
import walkCycle from "../../spec/examples/walk-cycle.posecode?raw";
import quarterTurns from "../../spec/examples/quarter-turns.posecode?raw";

export type Difficulty = "Beginner" | "Intermediate" | "Advanced";

export interface Preset {
  id: string;
  label: string;
  /** Use-case domain (Fitness, Dance, Physiotherapy, …) — the primary grouping. */
  domain: string;
  /** Standard fitness taxonomy, so the gallery can filter like an exercise DB. */
  bodyPart: string;
  /** Primary target muscle, human-readable. */
  target: string;
  /** What it renders with: Body weight, Chair, Wall, or Bar. */
  equipment: string;
  difficulty: Difficulty;
  source: string;
}

// Ordered so the first gallery row spans several domains at a glance. The first
// entry is the playground default and landing hero (the squat); the dance phrase
// follows as the flagship "communicate the movement in your head" demo.
export const PRESETS: Preset[] = [
  { id: "squat", label: "Body-weight squat", domain: "Fitness", bodyPart: "Upper legs", target: "Quadriceps", equipment: "Body weight", difficulty: "Beginner", source: squat },
  { id: "dance-phrase", label: "Dance phrase (8-count)", domain: "Dance", bodyPart: "Full body", target: "Full body", equipment: "Body weight", difficulty: "Intermediate", source: dancePhrase },
  { id: "deadlift", label: "Deadlift (hip hinge)", domain: "Fitness", bodyPart: "Back", target: "Hamstrings & glutes", equipment: "Body weight", difficulty: "Intermediate", source: deadlift },
  { id: "shoulder-abduction", label: "Shoulder abduction (ROM)", domain: "Education", bodyPart: "Shoulders", target: "Deltoids", equipment: "Body weight", difficulty: "Beginner", source: shoulderAbduction },
  { id: "front-kick", label: "Front kick", domain: "Martial arts", bodyPart: "Upper legs", target: "Hip flexors", equipment: "Body weight", difficulty: "Intermediate", source: frontKick },
  { id: "good-morning", label: "Good morning (hinge)", domain: "Physiotherapy", bodyPart: "Back", target: "Hamstrings", equipment: "Body weight", difficulty: "Intermediate", source: goodMorning },
  { id: "chest-opener", label: "Chest opener", domain: "Desk & posture", bodyPart: "Chest", target: "Pectorals", equipment: "Body weight", difficulty: "Beginner", source: chestOpener },

  // --- Strength & core (coverage-gap batch) ---
  { id: "plank-hold", label: "Plank hold", domain: "Fitness", bodyPart: "Core", target: "Abdominals", equipment: "Body weight", difficulty: "Beginner", source: plankHold },
  { id: "mountain-climber", label: "Mountain climber", domain: "Fitness", bodyPart: "Core", target: "Abdominals", equipment: "Body weight", difficulty: "Intermediate", source: mountainClimber },
  { id: "crunch", label: "Crunch", domain: "Fitness", bodyPart: "Core", target: "Abdominals", equipment: "Body weight", difficulty: "Beginner", source: crunch },
  { id: "bicycle-crunch", label: "Bicycle crunch", domain: "Fitness", bodyPart: "Core", target: "Obliques", equipment: "Body weight", difficulty: "Intermediate", source: bicycleCrunch },
  { id: "supine-leg-raise", label: "Lying leg raise", domain: "Fitness", bodyPart: "Core", target: "Abdominals", equipment: "Body weight", difficulty: "Beginner", source: supineLegRaise },
  { id: "superman", label: "Superman", domain: "Fitness", bodyPart: "Back", target: "Spinal erectors", equipment: "Body weight", difficulty: "Beginner", source: superman },
  { id: "forward-lunge", label: "Forward lunge", domain: "Fitness", bodyPart: "Upper legs", target: "Quadriceps", equipment: "Body weight", difficulty: "Intermediate", source: forwardLunge },
  { id: "calf-raise", label: "Single-leg calf raise", domain: "Fitness", bodyPart: "Lower legs", target: "Calves", equipment: "Body weight", difficulty: "Intermediate", source: calfRaise },
  { id: "jumping-jacks", label: "Jumping jacks", domain: "Warm-up", bodyPart: "Full body", target: "Full body", equipment: "Body weight", difficulty: "Beginner", source: jumpingJacks },
  { id: "box-step-taps", label: "Box step taps", domain: "Warm-up", bodyPart: "Upper legs", target: "Hip flexors", equipment: "Box", difficulty: "Beginner", source: boxStepTaps },
  { id: "pull-up", label: "Pull-up", domain: "Fitness", bodyPart: "Back", target: "Lats", equipment: "Bar", difficulty: "Advanced", source: pullUp },
  { id: "step-up", label: "Step-up (box)", domain: "Functional", bodyPart: "Upper legs", target: "Quadriceps", equipment: "Box", difficulty: "Intermediate", source: stepUp },
  { id: "triceps-dips", label: "Triceps dips (chair)", domain: "Fitness", bodyPart: "Upper arms", target: "Triceps", equipment: "Chair", difficulty: "Intermediate", source: tricepsDips },
  { id: "quad-stretch", label: "Standing quad stretch", domain: "Mobility", bodyPart: "Upper legs", target: "Quadriceps", equipment: "Body weight", difficulty: "Beginner", source: quadStretch },

  // --- Education / anatomy: single-joint ROM demos ---
  { id: "hip-flexion", label: "Hip flexion (ROM)", domain: "Education", bodyPart: "Upper legs", target: "Hip flexors", equipment: "Body weight", difficulty: "Beginner", source: hipFlexion },
  { id: "knee-flexion", label: "Knee flexion (ROM)", domain: "Education", bodyPart: "Upper legs", target: "Hamstrings", equipment: "Body weight", difficulty: "Beginner", source: kneeFlexion },
  { id: "spine-rotation", label: "Spine rotation (ROM)", domain: "Education", bodyPart: "Core", target: "Obliques", equipment: "Body weight", difficulty: "Beginner", source: spineRotation },
  { id: "elbow-forearm", label: "Elbow flexion & forearm rotation", domain: "Education", bodyPart: "Upper arms", target: "Biceps", equipment: "Body weight", difficulty: "Beginner", source: elbowForearm },

  // --- Physiotherapy / rehab ---
  { id: "heel-raises", label: "Heel raises", domain: "Physiotherapy", bodyPart: "Lower legs", target: "Calves", equipment: "Body weight", difficulty: "Beginner", source: heelRaises },
  { id: "hamstring-curl", label: "Standing hamstring curl", domain: "Physiotherapy", bodyPart: "Upper legs", target: "Hamstrings", equipment: "Body weight", difficulty: "Beginner", source: hamstringCurl },
  { id: "hip-abduction", label: "Standing hip abduction", domain: "Physiotherapy", bodyPart: "Upper legs", target: "Glutes", equipment: "Body weight", difficulty: "Beginner", source: hipAbduction },
  { id: "shoulder", label: "Shoulder flexion (ROM)", domain: "Physiotherapy", bodyPart: "Shoulders", target: "Deltoids", equipment: "Body weight", difficulty: "Beginner", source: shoulder },
  { id: "neck", label: "Neck rotation", domain: "Physiotherapy", bodyPart: "Neck", target: "Neck", equipment: "Body weight", difficulty: "Beginner", source: neck },

  // --- Desk / workplace wellness ---
  { id: "posture", label: "Desk posture reset", domain: "Desk & posture", bodyPart: "Back", target: "Spinal erectors", equipment: "Body weight", difficulty: "Beginner", source: posture },
  { id: "twist", label: "Standing spinal twist", domain: "Desk & posture", bodyPart: "Core", target: "Obliques", equipment: "Body weight", difficulty: "Beginner", source: twist },
  { id: "shoulder-rolls", label: "Shoulder rolls", domain: "Desk & posture", bodyPart: "Shoulders", target: "Trapezius", equipment: "Body weight", difficulty: "Beginner", source: shoulderRolls },
  { id: "neck-side-stretch", label: "Neck side stretch", domain: "Desk & posture", bodyPart: "Neck", target: "Neck", equipment: "Body weight", difficulty: "Beginner", source: neckSideStretch },
  { id: "overhead-reach", label: "Overhead reach reset", domain: "Desk & posture", bodyPart: "Shoulders", target: "Deltoids", equipment: "Body weight", difficulty: "Beginner", source: overheadReach },

  // --- Sports / martial arts / warm-up ---
  { id: "jab-cross", label: "Jab-cross", domain: "Martial arts", bodyPart: "Full body", target: "Shoulders", equipment: "Body weight", difficulty: "Intermediate", source: jabCross },
  { id: "horse-stance", label: "Horse stance", domain: "Martial arts", bodyPart: "Upper legs", target: "Quadriceps", equipment: "Body weight", difficulty: "Intermediate", source: horseStance },
  { id: "bow", label: "Standing bow (hinge)", domain: "Martial arts", bodyPart: "Back", target: "Hamstrings", equipment: "Body weight", difficulty: "Beginner", source: bow },
  { id: "arm-circles", label: "Arm circles", domain: "Warm-up", bodyPart: "Shoulders", target: "Deltoids", equipment: "Body weight", difficulty: "Beginner", source: armCircles },
  { id: "high-knee-march", label: "High-knee march", domain: "Warm-up", bodyPart: "Full body", target: "Hip flexors", equipment: "Body weight", difficulty: "Beginner", source: highKneeMarch },

  // --- Dance / choreography (flagship) ---
  { id: "demi-plie", label: "Demi-plié", domain: "Dance", bodyPart: "Upper legs", target: "Quadriceps", equipment: "Body weight", difficulty: "Beginner", source: demiPlie },
  { id: "releve", label: "Relevé", domain: "Dance", bodyPart: "Lower legs", target: "Calves", equipment: "Body weight", difficulty: "Beginner", source: releve },
  { id: "tendu", label: "Tendu", domain: "Dance", bodyPart: "Upper legs", target: "Hip flexors", equipment: "Body weight", difficulty: "Intermediate", source: tendu },
  { id: "port-de-bras", label: "Port de bras", domain: "Dance", bodyPart: "Shoulders", target: "Deltoids", equipment: "Body weight", difficulty: "Beginner", source: portDeBras },

  // --- More fitness / mobility / yoga ---
  { id: "bent-over-row", label: "Bent-over row (hinge)", domain: "Fitness", bodyPart: "Back", target: "Lats", equipment: "Body weight", difficulty: "Intermediate", source: bentOverRow },
  { id: "biceps", label: "Biceps curl", domain: "Fitness", bodyPart: "Upper arms", target: "Biceps", equipment: "Body weight", difficulty: "Beginner", source: biceps },
  { id: "lateral", label: "Lateral raise", domain: "Fitness", bodyPart: "Shoulders", target: "Deltoids", equipment: "Body weight", difficulty: "Beginner", source: lateral },
  { id: "fold", label: "Standing roll-down", domain: "Mobility", bodyPart: "Back", target: "Spinal erectors", equipment: "Body weight", difficulty: "Beginner", source: fold },
  { id: "chair", label: "Chair pose", domain: "Yoga", bodyPart: "Upper legs", target: "Quadriceps", equipment: "Body weight", difficulty: "Intermediate", source: chair },
  { id: "sidebend", label: "Standing side bend", domain: "Yoga", bodyPart: "Core", target: "Obliques", equipment: "Body weight", difficulty: "Beginner", source: sideBend },

  // --- Reach-to-target IK ---
  { id: "touch-toes", label: "Touch your toes", domain: "Mobility", bodyPart: "Back", target: "Hamstrings", equipment: "Body weight", difficulty: "Beginner", source: touchToes },
  { id: "cross-body-reach", label: "Cross-body reach", domain: "Physiotherapy", bodyPart: "Core", target: "Obliques", equipment: "Body weight", difficulty: "Beginner", source: crossBodyReach },

  // --- Lying & seated poses ---
  { id: "glute-bridge", label: "Glute bridge", domain: "Physiotherapy", bodyPart: "Upper legs", target: "Glutes", equipment: "Body weight", difficulty: "Beginner", source: gluteBridge },
  { id: "dead-bug", label: "Dead bug", domain: "Physiotherapy", bodyPart: "Core", target: "Abdominals", equipment: "Body weight", difficulty: "Beginner", source: deadBug },
  { id: "cobra", label: "Cobra", domain: "Yoga", bodyPart: "Back", target: "Spinal erectors", equipment: "Body weight", difficulty: "Beginner", source: cobra },
  { id: "seated-forward-fold", label: "Seated forward fold", domain: "Yoga", bodyPart: "Back", target: "Hamstrings", equipment: "Body weight", difficulty: "Beginner", source: seatedForwardFold },

  // --- Props: chair / wall / bar ---
  { id: "sit-to-stand", label: "Sit to stand (chair)", domain: "Functional", bodyPart: "Upper legs", target: "Quadriceps", equipment: "Chair", difficulty: "Beginner", source: sitToStand },
  { id: "box-squat", label: "Box squat (chair)", domain: "Fitness", bodyPart: "Upper legs", target: "Quadriceps", equipment: "Chair", difficulty: "Beginner", source: boxSquat },
  { id: "wall-sit", label: "Wall sit (wall)", domain: "Fitness", bodyPart: "Upper legs", target: "Quadriceps", equipment: "Wall", difficulty: "Beginner", source: wallSit },
  { id: "dead-hang", label: "Dead hang (bar)", domain: "Fitness", bodyPart: "Back", target: "Lats", equipment: "Bar", difficulty: "Beginner", source: deadHang },
  { id: "hanging-knee-raise", label: "Hanging knee raise (bar)", domain: "Fitness", bodyPart: "Core", target: "Abdominals", equipment: "Bar", difficulty: "Intermediate", source: hangingKneeRaise },

  // --- Hand / finger rig ---
  { id: "make-a-fist", label: "Make a fist", domain: "Hand therapy", bodyPart: "Hands", target: "Forearms", equipment: "Body weight", difficulty: "Beginner", source: makeAFist },
  { id: "pinch-grip", label: "Pinch grip", domain: "Hand therapy", bodyPart: "Hands", target: "Forearms", equipment: "Body weight", difficulty: "Beginner", source: pinchGrip },
  { id: "finger-spell", label: "Finger-spelling (approx.)", domain: "Sign language", bodyPart: "Hands", target: "Forearms", equipment: "Body weight", difficulty: "Beginner", source: fingerSpell },
  { id: "hand-wave", label: "Hand wave", domain: "Sign language", bodyPart: "Hands", target: "Forearms", equipment: "Body weight", difficulty: "Beginner", source: handWave },
  { id: "pirouette", label: "Pirouette (full turn)", domain: "Dance", bodyPart: "Full body", target: "Full body", equipment: "Body weight", difficulty: "Intermediate", source: pirouette },
  { id: "box-step", label: "Box step (travels)", domain: "Dance", bodyPart: "Full body", target: "Full body", equipment: "Body weight", difficulty: "Beginner", source: boxStep },
  { id: "grapevine", label: "Grapevine (travels)", domain: "Dance", bodyPart: "Full body", target: "Full body", equipment: "Body weight", difficulty: "Beginner", source: grapevine },
  { id: "waltz-box", label: "Waltz box step", domain: "Dance", bodyPart: "Full body", target: "Full body", equipment: "Body weight", difficulty: "Beginner", source: waltzBox },
  { id: "chasse", label: "Chassé (travels)", domain: "Dance", bodyPart: "Full body", target: "Full body", equipment: "Body weight", difficulty: "Intermediate", source: chasse },
  { id: "walk-cycle", label: "Walk & turn", domain: "Locomotion", bodyPart: "Full body", target: "Full body", equipment: "Body weight", difficulty: "Beginner", source: walkCycle },
  { id: "quarter-turns", label: "Quarter turns", domain: "Locomotion", bodyPart: "Full body", target: "Full body", equipment: "Body weight", difficulty: "Beginner", source: quarterTurns },
];

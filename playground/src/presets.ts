/** Bundled example documents, loaded as raw text from spec/examples. */
import squat from "../../spec/examples/squat.movit?raw";
import biceps from "../../spec/examples/biceps-curl.movit?raw";
import lateral from "../../spec/examples/lateral-raise.movit?raw";
import shoulder from "../../spec/examples/shoulder-stretch.movit?raw";
import fold from "../../spec/examples/forward-fold.movit?raw";

export interface Preset {
  id: string;
  label: string;
  source: string;
}

export const PRESETS: Preset[] = [
  { id: "squat", label: "Body-weight squat", source: squat },
  { id: "biceps", label: "Biceps curl", source: biceps },
  { id: "lateral", label: "Lateral raise", source: lateral },
  { id: "shoulder", label: "Overhead reach", source: shoulder },
  { id: "fold", label: "Standing roll-down", source: fold },
];

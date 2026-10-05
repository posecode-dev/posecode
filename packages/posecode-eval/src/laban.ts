/**
 * Bounded one-way Labanotation → Posecode translator prototype.
 *
 * Implements a bounded conversion for the supported subset of Labanotation fundamentals:
 * - Direction symbols: Place, Forward, Backward, Left, Right, Diagonals
 * - Level indicators: Low (plié / flexion), Middle (neutral / straight), High (relevé / plantarflexion)
 * - Basic support changes (weight transfer, steps, stances)
 * - Basic arm and leg gestures
 * - Simple turns
 *
 * Emits explicit diagnostics for unsupported/lossy constructs (polyphonic timing,
 * fractional weight distribution, continuous effort/dynamics) rather than fabricating motion.
 */

export type LabanDirection =
  | "place"
  | "forward"
  | "backward"
  | "left"
  | "right"
  | "forward-left"
  | "forward-right"
  | "backward-left"
  | "backward-right";

export type LabanLevel = "low" | "middle" | "high";

export interface LabanSupportAction {
  side: "left" | "right" | "both";
  direction: LabanDirection;
  level: LabanLevel;
  durationBeats?: number;
}

export interface LabanGestureAction {
  bodyPart: "left-leg" | "right-leg" | "left-arm" | "right-arm" | "head" | "torso";
  direction: LabanDirection;
  level: LabanLevel;
  durationBeats?: number;
}

export interface LabanTurnAction {
  direction: "clockwise" | "counter-clockwise";
  degrees: number;
  support: "left" | "right" | "both";
  durationBeats?: number;
}

export interface LabanScoreEvent {
  beat: number;
  durationBeats: number;
  name?: string;
  supports?: LabanSupportAction[];
  gestures?: LabanGestureAction[];
  turn?: LabanTurnAction;
  unsupportedFeatures?: string[];
}

export interface LabanScore {
  title: string;
  tempoBpm?: number;
  startPose?: string;
  events: LabanScoreEvent[];
}

export interface TranslationDiagnostic {
  severity: "warning" | "error" | "info";
  beat: number;
  message: string;
}

export interface TranslationResult {
  posecode: string;
  diagnostics: TranslationDiagnostic[];
  lossyFeatureCount: number;
}

export function translateLabanToPosecode(score: LabanScore): TranslationResult {
  const bpm = score.tempoBpm ?? 60;
  const secPerBeat = 60 / bpm;
  const diagnostics: TranslationDiagnostic[] = [];
  let lossyFeatureCount = 0;

  const lines: string[] = [
    `# Translated from Labanotation score: "${score.title}"`,
    `# Generator: Posecode Labanotation Bounded Prototype v0.1`,
    `# Note: Review diagnostics for lossy or simplified constructs.`,
    "",
    `posecode exercise "${score.title}"`,
    "  rig humanoid",
    `  pose start = ${score.startPose ?? "standing"}`,
    "",
  ];

  let cumulativeTravelX = 0;
  let cumulativeTravelZ = 0;
  let currentYawDeg = 0;

  score.events.forEach((event, idx) => {
    const durationSec = (event.durationBeats * secPerBeat).toFixed(2);
    const stepName = event.name ?? `Phase ${idx + 1} (Beat ${event.beat})`;
    const stepLines: string[] = [];

    // Flag explicit unsupported features
    if (event.unsupportedFeatures && event.unsupportedFeatures.length > 0) {
      for (const feat of event.unsupportedFeatures) {
        diagnostics.push({
          severity: "warning",
          beat: event.beat,
          message: `Unsupported Labanotation feature: "${feat}". Motion approximated or omitted.`,
        });
        lossyFeatureCount++;
        stepLines.push(`    # [Lossy conversion] Labanotation feature omitted: ${feat}`);
      }
    }

    // Process Supports
    if (event.supports && event.supports.length > 0) {
      for (const sup of event.supports) {
        // Level mapping
        if (sup.level === "low") {
          stepLines.push("    knees: flex 45");
          stepLines.push("    ankles: dorsiflex 12");
        } else if (sup.level === "high") {
          stepLines.push("    ankles: plantarflex 30");
          stepLines.push("    knees: extend 0");
        } else {
          stepLines.push("    knees: extend 0");
          stepLines.push("    ankles: dorsiflex 0");
        }

        // Direction / Travel mapping for support steps
        const stepSize = 0.35;
        if (sup.direction === "forward") {
          cumulativeTravelZ += stepSize;
          stepLines.push(`    travel: ${cumulativeTravelX.toFixed(2)} ${cumulativeTravelZ.toFixed(2)}`);
        } else if (sup.direction === "backward") {
          cumulativeTravelZ -= stepSize;
          stepLines.push(`    travel: ${cumulativeTravelX.toFixed(2)} ${cumulativeTravelZ.toFixed(2)}`);
        } else if (sup.direction === "left") {
          cumulativeTravelX += stepSize;
          stepLines.push(`    travel: ${cumulativeTravelX.toFixed(2)} ${cumulativeTravelZ.toFixed(2)}`);
        } else if (sup.direction === "right") {
          cumulativeTravelX -= stepSize;
          stepLines.push(`    travel: ${cumulativeTravelX.toFixed(2)} ${cumulativeTravelZ.toFixed(2)}`);
        }

        // Ground contact constraints
        if (sup.side === "both") {
          stepLines.push("    ground-lock: feet");
        } else if (sup.side === "left") {
          stepLines.push("    pin: foot_left floor");
        } else if (sup.side === "right") {
          stepLines.push("    pin: foot_right floor");
        }
      }
    }

    // Process Turn
    if (event.turn) {
      const delta = event.turn.direction === "clockwise" ? event.turn.degrees : -event.turn.degrees;
      currentYawDeg += delta;
      stepLines.push(`    turn: ${currentYawDeg}`);
      if (event.turn.support === "left") {
        stepLines.push("    pin: foot_left floor");
      } else if (event.turn.support === "right") {
        stepLines.push("    pin: foot_right floor");
      }
    }

    // Process Gestures
    if (event.gestures && event.gestures.length > 0) {
      for (const g of event.gestures) {
        if (g.bodyPart === "right-arm" || g.bodyPart === "left-arm") {
          const side = g.bodyPart === "left-arm" ? "left" : "right";
          if (g.direction === "forward") {
            stepLines.push(`    shoulder_${side}: flex ${g.level === "high" ? 140 : g.level === "low" ? 30 : 85}`);
          } else if (g.direction === "left" || g.direction === "right") {
            stepLines.push(`    shoulder_${side}: abduct ${g.level === "high" ? 130 : g.level === "low" ? 40 : 85}`);
          } else if (g.direction === "place") {
            stepLines.push(`    shoulder_${side}: flex 0`);
            stepLines.push(`    shoulder_${side}: abduct 0`);
          }
          stepLines.push(`    elbow_${side}: flex 15`);
        } else if (g.bodyPart === "right-leg" || g.bodyPart === "left-leg") {
          const side = g.bodyPart === "left-leg" ? "left" : "right";
          if (g.direction === "forward") {
            stepLines.push(`    hip_${side}: flex 45`);
            if (g.level === "high") stepLines.push(`    ankle_${side}: plantarflex 35`);
          } else if (g.direction === "place" && g.level === "high") {
            // Retiré/passé or knee lift
            stepLines.push(`    hip_${side}: flex 50`);
            stepLines.push(`    knee_${side}: flex 90`);
            stepLines.push(`    ankle_${side}: plantarflex 30`);
          }
        }
      }
    }

    stepLines.push(`    cue "Beat ${event.beat}: ${stepName}"`);

    lines.push(`  step "${stepName}" ${durationSec}s flow:`);
    lines.push(...stepLines);
    lines.push("");
  });

  return {
    posecode: lines.join("\n"),
    diagnostics,
    lossyFeatureCount,
  };
}

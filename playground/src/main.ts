/**
 * Movit playground wiring: editor → parser → 3D viewer, plus the how-to
 * slide-over and playback UX (phase ribbon, scrubber markers, rep counter).
 *
 * The text in the editor is the single source of truth. On every (debounced)
 * change we re-parse; clean docs reload the viewer, errors/warnings surface in
 * the side panel. This mirrors how an LLM-authored doc would be pasted in.
 */

import { parse } from "movit-parser";
import { createViewer } from "movit-render";
import { buildShareHash, readShareHash } from "movit-share";
import { createMovitEditor, type MovitEditor } from "./editor.js";
import { PRESETS } from "./presets.js";
import { renderWarnings } from "./warnings.js";
import llmPrompt from "../../spec/llm-authoring.md?raw";

const $ = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

let editorApi: MovitEditor; // assigned at boot, once the initial doc is known
const warnings = $<HTMLDivElement>("warnings");
const presetSel = $<HTMLSelectElement>("preset");
const canvas = $<HTMLCanvasElement>("canvas");
const playpause = $<HTMLButtonElement>("playpause");
const scrub = $<HTMLInputElement>("scrub");
const markers = $<HTMLDivElement>("markers");
const ribbon = $<HTMLDivElement>("ribbon");
const reps = $<HTMLDivElement>("reps");
const clock = $<HTMLSpanElement>("clock");
const loop = $<HTMLInputElement>("loop");
const speed = $<HTMLSelectElement>("speed");
const phaseEl = $<HTMLDivElement>("phase");
const cueEl = $<HTMLDivElement>("cue");
const copyBtn = $<HTMLButtonElement>("copy-prompt");
const shareBtn = $<HTMLButtonElement>("share");
const tabEditor = $<HTMLButtonElement>("tab-editor");
const tabViewer = $<HTMLButtonElement>("tab-viewer");

const viewer = createViewer(canvas);
let scrubbing = false;
let repeat = 1;
let rep = 1;
// Maps each phase name → the 1-based line range of its `step` block, so the
// editor can highlight the lines driving the currently-animating phase.
let phaseRanges = new Map<string, { from: number; to: number }>();

const playLbl = playpause.querySelector<HTMLSpanElement>(".lbl");

/** Reflect playback state on the icon-driven play button. */
function setPlaying(isPlaying: boolean): void {
  playpause.dataset.playing = String(isPlaying);
  if (playLbl) playLbl.textContent = isPlaying ? "Pause" : "Play";
}

/** Paint the custom scrubber fill (0–1000 range → percentage CSS var). */
function paintScrub(): void {
  scrub.style.setProperty("--pct", `${Number(scrub.value) / 10}%`);
}

viewer.onPhase(({ phaseName, cue }) => {
  phaseEl.textContent = phaseName === "reset" ? "" : phaseName;
  cueEl.textContent = cue ?? "";
  highlightChip(phaseName);
  // Light up the step block driving this phase (cleared between loops / on reset).
  const range = phaseName === "reset" ? undefined : phaseRanges.get(phaseName);
  editorApi?.highlightPhase(range ? range.from : null, range?.to);
});
viewer.onTick((time, duration) => {
  if (!scrubbing) {
    scrub.value = String(Math.round((time / (duration || 1)) * 1000));
    paintScrub();
  }
  clock.textContent = `${time.toFixed(1)}s`;
});
viewer.onLoop(() => {
  rep = (rep % repeat) + 1;
  updateReps();
});

function updateReps(): void {
  reps.textContent = repeat > 1 ? `rep ${rep} / ${repeat}` : "";
}

function buildRibbonAndMarkers(): void {
  const tl = viewer.getTimeline();
  ribbon.innerHTML = "";
  markers.innerHTML = "";
  if (!tl) return;
  for (const seg of tl.segments) {
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.textContent = seg.name;
    chip.dataset.name = seg.name;
    chip.title = seg.cue ?? "";
    chip.addEventListener("click", () => viewer.seek(seg.start + 1e-3));
    ribbon.append(chip);

    if (seg.start > 0) {
      const tick = document.createElement("div");
      tick.className = "tick";
      tick.style.left = `${(seg.start / tl.duration) * 100}%`;
      markers.append(tick);
    }
  }
}

function highlightChip(name: string): void {
  for (const el of ribbon.querySelectorAll<HTMLElement>(".chip")) {
    el.classList.toggle("active", el.dataset.name === name);
  }
}

/**
 * Map each phase (in timeline order) to the line range of its `step` block, by
 * scanning the document. Step lines and `repeat` mark block boundaries; trailing
 * blank lines are trimmed so the highlight hugs the actual phase.
 */
function computePhaseRanges(
  text: string,
  segmentNames: string[],
): Map<string, { from: number; to: number }> {
  const lines = text.split(/\r?\n/);
  const stepLines: number[] = [];
  const boundaries: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const isStep = /^\s*step\b/.test(lines[i]!);
    if (isStep) stepLines.push(i + 1);
    if (isStep || /^\s*repeat\b/.test(lines[i]!)) boundaries.push(i + 1);
  }
  const ranges = new Map<string, { from: number; to: number }>();
  for (let s = 0; s < stepLines.length && s < segmentNames.length; s++) {
    const from = stepLines[s]!;
    const next = boundaries.find((b) => b > from);
    let to = next ? next - 1 : lines.length;
    while (to > from && lines[to - 1]!.trim() === "") to--;
    ranges.set(segmentNames[s]!, { from, to });
  }
  return ranges;
}

let debounce = 0;
function scheduleRecompile(): void {
  window.clearTimeout(debounce);
  debounce = window.setTimeout(recompile, 250);
}

function recompile(): void {
  window.clearTimeout(debounce); // cancel any pending run; we're compiling now
  const { ir, errors, warnings: warns } = parse(editorApi.getValue());
  renderWarnings(warnings, errors, warns);
  if (ir) {
    viewer.load(ir);
    viewer.setLoop(loop.checked);
    viewer.play();
    setPlaying(true);
    const tl = viewer.getTimeline();
    repeat = tl?.repeat ?? 1;
    rep = 1;
    updateReps();
    buildRibbonAndMarkers();
    phaseRanges = computePhaseRanges(
      editorApi.getValue(),
      (tl?.segments ?? []).map((s) => s.name),
    );
    editorApi.highlightPhase(null); // next onPhase paints the active block
  }
}

// --- Presets: a filterable gallery (body part / equipment / difficulty) ---
// The catalogue is tagged like a standard exercise DB, so the dropdown can be
// narrowed the way an exercise explorer would. Options for each filter are
// derived from the data so they never drift.
const fBody = $<HTMLSelectElement>("f-body");
const fEquip = $<HTMLSelectElement>("f-equip");
const fLevel = $<HTMLSelectElement>("f-level");
const presetCount = $<HTMLSpanElement>("preset-count");

function fillFilter(sel: HTMLSelectElement, values: string[], allLabel: string): void {
  sel.innerHTML = "";
  const all = document.createElement("option");
  all.value = "";
  all.textContent = allLabel;
  sel.append(all);
  for (const v of [...new Set(values)].sort()) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    sel.append(opt);
  }
}
fillFilter(fBody, PRESETS.map((p) => p.bodyPart), "All areas");
fillFilter(fEquip, PRESETS.map((p) => p.equipment), "All gear");
fillFilter(fLevel, PRESETS.map((p) => p.difficulty), "All levels");

/** Rebuild the Example dropdown from the presets matching the active filters. */
function rebuildPresetOptions(): void {
  const matches = PRESETS.filter(
    (p) =>
      (!fBody.value || p.bodyPart === fBody.value) &&
      (!fEquip.value || p.equipment === fEquip.value) &&
      (!fLevel.value || p.difficulty === fLevel.value),
  );
  presetSel.innerHTML = "";
  const groups = new Map<string, HTMLOptGroupElement>();
  for (const p of matches) {
    let group = groups.get(p.domain);
    if (!group) {
      group = document.createElement("optgroup");
      group.label = p.domain;
      groups.set(p.domain, group);
      presetSel.append(group);
    }
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = `${p.label} · ${p.target}`;
    group.append(opt);
  }
  presetCount.textContent = `(${matches.length})`;
  if (matches.length === 0) {
    const opt = document.createElement("option");
    opt.textContent = "No matches — clear filters";
    opt.disabled = true;
    presetSel.append(opt);
  }
}
rebuildPresetOptions();

for (const f of [fBody, fEquip, fLevel]) {
  f.addEventListener("change", () => {
    rebuildPresetOptions();
    // Auto-load the first match so the viewer always reflects the filter.
    const first = PRESETS.find((p) => p.id === presetSel.value);
    if (first) {
      editorApi.setValue(first.source);
      recompile();
    }
  });
}

presetSel.addEventListener("change", () => {
  const preset = PRESETS.find((p) => p.id === presetSel.value);
  if (preset) {
    editorApi.setValue(preset.source);
    recompile();
    setMobileView("viewer"); // on phones, jump to the figure after picking
  }
});

// --- Mobile Editor/Viewer toggle (no-op visually on desktop, where both show) ---
function setMobileView(view: "editor" | "viewer"): void {
  document.body.dataset.mview = view;
  tabEditor.setAttribute("aria-selected", String(view === "editor"));
  tabViewer.setAttribute("aria-selected", String(view === "viewer"));
}
tabEditor.addEventListener("click", () => setMobileView("editor"));
tabViewer.addEventListener("click", () => setMobileView("viewer"));
setMobileView("viewer");

// --- Transport ---
playpause.addEventListener("click", () => {
  setPlaying(viewer.toggle());
});
scrub.addEventListener("input", () => {
  scrubbing = true;
  paintScrub();
  viewer.seek((Number(scrub.value) / 1000) * viewer.duration);
});
scrub.addEventListener("change", () => {
  scrubbing = false;
});
loop.addEventListener("change", () => viewer.setLoop(loop.checked));
speed.addEventListener("change", () => viewer.setSpeed(Number(speed.value)));

// --- Button label feedback ---
// Swap a button's label (the inner `.lbl` span when present, else the button
// text) to a transient message, then restore it.
function flash(btn: HTMLElement, message: string): void {
  const el = btn.querySelector<HTMLElement>(".lbl") ?? btn;
  const prev = el.textContent;
  el.textContent = message;
  window.setTimeout(() => (el.textContent = prev), 1500);
}

// --- Copy LLM prompt (topbar) ---
async function copyPrompt(btn: HTMLButtonElement): Promise<void> {
  try {
    await navigator.clipboard.writeText(llmPrompt);
    flash(btn, "Copied ✓");
  } catch {
    flash(btn, "Copy failed");
  }
}
copyBtn.addEventListener("click", () => copyPrompt(copyBtn));

// --- Share (permalink) ---
// Snapshot the current document into a URL hash, reflect it in the address bar
// (so it's bookmarkable), and copy the full link to the clipboard.
async function shareLink(): Promise<void> {
  try {
    const hash = buildShareHash(editorApi.getValue());
    const url = `${location.origin}${location.pathname}${hash}`;
    history.replaceState(null, "", hash);
    await navigator.clipboard.writeText(url);
    flash(shareBtn, "Link copied ✓");
  } catch (err) {
    const message =
      err instanceof TypeError
        ? "Nothing to share"
        : err instanceof RangeError
          ? "Too long to link"
          : "Copy failed";
    flash(shareBtn, message);
  }
}
shareBtn.addEventListener("click", shareLink);

// --- How-to slide-over ---
const howto = $<HTMLElement>("howto");
const scrim = $<HTMLDivElement>("scrim");
$<HTMLPreElement>("prompt-text").textContent = llmPrompt;

function openHowto(): void {
  howto.hidden = false;
  scrim.hidden = false;
}
function closeHowto(): void {
  howto.hidden = true;
  scrim.hidden = true;
}
$<HTMLButtonElement>("how-to").addEventListener("click", openHowto);
$<HTMLButtonElement>("howto-close").addEventListener("click", closeHowto);
scrim.addEventListener("click", closeHowto);
$<HTMLButtonElement>("howto-copy").addEventListener("click", (e) =>
  copyPrompt(e.currentTarget as HTMLButtonElement),
);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeHowto();
});

// --- Intro strip ---
const intro = $<HTMLDivElement>("intro");
$<HTMLButtonElement>("intro-open").addEventListener("click", () => {
  openHowto();
  intro.hidden = true;
});
$<HTMLButtonElement>("intro-dismiss").addEventListener("click", () => {
  intro.hidden = true;
});

// Boot: a shared link (?#doc=…) wins over the default preset.
const sharedSource = readShareHash(window.location.hash);
let initialDoc: string;
if (sharedSource) {
  // Reflect the off-preset document in the dropdown with a transient option.
  const opt = document.createElement("option");
  opt.value = "__shared__";
  opt.textContent = "↗ shared link";
  presetSel.prepend(opt);
  presetSel.value = "__shared__";
  initialDoc = sharedSource;
  intro.hidden = true;
} else {
  initialDoc = PRESETS[0]!.source;
  presetSel.value = PRESETS[0]!.id;
}

editorApi = createMovitEditor($("editor"), {
  doc: initialDoc,
  onChange: scheduleRecompile,
});
recompile();

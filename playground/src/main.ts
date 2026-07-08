/**
 * Posecode playground wiring: editor → parser → 3D viewer, plus the how-to
 * slide-over and playback UX (phase ribbon, scrubber markers, rep counter).
 *
 * The text in the editor is the single source of truth. On every (debounced)
 * change we re-parse; clean docs reload the viewer, errors/warnings surface in
 * the side panel. This mirrors how an LLM-authored doc would be pasted in.
 */

import { parse } from "posecode-parser";
import { inject } from "@vercel/analytics";
import type { Viewer } from "posecode-render";
import { buildNiceShareHash, resolveSharedSource } from "./nice-share.js";
import type { PosecodeEditor } from "./editor.js";
import { PRESETS } from "./presets.js";
import { renderWarnings } from "./warnings.js";
import llmPrompt from "../../spec/llm-authoring.md?raw";

inject();

const $ = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

// CodeMirror is heavy too, so the editor is lazy-loaded after first paint (its
// own chunk). Until that resolves, `editorApi` is null; recompile() and the
// user-action handlers guard on it (a click in that ~tens-of-ms window no-ops).
let editorApi: PosecodeEditor | null = null;
const warnings = $<HTMLDivElement>("warnings");
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

// Three.js is heavy (~530 kB). Like the landing page, we load the renderer
// *after* the editor shell paints (dynamic import → its own chunk) so first
// paint and interactivity aren't blocked by it. Until `boot()` resolves the
// import, `viewer` is null and viewer-dependent work is skipped/deferred.
let viewer: Viewer | null = null;
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

/** Wire the viewer's playback callbacks. Runs once, after the renderer loads. */
function wireViewer(v: Viewer): void {
  v.onPhase(({ phaseName, cue }) => {
    phaseEl.textContent = phaseName === "reset" ? "" : phaseName;
    cueEl.textContent = cue ?? "";
    highlightChip(phaseName);
    // Light up the step block driving this phase (cleared between loops / on reset).
    const range = phaseName === "reset" ? undefined : phaseRanges.get(phaseName);
    editorApi?.highlightPhase(range ? range.from : null, range?.to);
  });
  v.onTick((time, duration) => {
    if (!scrubbing) {
      scrub.value = String(Math.round((time / (duration || 1)) * 1000));
      paintScrub();
    }
    clock.textContent = `${time.toFixed(1)}s`;
  });
  v.onLoop(() => {
    rep = (rep % repeat) + 1;
    updateReps();
  });
}

function updateReps(): void {
  reps.textContent = repeat > 1 ? `rep ${rep} / ${repeat}` : "";
}

function buildRibbonAndMarkers(): void {
  const tl = viewer?.getTimeline();
  ribbon.innerHTML = "";
  markers.innerHTML = "";
  if (!tl) return;
  for (const seg of tl.segments) {
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.textContent = seg.name;
    chip.dataset.name = seg.name;
    chip.title = seg.cue ?? "";
    chip.addEventListener("click", () => viewer?.seek(seg.start + 1e-3));
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
  // Captured once so control-flow narrowing survives the calls below; a null
  // editor (still loading) means there's nothing to compile yet.
  const ed = editorApi;
  if (!ed) return;
  const source = ed.getValue();
  if (!source.trim()) {
    // A deliberately blank editor (the "New" flow): a paste target, not an
    // error state. Show a hint instead of parse errors and stop the playback.
    warnings.innerHTML =
      '<div class="row hint">Blank editor. Paste a movement from your AI chat, or pick one from the library.</div>';
    viewer?.pause();
    setPlaying(false);
    return;
  }
  const { ir, errors, warnings: warns } = parse(source);
  renderWarnings(warnings, errors, warns);
  // Before the renderer finishes loading, we still parse + surface warnings;
  // the viewer-dependent work re-runs once `boot()` calls recompile() again.
  if (ir && viewer) {
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
      ed.getValue(),
      (tl?.segments ?? []).map((s) => s.name),
    );
    ed.highlightPhase(null); // next onPhase paints the active block
  }
}

// --- Movement library: one panel to search, filter, and pick an example ---
// Replaces the old topbar dropdown cluster (area / gear / level / example): a
// single button shows the current movement and opens a browsable panel with
// one search box and two light chip filters. Picking a movement loads it and
// closes the panel, so the topbar stays a one-glance control on any screen.
const libOpenBtn = $<HTMLButtonElement>("lib-open");
const libCurrent = $<HTMLSpanElement>("lib-current");
const library = $<HTMLElement>("library");
const libSearch = $<HTMLInputElement>("lib-search");
const libDomains = $<HTMLDivElement>("lib-domains");
const libLevels = $<HTMLDivElement>("lib-levels");
const libList = $<HTMLDivElement>("lib-list");
const libCount = $<HTMLSpanElement>("lib-count");

let currentPresetId: string | null = null;
let libQuery = "";
let libDomain = ""; // "" = all
let libLevel = ""; // "" = all

/** Render one chip row ("All" + each distinct value) reflecting the selection. */
function renderChips(
  host: HTMLDivElement,
  values: string[],
  selected: string,
  allLabel: string,
  onPick: (value: string) => void,
): void {
  host.innerHTML = "";
  for (const value of ["", ...values]) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "fchip";
    chip.textContent = value || allLabel;
    chip.setAttribute("aria-pressed", String(value === selected));
    chip.addEventListener("click", () => onPick(value));
    host.append(chip);
  }
}

function renderLibraryFilters(): void {
  // Domains keep catalogue order (curated); levels are a fixed scale.
  renderChips(libDomains, [...new Set(PRESETS.map((p) => p.domain))], libDomain, "All", (v) => {
    libDomain = v;
    renderLibraryFilters();
    renderLibraryList();
  });
  renderChips(libLevels, ["Beginner", "Intermediate", "Advanced"], libLevel, "All levels", (v) => {
    libLevel = v;
    renderLibraryFilters();
    renderLibraryList();
  });
}

/** Case- and accent-insensitive ("plie" finds "Demi-plié"). */
function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function libraryMatches(): typeof PRESETS {
  const q = fold(libQuery.trim());
  return PRESETS.filter(
    (p) =>
      (!libDomain || p.domain === libDomain) &&
      (!libLevel || p.difficulty === libLevel) &&
      (!q ||
        fold(`${p.label} ${p.target} ${p.domain} ${p.bodyPart} ${p.equipment}`).includes(q)),
  );
}

function renderLibraryList(): void {
  const matches = libraryMatches();
  libCount.textContent = `(${matches.length})`;
  libList.innerHTML = "";

  if (matches.length === 0) {
    const empty = document.createElement("div");
    empty.className = "lib-empty";
    empty.textContent = "No movements match. ";
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "link";
    reset.textContent = "Reset search & filters";
    reset.addEventListener("click", () => {
      libQuery = "";
      libSearch.value = "";
      libDomain = "";
      libLevel = "";
      renderLibraryFilters();
      renderLibraryList();
    });
    empty.append(reset);
    libList.append(empty);
    return;
  }

  // Group by domain (first-seen order) so each practice gets a single header.
  const groups = new Map<string, typeof matches>();
  for (const p of matches) {
    const group = groups.get(p.domain);
    if (group) group.push(p);
    else groups.set(p.domain, [p]);
  }
  for (const [domain, presets] of groups) {
    const head = document.createElement("div");
    head.className = "lib-group";
    head.textContent = domain;
    libList.append(head);
    for (const p of presets) appendItem(p);
  }

  function appendItem(p: (typeof PRESETS)[number]): void {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "lib-item";
    if (p.id === currentPresetId) item.setAttribute("aria-current", "true");
    const name = document.createElement("span");
    name.className = "li-name";
    name.textContent = p.label;
    const meta = document.createElement("span");
    meta.className = "li-meta";
    meta.textContent = `${p.target} · ${p.equipment} · ${p.difficulty}`;
    item.append(name, meta);
    item.addEventListener("click", () => {
      loadPreset(p.id);
      closePanels();
    });
    libList.append(item);
  }
}

function loadPreset(id: string): void {
  const preset = PRESETS.find((p) => p.id === id);
  if (!preset) return;
  currentPresetId = preset.id;
  libCurrent.textContent = preset.label;
  editorApi?.setValue(preset.source);
  recompile();
  setMobileView("viewer"); // on phones, jump to the figure after picking
}

libSearch.addEventListener("input", () => {
  libQuery = libSearch.value;
  renderLibraryList();
});
renderLibraryFilters();
renderLibraryList();

// --- New movement: clear the editor into a paste target for LLM output ---
// The core loop is "Copy LLM prompt → ask an AI for a movement → paste it
// back"; without this, pasting meant overwriting a preset by hand-selecting
// its text first.
$<HTMLButtonElement>("new-doc").addEventListener("click", () => {
  currentPresetId = null;
  libCurrent.textContent = "New movement";
  editorApi?.setValue("");
  recompile(); // swaps the status row to the blank-editor hint immediately
  setMobileView("editor"); // the paste target, front and center on phones
  editorApi?.focus();
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
  if (viewer) setPlaying(viewer.toggle());
});
scrub.addEventListener("input", () => {
  if (!viewer) return;
  scrubbing = true;
  paintScrub();
  viewer.seek((Number(scrub.value) / 1000) * viewer.duration);
});
scrub.addEventListener("change", () => {
  scrubbing = false;
});
loop.addEventListener("change", () => viewer?.setLoop(loop.checked));
speed.addEventListener("change", () => viewer?.setSpeed(Number(speed.value)));

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
  if (!editorApi) return; // editor still loading; nothing to snapshot yet
  try {
    const hash = buildNiceShareHash(editorApi.getValue());
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

// --- Slide-over panels (how-to, movement library) sharing one scrim ---
const howto = $<HTMLElement>("howto");
const scrim = $<HTMLDivElement>("scrim");
$<HTMLPreElement>("prompt-text").textContent = llmPrompt;

function openPanel(panel: HTMLElement): void {
  closePanels();
  panel.hidden = false;
  scrim.hidden = false;
}
function closePanels(): void {
  howto.hidden = true;
  library.hidden = true;
  scrim.hidden = true;
}
function openHowto(): void {
  openPanel(howto);
}
function openLibrary(): void {
  renderLibraryList(); // refresh the "current movement" marker
  openPanel(library);
  // Focus search only with a real keyboard; on touch it would pop the OSK.
  if (matchMedia("(hover: hover) and (pointer: fine)").matches) libSearch.focus();
}
$<HTMLButtonElement>("how-to").addEventListener("click", openHowto);
$<HTMLButtonElement>("howto-close").addEventListener("click", closePanels);
libOpenBtn.addEventListener("click", openLibrary);
$<HTMLButtonElement>("library-close").addEventListener("click", closePanels);
scrim.addEventListener("click", closePanels);
$<HTMLButtonElement>("howto-copy").addEventListener("click", (e) =>
  copyPrompt(e.currentTarget as HTMLButtonElement),
);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closePanels();
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

// Boot: a shared link (?#doc=…) wins over the default preset. A link built
// from a known movement (`#doc=squat`) resolves straight to that preset, so
// it opens exactly like picking it from the library would.
const sharedSource = resolveSharedSource(window.location.hash);
let initialDoc: string;
if (sharedSource) {
  const preset = PRESETS.find((p) => p.source === sharedSource);
  currentPresetId = preset?.id ?? null;
  libCurrent.textContent = preset ? preset.label : "↗ Shared link";
  initialDoc = sharedSource;
  intro.hidden = true;
} else {
  initialDoc = PRESETS[0]!.source;
  currentPresetId = PRESETS[0]!.id;
  libCurrent.textContent = PRESETS[0]!.label;
}

// Boot the two heavyweights (CodeMirror editor + Three.js renderer) after the
// shell paints, each in its own lazy chunk, so neither is on the critical path.
// They load independently; recompile() self-guards until both are ready, and
// whichever resolves last triggers the parse-and-animate pass.

// Editor: mount CodeMirror into the shell, then compile so warnings surface.
void import("./editor.js").then(({ createPosecodeEditor }) => {
  editorApi = createPosecodeEditor($("editor"), {
    doc: initialDoc,
    onChange: scheduleRecompile,
  });
  recompile();
});

// Renderer: keep Three.js off the critical path, mirroring the landing page.
void import("posecode-render").then(({ createViewer }) => {
  // No idle camera orbit in the playground: the point here is judging the
  // movement itself, and a permanently rotating scene reads as the figure
  // swaying. The landing-page hero keeps its showcase orbit.
  viewer = createViewer(canvas, { autoRotate: false });
  // Exposed for capture/e2e tooling (frame capture drives README GIFs).
  (window as unknown as Record<string, unknown>).__posecodeViewer = viewer;
  wireViewer(viewer);
  recompile();
});

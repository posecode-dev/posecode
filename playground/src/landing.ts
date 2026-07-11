/**
 * Posecode landing page. Demo-forward: a live hero viewer and an examples gallery
 * whose cards deep-link into the playground via the shared permalink codec.
 * Reuses the same parser, renderer, and share encoding as the tool: no
 * bespoke logic that could drift.
 */

import { parse } from "posecode-parser";
import { inject } from "@vercel/analytics";
import { PRESETS } from "./presets.js";
import llmPrompt from "../../spec/llm-authoring.md?raw";

inject();

// Preserve permalinks shared before the tool moved from `/` to `/play`.
if (location.hash.startsWith("#doc=")) {
  location.replace(`/play${location.hash}`);
}

const prefersReducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

// --- Hero: a live 3D figure ------------------------------------------------
// Three.js is heavy, so load the viewer *after* first paint (dynamic import →
// its own chunk) and let the studio card's frame render instantly. Honors
// reduced-motion by neither auto-rotating nor auto-playing.
function initHero(): void {
  const heroCanvas = document.getElementById("hero-canvas") as HTMLCanvasElement | null;
  if (!heroCanvas) return;
  void import("posecode-render").then(({ createViewer }) => {
    const viewer = createViewer(heroCanvas, {
      autoRotate: !prefersReducedMotion,
      // Realistic skinned figure; the procedural one covers until it loads.
      characterUrl: "/models/character.glb",
    });
    const phaseEl = document.getElementById("hero-phase");
    viewer.onPhase(({ phaseName }) => {
      if (phaseEl) phaseEl.textContent = phaseName === "reset" ? "" : phaseName;
    });
    // Hero movement: jumping jacks. Full-body, symmetric, and cyclical, so it
    // reads instantly and loops seamlessly through the neutral standing pose.
    const heroPreset = PRESETS.find((p) => p.id === "jumping-jacks") ?? PRESETS[0]!;
    const { ir } = parse(heroPreset.source);
    if (ir) {
      viewer.load(ir);
      viewer.setLoop(true);
      if (!prefersReducedMotion) viewer.play();
    }
  });
}

if ("requestIdleCallback" in window) {
  requestIdleCallback(initHero, { timeout: 1200 });
} else {
  // `window` narrows to `never` here (lib.dom always declares
  // requestIdleCallback), so call the global directly.
  setTimeout(initHero, 200);
}

// --- Examples gallery: a curated taste, not the full 65 ---------------------
// The full library already has a proper filterable/grouped gallery in the
// playground itself (domain, body part, equipment, difficulty). Dumping all
// 65 cards into the landing page turned this section into a long doom-scroll
// on mobile, so show a handful of visually distinct highlights spanning
// different domains, then hand off to the real gallery.
const HIGHLIGHT_IDS = ["dance-phrase", "pull-up", "cobra", "touch-toes", "hand-wave"];

const grid = document.getElementById("examples-grid");
if (grid) {
  const byId = new Map(PRESETS.map((p) => [p.id, p]));
  for (const id of HIGHLIGHT_IDS) {
    const preset = byId.get(id);
    if (!preset) continue;
    const card = document.createElement("a");
    card.className = "example-card";
    card.href = `/play/${preset.id}`;
    card.innerHTML = `
      <span class="example-kind">${preset.domain}</span>
      <span class="example-name">${preset.label}</span>
      <span class="example-go">Open in playground →</span>`;
    grid.append(card);
  }

  const remaining = PRESETS.length - HIGHLIGHT_IDS.length;
  const more = document.createElement("a");
  more.className = "example-card example-more";
  more.href = "/play";
  more.innerHTML = `
    <span class="example-kind">Full library</span>
    <span class="example-name">+${remaining} more movements</span>
    <span class="example-go">Browse &amp; filter by domain →</span>`;
  grid.append(more);
}

// --- Copy the LLM authoring prompt ------------------------------------------
const copyBtn = document.getElementById("copy-prompt") as HTMLButtonElement | null;
if (copyBtn) {
  const lbl = copyBtn.querySelector<HTMLElement>(".lbl") ?? copyBtn;
  copyBtn.addEventListener("click", async () => {
    const prev = lbl.textContent;
    try {
      await navigator.clipboard.writeText(llmPrompt);
      lbl.textContent = "Copied ✓";
    } catch {
      lbl.textContent = "Copy failed";
    }
    window.setTimeout(() => (lbl.textContent = prev), 1500);
  });
}

// --- Scroll-triggered reveals ----------------------------------------------
const io = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        e.target.classList.add("in");
        io.unobserve(e.target);
      }
    }
  },
  { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
);
for (const el of document.querySelectorAll(".reveal")) io.observe(el);

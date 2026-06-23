/**
 * Movit landing page. Demo-forward: a live hero viewer and an examples gallery
 * whose cards deep-link into the playground via the shared permalink codec.
 * Reuses the same parser, renderer, and share encoding as the tool — no
 * bespoke logic that could drift.
 */

import { parse } from "movit-parser";
import { buildShareHash } from "movit-share";
import { PRESETS } from "./presets.js";
import llmPrompt from "../../spec/llm-authoring.md?raw";

// Preserve permalinks shared before the tool moved from `/` to `/play`.
if (location.hash.startsWith("#doc=")) {
  location.replace(`play.html${location.hash}`);
}

const prefersReducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

// --- Hero: a live 3D figure ------------------------------------------------
// Three.js is heavy, so load the viewer *after* first paint (dynamic import →
// its own chunk) and let the studio card's frame render instantly. Honors
// reduced-motion by neither auto-rotating nor auto-playing.
function initHero(): void {
  const heroCanvas = document.getElementById("hero-canvas") as HTMLCanvasElement | null;
  if (!heroCanvas) return;
  void import("movit-render").then(({ createViewer }) => {
    const viewer = createViewer(heroCanvas, { autoRotate: !prefersReducedMotion });
    const phaseEl = document.getElementById("hero-phase");
    viewer.onPhase(({ phaseName }) => {
      if (phaseEl) phaseEl.textContent = phaseName === "reset" ? "" : phaseName;
    });
    const { ir } = parse(PRESETS[0]!.source); // body-weight squat
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
  window.setTimeout(initHero, 200);
}

// --- Examples gallery: each card opens the movement in the playground -------
const grid = document.getElementById("examples-grid");
if (grid) {
  for (const preset of PRESETS) {
    const kind = parse(preset.source).ir?.kind ?? "movement";
    const card = document.createElement("a");
    card.className = "example-card";
    card.href = `play.html${buildShareHash(preset.source)}`;
    card.innerHTML = `
      <span class="example-kind">${kind}</span>
      <span class="example-name">${preset.label}</span>
      <span class="example-go">Open in playground →</span>`;
    grid.append(card);
  }
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

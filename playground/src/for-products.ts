import {
  trackUsageEvent,
  USAGE_EVENT_NAMES,
  type InstallCommand,
} from "./analytics.js";
import { initializeAnalytics } from "./vercel-analytics.js";

initializeAnalytics();

document.querySelector<HTMLElement>("[data-embed-docs]")?.addEventListener(
  "click",
  () => {
    trackUsageEvent(USAGE_EVENT_NAMES.embedDocsClicked, {
      location: "for_products",
    });
  },
);

for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-copy-command]",
)) {
  button.addEventListener("click", async () => {
    const command = button.dataset.command;
    const commandKind = button.dataset.copyCommand as
      | InstallCommand
      | undefined;
    if (!command || !commandKind) return;
    const previous = button.textContent;
    try {
      await navigator.clipboard.writeText(command);
      button.textContent = "Copied ✓";
      trackUsageEvent(USAGE_EVENT_NAMES.installCommandCopied, {
        command: commandKind,
        location: "for_products",
      });
    } catch {
      button.textContent = "Copy failed";
    }
    window.setTimeout(() => {
      button.textContent = previous;
    }, 1500);
  });
}

const prefersReducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

if (!prefersReducedMotion && "IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("in");
        observer.unobserve(entry.target);
      }
    },
    { threshold: 0.08, rootMargin: "0px 0px -6% 0px" },
  );
  for (const element of document.querySelectorAll(".reveal")) observer.observe(element);
} else {
  for (const element of document.querySelectorAll(".reveal")) element.classList.add("in");
}

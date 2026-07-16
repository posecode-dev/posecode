import { inject } from "@vercel/analytics";

inject();

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

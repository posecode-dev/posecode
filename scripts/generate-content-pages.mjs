#!/usr/bin/env node
/**
 * Generates static, indexable content pages for posecode.org:
 *   - playground/public/moves/<id>.html   one page per example movement
 *   - playground/public/moves/index.html  a browsable hub, grouped by domain
 *   - playground/public/spec.html         the language spec, rendered
 *   - playground/public/llm-guide.html    the LLM authoring guide, rendered
 *   - playground/public/sitemap.xml       regenerated to include all of the above
 *
 * These are plain HTML files copied through as-is by Vite (public/). The
 * playground's prebuild hook runs this generator so production cannot
 * publish stale movement counts, language docs, or safety wording.
 *
 * Usage: node scripts/generate-content-pages.mjs
 */
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { pageShell, esc } from "./lib/shell.mjs";
import { renderMarkdown } from "./lib/md.mjs";
import { loadPlaygroundPresets } from "../playground/scripts/load-presets.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const playgroundRoot = resolve(repoRoot, "playground");
const publicDir = resolve(playgroundRoot, "public");
const movesDir = resolve(publicDir, "moves");
const SITE = "https://www.posecode.org";
const TODAY = new Date().toISOString().slice(0, 10);

/** Pull the movement source text apart into steps (name, duration, cue). */
function parseSteps(source) {
  const stepRe = /^\s*step\s+"([^"]+)"\s+([\d.]+s)\s+([\w-]+):/gm;
  const steps = [];
  let m;
  const positions = [];
  while ((m = stepRe.exec(source))) {
    positions.push({ index: m.index, name: m[1], duration: m[2], easing: m[3] });
  }
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i].index;
    const end = i + 1 < positions.length ? positions[i + 1].index : source.length;
    const block = source.slice(start, end);
    const cueMatch = /cue\s+"([^"]+)"/.exec(block);
    steps.push({
      name: positions[i].name,
      duration: positions[i].duration,
      easing: positions[i].easing,
      cue: cueMatch ? cueMatch[1] : "",
    });
  }
  return steps;
}
function parseRepeat(source) {
  const m = /^\s*repeat\s+(\d+)/m.exec(source);
  return m ? Number(m[1]) : 1;
}

function slugTitle(label) {
  return label.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

async function main() {
  const PRESETS = await loadPlaygroundPresets(playgroundRoot);
  const readyPresets = PRESETS.filter((preset) => preset.status === "ready");

  await rm(movesDir, { recursive: true, force: true });
  await mkdir(movesDir, { recursive: true });

  const sitemapUrls = [
    { loc: `${SITE}/`, priority: "1.0" },
    { loc: `${SITE}/play`, priority: "0.9" },
    { loc: `${SITE}/moves/`, priority: "0.8" },
    { loc: `${SITE}/spec.html`, priority: "0.6" },
    { loc: `${SITE}/llm-guide.html`, priority: "0.6" },
  ];

  // --- Per-movement pages ---------------------------------------------------
  const byDomain = new Map();
  for (const p of readyPresets) {
    const steps = parseSteps(p.source);
    const repeat = parseRepeat(p.source);
    const name = slugTitle(p.label);
    const url = `/moves/${p.id}.html`;
    const levelArticle = /^[aeiou]/i.test(p.difficulty) ? "an" : "a";

    const stepsHtml = steps
      .map(
        (s) => `<li>
          <span class="step-name">${esc(s.name)}<span class="step-dur">${esc(s.duration)} · ${esc(s.easing)}</span></span>
          <span class="step-cue">${s.cue ? esc(s.cue) : "&nbsp;"}</span>
        </li>`,
      )
      .join("\n");

    const related = readyPresets.filter((o) => o.domain === p.domain && o.id !== p.id).slice(0, 6);
    const relatedHtml = related.length
      ? `<h2>More ${esc(p.domain.toLowerCase())} movements</h2>
         <div class="chip-list">${related.map((o) => `<a href="/moves/${o.id}.html">${esc(o.label)}</a>`).join("")}</div>`
      : "";

    const description = `${name} is ${levelArticle} ${p.difficulty.toLowerCase()}-level ${p.domain.toLowerCase()} Posecode example with ${steps.length} inspectable phases and a link to live 3D playback.`;

    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "TechArticle",
      headline: `${name}: a Posecode movement example`,
      description,
    };

    const bodyHtml = `
      <p class="eyebrow">${esc(p.domain)} · ${esc(p.bodyPart)}</p>
      <h1>${esc(name)}</h1>
      <p class="meta-line"><b>Target</b> ${esc(p.target)} &nbsp;·&nbsp; <b>Equipment</b> ${esc(p.equipment)}
        &nbsp;·&nbsp; <b>Level</b> ${esc(p.difficulty)} &nbsp;·&nbsp; <b>Reps</b> ${repeat}</p>
      <p>${esc(name)} is ${levelArticle} ${esc(p.difficulty.toLowerCase())}-level ${esc(p.domain.toLowerCase())} movement targeting the
        ${esc(p.target.toLowerCase())}, written in <a href="/">Posecode</a>, a small open-source language
        that capable language models can use to describe human movement as text.
        Authored joint targets and reach-IK solves are constrained to Posecode's configured
        per-axis bounds. Those bounds constrain the visualization, but they do not certify
        that a complete movement is safe or clinically correct.
        This page documents a code example; it is not exercise instruction.</p>

      <a class="btn" href="/play/${p.id}">▶ Open ${esc(name)} in the playground →</a>

      <h2>Movement phases</h2>
      <p>Phase cues are display-only coaching text. The executable joint and
        contact directives in the source below determine the animation.</p>
      <ol class="steps">
${stepsHtml}
      </ol>

      <h2>The .posecode source</h2>
      <p>This is the exact text used by the linked playground animation: phases and joint
        angles, not 3D transforms.</p>
      <pre class="code-block"><code>${esc(p.source)}</code></pre>

      ${relatedHtml}
    `.trimEnd();

    const html = pageShell({
      title: `${name}: Posecode Movement Example | Posecode`,
      description,
      canonicalPath: url,
      jsonLd,
      bodyHtml,
    });
    await writeFile(resolve(movesDir, `${p.id}.html`), html, "utf8");
    sitemapUrls.push({ loc: `${SITE}${url}`, priority: "0.5" });

    if (!byDomain.has(p.domain)) byDomain.set(p.domain, []);
    byDomain.get(p.domain).push(p);
  }

  // --- Library hub page -------------------------------------------------------
  const groupsHtml = [...byDomain.entries()]
    .map(
      ([domain, presets]) => `
      <div class="domain-group">
        <h2>${esc(domain)}</h2>
        <div class="move-grid">
          ${presets
            .map(
              (p) => `<a class="move-card" href="/moves/${p.id}.html">
                <span class="mc-name">${esc(p.label)}</span>
                <span class="mc-meta">${esc(p.target)} · ${esc(p.equipment)} · ${esc(p.difficulty)}</span>
              </a>`,
            )
            .join("\n")}
        </div>
      </div>`,
    )
    .join("\n");

  const indexHtml = pageShell({
    title: `${readyPresets.length} Launch-Ready Posecode Movement Examples | Posecode`,
    description:
      `Browse ${readyPresets.length} launch-ready Posecode movement examples across fitness, physiotherapy, yoga, dance, and martial arts, each with inspectable source and a link to live 3D playback.`,
    canonicalPath: "/moves/",
    bodyHtml: `
      <p class="eyebrow">Movement library</p>
      <h1>${readyPresets.length} launch-ready movements, written as text</h1>
      <p>Launch-ready examples grouped by practice. Each page shows the phases, cues, and exact
        <code>.posecode</code> source, with a link that opens live 3D playback. Experimental
        previews are deliberately excluded from these static pages; opt into them from the
        <a href="/play">playground's movement library</a>.</p>
      ${groupsHtml}
    `,
  });
  await writeFile(resolve(movesDir, "index.html"), indexHtml, "utf8");

  // --- Doc pages (spec + LLM authoring guide), rendered from markdown --------
  const specMd = await readFile(resolve(repoRoot, "spec/SPEC.md"), "utf8");
  const specHtml = pageShell({
    title: "Posecode Language Specification: The .posecode Kinematic Motion DSL",
    description:
      "The full Posecode v0.3 grammar, timing modes, joints, actions, and configured range-of-motion tables for a text language capable LLMs can use to describe human movement.",
    canonicalPath: "/spec.html",
    bodyHtml: `<p class="eyebrow">Reference</p>\n${renderMarkdown(specMd)}`,
  });
  await writeFile(resolve(publicDir, "spec.html"), specHtml, "utf8");

  const guideMd = await readFile(resolve(repoRoot, "spec/llm-authoring.md"), "utf8");
  const guideHtml = pageShell({
    title: "How to Teach an LLM to Write Posecode: The Authoring Guide",
    description:
      "An authoring guide for capable language models: syntax, joints, phases, and worked examples for producing raw .posecode documents that the playground can validate.",
    canonicalPath: "/llm-guide.html",
    bodyHtml: `<p class="eyebrow">For LLMs</p>\n${renderMarkdown(guideMd)}`,
  });
  await writeFile(resolve(publicDir, "llm-guide.html"), guideHtml, "utf8");

  // --- Sitemap -----------------------------------------------------------------
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapUrls
  .map(
    (u) =>
      `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${TODAY}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`,
  )
  .join("\n")}
</urlset>
`;
  await writeFile(resolve(publicDir, "sitemap.xml"), sitemap, "utf8");

  console.log(
    `Generated ${readyPresets.length} launch-ready movement pages, 1 library index, 2 doc pages, and a ${sitemapUrls.length}-url sitemap.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

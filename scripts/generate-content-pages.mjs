#!/usr/bin/env node
/**
 * Generates static, indexable content pages for posecode.org:
 *   - playground/public/moves/<id>.html   one page per example movement
 *   - playground/public/moves/index.html  a browsable hub, grouped by domain
 *   - playground/public/spec.html         the language spec, rendered
 *   - playground/public/llm-guide.html    the LLM authoring guide, rendered
 *   - playground/public/sitemap.xml       regenerated to include all of the above
 *
 * These are plain HTML files copied through as-is by Vite (public/), so this
 * script is *not* wired into `npm run build` — run it manually after adding
 * or editing spec/examples/*.posecode, and commit the output. That keeps the
 * production build command (which Vercel runs) simple and low-risk.
 *
 * Usage: node scripts/generate-content-pages.mjs
 */
import { createServer } from "vite";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { pageShell, esc } from "./lib/shell.mjs";
import { renderMarkdown } from "./lib/md.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const playgroundRoot = resolve(repoRoot, "playground");
const publicDir = resolve(playgroundRoot, "public");
const movesDir = resolve(publicDir, "moves");
const SITE = "https://posecode.org";
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
  const server = await createServer({ root: playgroundRoot, server: { middlewareMode: true } });
  let PRESETS;
  try {
    ({ PRESETS } = await server.ssrLoadModule("/src/presets.ts"));
  } finally {
    await server.close();
  }

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
  for (const p of PRESETS) {
    const steps = parseSteps(p.source);
    const repeat = parseRepeat(p.source);
    const name = slugTitle(p.label);
    const hash = `#doc=${p.id}`;
    const url = `/moves/${p.id}.html`;

    const stepsHtml = steps
      .map(
        (s) => `<li>
          <span class="step-name">${esc(s.name)}<span class="step-dur">${esc(s.duration)} · ${esc(s.easing)}</span></span>
          <span class="step-cue">${s.cue ? esc(s.cue) : "&nbsp;"}</span>
        </li>`,
      )
      .join("\n");

    const related = PRESETS.filter((o) => o.domain === p.domain && o.id !== p.id).slice(0, 6);
    const relatedHtml = related.length
      ? `<h2>More ${esc(p.domain.toLowerCase())} movements</h2>
         <div class="chip-list">${related.map((o) => `<a href="/moves/${o.id}.html">${esc(o.label)}</a>`).join("")}</div>`
      : "";

    const description = `How to do the ${name.toLowerCase()} (${p.domain.toLowerCase()}): ${steps.length} phases targeting the ${p.target.toLowerCase()}, ${p.equipment.toLowerCase()}, ${p.difficulty.toLowerCase()} level. Animated 3D guide generated from Posecode, a text-to-motion language for LLMs.`;

    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "HowTo",
      name: `How to do a ${name}`,
      description,
      step: steps.map((s) => ({
        "@type": "HowToStep",
        name: s.name,
        text: s.cue || s.name,
      })),
    };

    const bodyHtml = `
      <p class="eyebrow">${esc(p.domain)} · ${esc(p.bodyPart)}</p>
      <h1>${esc(name)}</h1>
      <p class="meta-line"><b>Target</b> ${esc(p.target)} &nbsp;·&nbsp; <b>Equipment</b> ${esc(p.equipment)}
        &nbsp;·&nbsp; <b>Level</b> ${esc(p.difficulty)} &nbsp;·&nbsp; <b>Reps</b> ${repeat}</p>
      <p>${esc(name)} is a ${esc(p.difficulty.toLowerCase())}-level ${esc(p.domain.toLowerCase())} movement targeting the
        ${esc(p.target.toLowerCase())}, written in <a href="/">Posecode</a>, a small open-source language
        that LLMs like ChatGPT, Claude, and Gemini can write to describe human movement as text.
        Every joint angle below is hard-clamped to a safe range of motion.</p>

      <a class="btn" href="/play.html${hash}">▶ Open ${esc(name)} in the playground →</a>

      <h2>How to do it</h2>
      <ol class="steps">
${stepsHtml}
      </ol>

      <h2>The .posecode source</h2>
      <p>This is the exact text an LLM writes to produce the animation above: phases and joint
        angles, not 3D transforms.</p>
      <pre class="code-block"><code>${esc(p.source)}</code></pre>

      ${relatedHtml}
    `;

    const html = pageShell({
      title: `${name}: How to Do It (Animated 3D Guide) | Posecode`,
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
    title: "Movement Library: 70+ Animated 3D Exercises, Stretches & Dance | Posecode",
    description:
      "Browse every Posecode example movement: fitness, physiotherapy, yoga, dance, martial arts, and sign language, each with an animated 3D guide and the .posecode source an LLM wrote.",
    canonicalPath: "/moves/",
    bodyHtml: `
      <p class="eyebrow">Movement library</p>
      <h1>${PRESETS.length} movements, written as text</h1>
      <p>Every example in the Posecode library, grouped by practice. Each page shows the phases,
        coaching cues, and the exact <code>.posecode</code> source, plus a live 3D playback.
        Prefer to search and filter interactively? Use the
        <a href="/play.html">playground's movement library</a> instead.</p>
      ${groupsHtml}
    `,
  });
  await writeFile(resolve(movesDir, "index.html"), indexHtml, "utf8");

  // --- Doc pages (spec + LLM authoring guide), rendered from markdown --------
  const specMd = await readFile(resolve(repoRoot, "spec/SPEC.md"), "utf8");
  const specHtml = pageShell({
    title: "Posecode Language Specification: The .posecode Kinematic Motion DSL",
    description:
      "The full Posecode v0.1 grammar, joints, actions, and range-of-motion tables: a small text language LLMs write to describe human movement as an animated 3D figure.",
    canonicalPath: "/spec.html",
    bodyHtml: `<p class="eyebrow">Reference</p>\n${renderMarkdown(specMd)}`,
  });
  await writeFile(resolve(publicDir, "spec.html"), specHtml, "utf8");

  const guideMd = await readFile(resolve(repoRoot, "spec/llm-authoring.md"), "utf8");
  const guideHtml = pageShell({
    title: "How to Teach an LLM to Write Posecode: The Authoring Guide",
    description:
      "The system prompt that teaches ChatGPT, Claude, or Gemini to author valid .posecode documents: syntax, joints, phases, and worked examples.",
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
    `Generated ${PRESETS.length} movement pages, 1 library index, 2 doc pages, and a ${sitemapUrls.length}-url sitemap.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

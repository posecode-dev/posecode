/**
 * Minimal Markdown → HTML renderer, scoped to exactly the constructs used in
 * spec/SPEC.md and spec/llm-authoring.md: headers, fenced code blocks, pipe
 * tables, ordered/unordered lists, bold, inline code, links, and hr. Not a
 * general-purpose renderer: deliberately small and dependency-free so the
 * doc pages don't pull a markdown library into the build.
 */

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Inline spans: `code`, **bold**, [text](url), applied to already-escaped text. */
function renderInline(escaped) {
  return escaped
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, href) => {
      const external = /^https?:\/\//.test(href);
      const attrs = external ? ' target="_blank" rel="noopener"' : "";
      return `<a href="${escapeHtml(href)}"${attrs}>${text}</a>`;
    });
}

function renderTable(rows) {
  const [headerRow, , ...bodyRows] = rows; // rows[1] is the |---|---| separator
  const cells = (row) =>
    row
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((c) => c.trim());
  const th = cells(headerRow)
    .map((c) => `<th>${renderInline(escapeHtml(c))}</th>`)
    .join("");
  const trs = bodyRows
    .map(
      (row) =>
        `<tr>${cells(row)
          .map((c) => `<td>${renderInline(escapeHtml(c))}</td>`)
          .join("")}</tr>`,
    )
    .join("\n");
  return `<div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>\n${trs}\n</tbody></table></div>`;
}

export function renderMarkdown(md) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let i = 0;
  let para = [];
  let list = null; // { type: "ul" | "ol", items: [] }

  function flushPara() {
    if (para.length) {
      out.push(`<p>${renderInline(escapeHtml(para.join(" ")))}</p>`);
      para = [];
    }
  }
  function flushList() {
    if (list) {
      out.push(`<${list.type}>${list.items.map((it) => `<li>${renderInline(escapeHtml(it))}</li>`).join("")}</${list.type}>`);
      list = null;
    }
  }

  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      flushPara();
      flushList();
      const lang = line.slice(3).trim();
      const code = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        code.push(lines[i]);
        i++;
      }
      out.push(
        `<pre class="code-block"${lang ? ` data-lang="${escapeHtml(lang)}"` : ""}><code>${escapeHtml(code.join("\n"))}</code></pre>`,
      );
      i++;
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      flushList();
      const level = heading[1].length;
      out.push(`<h${level}>${renderInline(escapeHtml(heading[2]))}</h${level}>`);
      i++;
      continue;
    }

    if (/^\s*---\s*$/.test(line)) {
      flushPara();
      flushList();
      out.push("<hr>");
      i++;
      continue;
    }

    if (/^\|/.test(line) && i + 1 < lines.length && /^\|?\s*-{2,}/.test(lines[i + 1])) {
      flushPara();
      flushList();
      const tableLines = [line];
      i++;
      while (i < lines.length && /^\|/.test(lines[i])) {
        tableLines.push(lines[i]);
        i++;
      }
      out.push(renderTable(tableLines));
      continue;
    }

    const ol = /^\s*\d+\.\s+(.*)$/.exec(line);
    const ul = /^\s*[-*]\s+(.*)$/.exec(line);
    if (ol || ul) {
      flushPara();
      const type = ol ? "ol" : "ul";
      if (!list || list.type !== type) {
        flushList();
        list = { type, items: [] };
      }
      list.items.push((ol ?? ul)[1]);
      i++;
      continue;
    }
    flushList();

    if (line.trim() === "") {
      flushPara();
      i++;
      continue;
    }

    para.push(line.trim());
    i++;
  }
  flushPara();
  flushList();
  return out.join("\n");
}

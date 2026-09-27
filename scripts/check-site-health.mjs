import { pathToFileURL } from "node:url";

const DEFAULT_BASE_URL = "https://www.posecode.org";

export async function checkSiteHealth({
  baseUrl = process.env.POSECODE_HEALTH_BASE_URL ?? DEFAULT_BASE_URL,
  fetchImpl = fetch,
} = {}) {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
  const checks = [
    { path: "/", includes: 'rel="canonical" href="https://www.posecode.org/"' },
    { path: "/play/superhero-landing", includes: "Posecode" },
    { path: "/robots.txt", includes: "Sitemap: https://www.posecode.org/sitemap.xml" },
    { path: "/sitemap.xml", includes: "https://www.posecode.org/for-products" },
  ];

  const results = await Promise.all(
    checks.map(async ({ path, includes }) => {
      const url = `${normalizedBaseUrl}${path}`;
      try {
        const response = await fetchImpl(url, {
          headers: { "user-agent": "posecode-health-check/1.0" },
          redirect: "follow",
          signal: AbortSignal.timeout(15_000),
        });
        const body = await response.text();
        const problems = [];

        if (!response.ok) problems.push(`HTTP ${response.status}`);
        if (!body.includes(includes)) problems.push(`missing expected marker: ${includes}`);
        if (path === "/sitemap.xml" && /<loc>https:\/\/posecode\.org\//.test(body)) {
          problems.push("sitemap contains non-www canonical URLs");
        }

        return { url, ok: problems.length === 0, problems };
      } catch (error) {
        return { url, ok: false, problems: [error instanceof Error ? error.message : String(error)] };
      }
    }),
  );

  return {
    ok: results.every((result) => result.ok),
    checkedAt: new Date().toISOString(),
    results,
  };
}

export function formatHealthReport(report) {
  const lines = [`Posecode production health: ${report.ok ? "OK" : "FAILED"}`, `Checked: ${report.checkedAt}`];
  for (const result of report.results) {
    lines.push(`${result.ok ? "✓" : "✗"} ${result.url}${result.ok ? "" : ` — ${result.problems.join("; ")}`}`);
  }
  return lines.join("\n");
}

async function sendTelegramAlert(message, fetchImpl = fetch) {
  const token = process.env.POSECODE_TELEGRAM_BOT_TOKEN;
  const chatId = process.env.POSECODE_TELEGRAM_CHAT_ID;
  if (!token || !chatId) return false;

  const response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: message, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Telegram alert failed with HTTP ${response.status}`);
  return true;
}

async function main() {
  const report = await checkSiteHealth();
  const message = formatHealthReport(report);
  console.log(message);

  if (!report.ok) {
    try {
      await sendTelegramAlert(message);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
    }
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

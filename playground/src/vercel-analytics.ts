import {
  inject,
  track,
  type BeforeSendEvent,
} from "@vercel/analytics";
import {
  configureUsageAnalytics,
  type UsageEventSink,
} from "./analytics.js";

/** Collapse public aliases and dynamic movement paths into bounded route names. */
export function analyticsRoute(pathname: string): string {
  if (/^\/(?:index\.html)?\/?$/.test(pathname)) return "/";
  if (/^\/play(?:\.html)?\/?$/.test(pathname)) return "/play";
  if (pathname.startsWith("/play/")) return "/play/[movement]";
  if (/^\/for-products(?:\.html)?\/?$/.test(pathname)) {
    return "/for-products";
  }
  return pathname;
}

/**
 * Page URLs can contain an encoded Posecode document in the hash. Redact all
 * query/hash data and normalize dynamic movement paths before Vercel sees it.
 */
export function redactAnalyticsUrl(
  event: BeforeSendEvent,
): BeforeSendEvent | null {
  try {
    const absolute = /^[a-z][a-z\d+.-]*:\/\//i.test(event.url);
    const url = new URL(event.url, "https://analytics.posecode.invalid");
    url.pathname = analyticsRoute(url.pathname);
    url.search = "";
    url.hash = "";
    return {
      ...event,
      url: absolute ? `${url.origin}${url.pathname}` : url.pathname,
    };
  } catch {
    // Fail closed rather than risk forwarding an unrecognized URL shape.
    return null;
  }
}

/**
 * Each HTML entry point records one pageview. The playground mutates history
 * as the source changes, so soft-navigation auto-tracking is disabled to avoid
 * treating edits as visits.
 */
export function initializeAnalytics(): void {
  inject({
    beforeSend: redactAnalyticsUrl,
    disableAutoTrack: true,
  });
  if (import.meta.env.VITE_PRODUCT_ANALYTICS_PROVIDER !== "vercel") return;
  configureUsageAnalytics(((name, properties) => {
    track(name, properties);
  }) as UsageEventSink);
}

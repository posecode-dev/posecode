import { inject, track } from "@vercel/analytics";
import {
  configureUsageAnalytics,
  type UsageEventSink,
} from "./analytics.js";

/**
 * Pageviews remain enabled exactly as before. Product events are opt-in because
 * Vercel Hobby accepts pageviews but does not expose custom events.
 */
export function initializeAnalytics(): void {
  inject();
  if (import.meta.env.VITE_PRODUCT_ANALYTICS_PROVIDER !== "vercel") return;
  configureUsageAnalytics(((name, properties) => {
    track(name, properties);
  }) as UsageEventSink);
}

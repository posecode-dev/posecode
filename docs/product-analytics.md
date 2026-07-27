# Product usage analytics

Posecode keeps Vercel pageviews and product-usage events separate. Pageviews
answer “which routes were visited?”; the events below answer “did someone use
the product?”

## Provider and production configuration

The implementation is provider-neutral at the call sites. Event names, payload
types, failure isolation, and session deduplication live in
`playground/src/analytics.ts`. The current adapter is
`playground/src/vercel-analytics.ts`.

Vercel Web Analytics pageviews remain enabled without extra configuration.
Vercel's current plan table says custom events are **not available on Hobby**;
they are available on Pro and Enterprise. Pro allows at most two properties per
custom event. The schema below deliberately stays within that limit.

To enable product events on a Vercel Pro or Enterprise production project:

1. Enable Web Analytics for the project in Vercel.
2. Set `VITE_PRODUCT_ANALYTICS_PROVIDER=vercel` for the Production environment.
3. Redeploy so Vite includes the provider choice in the client bundle.
4. Exercise one event and confirm it in **Project → Analytics → Events**.

Do not set the variable on Hobby expecting dashboard data: Hobby continues to
show pageviews but does not expose custom events. No alternate paid analytics
vendor is installed. A future adapter can call `configureUsageAnalytics`
without changing UI event call sites.

Sources:

- [Vercel custom events](https://vercel.com/docs/analytics/custom-events)
- [Vercel Web Analytics limits and pricing](https://vercel.com/docs/analytics/limits-and-pricing)

## Event dictionary

| Event | Fires when | Properties |
|---|---|---|
| `preset_opened` | A bundled movement is actually opened at initial load or selected in the library. | `source`: `library`, `direct_url`, `shared_link`, or `landing_cta`; `preset_id`: bundled stable ID |
| `editor_changed` | The first real CodeMirror user edit in the page session. Programmatic preset loads do not count. | `document_kind`: `preset`, `shared`, or `custom` |
| `render_succeeded` | `viewer.load()` successfully accepts a new meaningful document revision. Lazy boot and repeated recompiles of the same revision are deduplicated. The animation frame loop never emits this event. | `trigger`: `initial`, `preset_open`, `shared_link`, or `editor_change`; `document_kind` |
| `share_created` | The generated preset/encoded URL has successfully been written to the clipboard. | `share_kind`: `preset` or `encoded` |
| `embed_docs_clicked` | The embed documentation CTA on `/for-products` is clicked. | `location`: `for_products` |
| `install_command_copied` | An npm/npx command on `/for-products` is successfully written to the clipboard. | `command`: `embed`, `packages`, or `mcp`; `location`: `for_products` |

## Reading the dashboard

Open **Analytics → Events**, select an event, then drill into its properties.
Useful readings include:

- `preset_opened` grouped by `source` separates library discovery from direct,
  shared, and landing-page entry.
- Compare `editor_changed` and `render_succeeded` counts to see whether editing
  reaches a valid renderer update. They are intentionally not a strict funnel:
  initial and preset renders also count.
- `share_created` is a confirmed clipboard outcome, not a button-click count.
- Group `install_command_copied` by `command` to compare integration intent.

Vercel reports aggregate events rather than a user-level funnel. Do not attempt
to join individual visitors or reconstruct sessions from these payloads.

## Privacy and resilience

Events never contain Posecode source text, authoring prompts, personal data,
full share tokens, query strings, referrers, or sensitive URLs. `preset_id` is a
bounded public catalogue identifier; all other values are closed enums.

Every analytics call is best-effort and catches provider failures. Ad blockers,
network failures, a missing provider configuration, or plan limitations do not
change editing, rendering, sharing, navigation, or clipboard behavior.

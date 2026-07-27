/**
 * Provider-neutral product usage analytics.
 *
 * Event payloads intentionally contain only low-cardinality product metadata.
 * Never add Posecode source, share tokens, prompts, or URLs here.
 */

export const USAGE_EVENT_NAMES = {
  presetOpened: "preset_opened",
  editorChanged: "editor_changed",
  renderSucceeded: "render_succeeded",
  shareCreated: "share_created",
  embedDocsClicked: "embed_docs_clicked",
  installCommandCopied: "install_command_copied",
} as const;

export type PresetOpenSource =
  | "library"
  | "direct_url"
  | "shared_link"
  | "landing_cta";
export type DocumentKind = "preset" | "shared" | "custom";
export type RenderTrigger =
  | "initial"
  | "preset_open"
  | "shared_link"
  | "editor_change";
export type ShareKind = "preset" | "encoded";
export type InstallCommand = "embed" | "packages" | "mcp";

export interface UsageEventMap {
  preset_opened: { source: PresetOpenSource; preset_id: string };
  editor_changed: { document_kind: DocumentKind };
  render_succeeded: { trigger: RenderTrigger; document_kind: DocumentKind };
  share_created: { share_kind: ShareKind };
  embed_docs_clicked: { location: "for_products" };
  install_command_copied: {
    command: InstallCommand;
    location: "for_products";
  };
}

export type UsageEventName = keyof UsageEventMap;
export type UsageEventSink = <Name extends UsageEventName>(
  name: Name,
  properties: UsageEventMap[Name],
) => void;

let sink: UsageEventSink | null = null;

export function configureUsageAnalytics(nextSink: UsageEventSink | null): void {
  sink = nextSink;
}

export function trackUsageEvent<Name extends UsageEventName>(
  name: Name,
  properties: UsageEventMap[Name],
): void {
  try {
    sink?.(name, properties);
  } catch {
    // Analytics must never interrupt the product interaction being measured.
  }
}

/**
 * Per-page-session noise control. Internal revision keys are never sent to the
 * provider; they only prevent duplicate render events during lazy boot/reparse.
 */
export class UsageSession {
  private firstEditTracked = false;
  private renderedRevisions = new Set<number>();

  trackFirstEdit(documentKind: DocumentKind): void {
    if (this.firstEditTracked) return;
    this.firstEditTracked = true;
    trackUsageEvent(USAGE_EVENT_NAMES.editorChanged, {
      document_kind: documentKind,
    });
  }

  trackSuccessfulRender(
    revision: number,
    trigger: RenderTrigger,
    documentKind: DocumentKind,
  ): void {
    if (this.renderedRevisions.has(revision)) return;
    this.renderedRevisions.add(revision);
    trackUsageEvent(USAGE_EVENT_NAMES.renderSucceeded, {
      trigger,
      document_kind: documentKind,
    });
  }
}

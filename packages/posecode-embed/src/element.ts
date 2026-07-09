/**
 * `<posecode-player>`: a self-contained custom element that renders a Posecode
 * movement as a live 3D figure. Drop it on any page; give it a movement via a
 * `doc` token, a `src` URL, or inline text.
 *
 * Design notes:
 * - **Lazy boot.** three.js is heavy, so the WebGL viewer is created only when
 *   the element scrolls into view (IntersectionObserver): many embeds on one
 *   page stay cheap until seen.
 * - **Shadow DOM.** Markup + styles are isolated from the host page.
 * - **Accessible & polite.** Honors `prefers-reduced-motion` (no autoplay, no
 *   camera orbit), exposes a labelled play/pause control, and cleans up its
 *   render loop on disconnect.
 * - **Never blank.** Parse/load failures render a readable message, not an
 *   empty canvas.
 */

import { parse } from "posecode-parser";
import { encodePosecode } from "posecode-share";
import type { Viewer } from "posecode-render";
import { parseOptions, type PlayerOptions } from "./options.js";
import { resolveSource } from "./source.js";
import { PLAYER_CSS } from "./styles.js";

const PLAY = "▶";
const PAUSE = "❚❚";

/** Where the "open in playground" link points; overridable per element. */
const DEFAULT_PLAYGROUND = "https://posecode.org/play";

export class PosecodePlayerElement extends HTMLElement {
  static readonly tagName = "posecode-player";

  #viewer: Viewer | null = null;
  #io: IntersectionObserver | null = null;
  #booted = false;
  #root: ShadowRoot;
  #canvas!: HTMLCanvasElement;
  #playBtn!: HTMLButtonElement;
  #phaseEl!: HTMLElement;
  #source = "";

  constructor() {
    super();
    this.#root = this.attachShadow({ mode: "open" });
  }

  connectedCallback(): void {
    // Capture inline text BEFORE we replace the light DOM with shadow markup.
    this.#source = this.textContent ?? "";
    this.#renderChrome();
    // Boot immediately UNLESS the element is measurably off-screen, in which
    // case defer the heavy renderer until it scrolls into view. The bias is
    // toward booting: an embed must never stay blank because we couldn't
    // measure the viewport (e.g. innerHeight reported as 0) or because the
    // observer never fires. Deferral is a pure optimization, not correctness.
    if (this.#shouldDefer()) {
      this.#io = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) void this.#boot();
      });
      this.#io.observe(this);
    } else {
      void this.#boot();
    }
  }

  /** Only defer when we can prove the element is fully outside the viewport. */
  #shouldDefer(): boolean {
    if (typeof IntersectionObserver !== "function") return false;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    if (!vh || !vw) return false; // can't measure → boot now
    const r = this.getBoundingClientRect();
    return r.top > vh || r.bottom < 0 || r.left > vw || r.right < 0;
  }

  disconnectedCallback(): void {
    this.#io?.disconnect();
    this.#io = null;
    this.#viewer?.dispose();
    this.#viewer = null;
    this.#booted = false;
  }

  /**
   * The underlying render viewer, or `null` until the element has booted.
   * Exposed for programmatic control (pause/seek all embeds on a page, sync
   * playback, capture a frame) and for testing.
   */
  get viewer(): Viewer | null {
    return this.#viewer;
  }

  /** Toggle playback; no-op until the viewer has booted. */
  toggle(): void {
    if (!this.#viewer) return;
    const playing = this.#viewer.toggle();
    this.#reflectPlaying(playing);
  }

  #options(): PlayerOptions {
    return parseOptions({
      autoplay: this.getAttribute("autoplay"),
      loop: this.getAttribute("loop"),
      controls: this.getAttribute("controls"),
      autorotate: this.getAttribute("autorotate"),
      speed: this.getAttribute("speed"),
      character: this.getAttribute("character"),
    });
  }

  #renderChrome(): void {
    const opts = this.#options();
    const style = document.createElement("style");
    style.textContent = PLAYER_CSS;

    this.#canvas = document.createElement("canvas");

    this.#playBtn = document.createElement("button");
    this.#playBtn.className = "play";
    this.#playBtn.textContent = PLAY;
    this.#playBtn.setAttribute("aria-label", "Play or pause");
    this.#playBtn.addEventListener("click", () => this.toggle());

    this.#phaseEl = document.createElement("span");
    this.#phaseEl.className = "phase";

    const link = document.createElement("a");
    link.className = "link";
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "Edit ↗";
    link.href = this.#playgroundUrl();

    const bar = document.createElement("div");
    bar.className = opts.controls ? "bar" : "bar";
    if (!opts.controls) bar.style.display = "none";
    bar.append(this.#playBtn, this.#phaseEl, link);

    this.#root.replaceChildren(style, this.#canvas, bar);
  }

  #playgroundUrl(): string {
    const base = this.getAttribute("playground") ?? DEFAULT_PLAYGROUND;
    if (!this.#source.trim()) return base;
    try {
      return `${base}#doc=${encodePosecode(this.#source.trim())}`;
    } catch {
      return base;
    }
  }

  async #boot(): Promise<void> {
    if (this.#booted) return;
    this.#booted = true;
    this.#io?.disconnect();

    const resolved = await resolveSource({
      doc: this.getAttribute("doc"),
      src: this.getAttribute("src"),
      text: this.#source,
    });
    if (!resolved.ok) return this.#showMessage(resolved.error, true);

    // Keep the resolved source so the "Edit" link matches what's rendered.
    this.#source = resolved.source;
    const { ir, errors } = parse(resolved.source);
    if (!ir || errors.length > 0) {
      const detail = errors[0] ? `${errors[0].message} (line ${errors[0].line})` : "";
      return this.#showMessage(`Couldn't parse this movement. ${detail}`.trim(), true);
    }

    const opts = this.#options();
    const reduceMotion =
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Lazy-import the heavy renderer only once we actually have work to show.
    const { createViewer } = await import("posecode-render");
    const viewer = createViewer(this.#canvas, {
      autoRotate: opts.autoRotate && !reduceMotion,
      ...(opts.characterUrl ? { characterUrl: opts.characterUrl } : {}),
    });
    this.#viewer = viewer;
    viewer.onPhase(({ phaseName }) => {
      this.#phaseEl.textContent = phaseName === "reset" ? "" : phaseName;
    });
    viewer.load(ir);
    viewer.setLoop(opts.loop);
    viewer.setSpeed(opts.speed);

    const shouldPlay = opts.autoplay && !reduceMotion;
    if (shouldPlay) viewer.play();
    this.#reflectPlaying(shouldPlay);

    // Update the Edit link now that we know the real source.
    const link = this.#root.querySelector("a.link") as HTMLAnchorElement | null;
    if (link) link.href = this.#playgroundUrl();

    this.dispatchEvent(new CustomEvent("posecode:ready", { bubbles: true }));
  }

  #reflectPlaying(playing: boolean): void {
    this.#playBtn.textContent = playing ? PAUSE : PLAY;
  }

  #showMessage(text: string, isError: boolean): void {
    const msg = document.createElement("div");
    msg.className = isError ? "msg error" : "msg";
    msg.textContent = text;
    this.#root.append(msg);
    if (isError) {
      this.dispatchEvent(
        new CustomEvent("posecode:error", { bubbles: true, detail: { error: text } }),
      );
    }
  }
}

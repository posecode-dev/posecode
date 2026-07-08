/**
 * Shadow-DOM styles for the player. Scoped to the shadow root so an embed can
 * never leak styles into (or inherit surprises from) the host page. Colors
 * mirror the playground's studio-dark + lime theme but are self-contained.
 */

export const PLAYER_CSS = `
  :host {
    display: block;
    position: relative;
    width: 100%;
    aspect-ratio: 4 / 3;
    min-height: 220px;
    border-radius: 12px;
    overflow: hidden;
    background: #0c0f15;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    color: #e7ecf3;
  }
  :host([hidden]) { display: none; }
  canvas { display: block; width: 100%; height: 100%; }

  .bar {
    position: absolute;
    left: 0; right: 0; bottom: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    background: linear-gradient(to top, rgba(6, 8, 12, 0.85), transparent);
    opacity: 0;
    transition: opacity 0.18s ease;
    pointer-events: none;
  }
  :host(:hover) .bar, .bar.pinned { opacity: 1; pointer-events: auto; }

  button.play {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 34px; height: 34px;
    border: none;
    border-radius: 999px;
    background: #c6f24e;
    color: #0c0f15;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
  }
  button.play:focus-visible { outline: 2px solid #c6f24e; outline-offset: 2px; }

  .phase {
    flex: 1;
    min-width: 0;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.02em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: #c6f24e;
  }

  .link {
    font-size: 11px;
    color: #9aa4b2;
    text-decoration: none;
  }
  .link:hover { color: #e7ecf3; }

  .msg {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    text-align: center;
    font-size: 13px;
    line-height: 1.4;
    color: #9aa4b2;
  }
  .msg code { color: #e7ecf3; font-family: ui-monospace, monospace; }
  .msg.error { color: #ff9d9d; }
`;

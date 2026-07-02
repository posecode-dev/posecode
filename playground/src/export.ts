/**
 * GIF / video export for the playground viewer.
 *
 * Two paths, chosen for what each format is for:
 *
 * - **Video (.webm)** — records the live canvas in real time with the native
 *   MediaRecorder (no encoder dependency), so it captures exactly what the
 *   viewer shows: aliveness, camera orbit, current speed. One full loop.
 * - **GIF** — rendered DETERMINISTICALLY: the exporter seeks frame times one
 *   by one (`seek(t); renderOnce()`) and encodes the pixels with gifenc, so
 *   the result is a crisp, perfectly-looping clip independent of machine
 *   speed — the "paste it anywhere" format.
 *
 * Both composite the WebGL frame onto a 2D canvas with a caption band (phase
 * name + coaching cue + movement name) — a shared clip without the cue would
 * lose the instruction, which is the point of Movit.
 */

import type { Viewer } from "movit-render";
import { GIFEncoder, quantize, applyPalette } from "gifenc";

export interface ExportContext {
  viewer: Viewer;
  glCanvas: HTMLCanvasElement;
  /** Movement display name — used for the file name and the caption band. */
  name: () => string;
  /** Current phase + cue as shown in the HUD. */
  caption: () => { phase: string; cue: string };
  onProgress: (label: string | null) => void;
}

/** Compose the current WebGL frame + caption band into `ctx`. */
function compose(
  ctx: CanvasRenderingContext2D,
  ectx: ExportContext,
  w: number,
  h: number,
  band: number,
): void {
  ctx.drawImage(ectx.glCanvas, 0, 0, w, h - band);
  // Caption band.
  ctx.fillStyle = "#0c0f15";
  ctx.fillRect(0, h - band, w, band);
  const { phase, cue } = ectx.caption();
  const pad = Math.round(band * 0.22);
  ctx.textBaseline = "top";
  ctx.fillStyle = "#c6f24a";
  ctx.font = `700 ${Math.round(band * 0.3)}px system-ui, sans-serif`;
  ctx.fillText(phase || ectx.name(), pad, h - band + pad, w - pad * 2);
  ctx.fillStyle = "#aab4c3";
  ctx.font = `400 ${Math.round(band * 0.24)}px system-ui, sans-serif`;
  ctx.fillText(cue, pad, h - band + pad + Math.round(band * 0.38), w - pad * 2);
  // Watermark-ish corner mark so shared clips lead back to the tool.
  ctx.fillStyle = "#5b6472";
  ctx.font = `600 ${Math.round(band * 0.2)}px system-ui, sans-serif`;
  const mark = "movit";
  const mw = ctx.measureText(mark).width;
  ctx.fillText(mark, w - pad - mw, h - band + pad, mw + 4);
}

function download(blob: Blob, filename: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
}

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "movement"
  );
}

/** Snapshot of viewer state to restore after an export session. */
function restorePoint(viewer: Viewer): () => void {
  const t = viewer.time;
  const wasPlaying = viewer.playing;
  return () => {
    viewer.seek(t);
    if (wasPlaying) viewer.play();
    else viewer.pause();
  };
}

/**
 * Record one full loop of the movement as a WebM video.
 * Real-time capture: what you see (speed, camera, aliveness) is what you get.
 */
export async function exportVideo(ectx: ExportContext): Promise<void> {
  const { viewer } = ectx;
  const duration = viewer.duration;
  if (duration <= 0) return;

  const w = ectx.glCanvas.width;
  const h0 = ectx.glCanvas.height;
  const band = Math.max(56, Math.round(h0 * 0.14));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h0 + band;
  const ctx = canvas.getContext("2d")!;

  const mime =
    ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((m) =>
      MediaRecorder.isTypeSupported(m),
    ) ?? "";
  const stream = canvas.captureStream(30);
  const rec = new MediaRecorder(stream, {
    ...(mime ? { mimeType: mime } : {}),
    videoBitsPerSecond: 6_000_000,
  });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  const stopped = new Promise<void>((res, rej) => {
    rec.onstop = () => res();
    rec.onerror = (e) => rej((e as ErrorEvent).error ?? new Error("MediaRecorder failed"));
  });

  const restore = restorePoint(viewer);
  // Freeze the idle orbit so the clip's first and last frames share one camera
  // angle — a looping replay doesn't jump. The user's chosen angle is kept.
  const hadAutoRotate = viewer.setAutoRotate(false);
  let raf = 0;
  try {
    viewer.seek(0);
    viewer.play();

    const paint = (): void => {
      compose(ctx, ectx, canvas.width, canvas.height, band);
      raf = requestAnimationFrame(paint);
    };
    raf = requestAnimationFrame(paint);
    rec.start(250);

    // Record exactly one pass. Playback rate isn't exposed on the API, so
    // watch the clock: a wrap (time jumps back) ends a looping pass, playback
    // stopping ends a non-looping one, and a generous hard cap (covers 0.5×
    // speed) guards against both signals being missed.
    await new Promise<void>((res, rej) => {
      stopped.catch(rej); // surface recorder errors while we wait
      const t0 = performance.now();
      let prevTime = viewer.time;
      const tick = (): void => {
        const elapsed = (performance.now() - t0) / 1000;
        ectx.onProgress(`recording ${Math.min(100, Math.round((viewer.time / duration) * 100))}%`);
        const wrapped = viewer.time < prevTime - 1e-3;
        const ended = elapsed > 0.5 && !viewer.playing;
        prevTime = viewer.time;
        if (wrapped || ended || elapsed > duration * 2.5 + 3) res();
        else setTimeout(tick, 60);
      };
      tick();
    });

    if (rec.state !== "inactive") rec.stop();
    await stopped;
  } finally {
    cancelAnimationFrame(raf);
    if (rec.state !== "inactive") {
      try {
        rec.stop();
      } catch {
        /* already stopped */
      }
    }
    viewer.setAutoRotate(hadAutoRotate);
    restore();
    ectx.onProgress(null);
  }
  download(new Blob(chunks, { type: mime || "video/webm" }), `${slug(ectx.name())}.webm`);
}

/**
 * Encode one full loop as a GIF, frame by frame, deterministically.
 * Adaptive size/rate so long movements stay a sane file size.
 */
export async function exportGif(ectx: ExportContext): Promise<void> {
  const { viewer } = ectx;
  const duration = viewer.duration;
  if (duration <= 0) return;

  const fps = duration > 10 ? 10 : 15;
  const outW = duration > 10 ? 384 : 480;
  const scale = outW / ectx.glCanvas.width;
  const bodyH = Math.round(ectx.glCanvas.height * scale);
  const band = Math.max(40, Math.round(bodyH * 0.16));
  const outH = bodyH + band;

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

  const frames = Math.max(2, Math.round(duration * fps));
  const gif = GIFEncoder();
  const restore = restorePoint(viewer);
  // Freeze the idle orbit: frames are captured over encode time, not movement
  // time, so a live orbit would swing at an arbitrary rate AND leave the last
  // frame at a different angle than the first — a visible jump on every loop.
  const hadAutoRotate = viewer.setAutoRotate(false);
  try {
    viewer.pause();

    let palette: number[][] | null = null;
    for (let i = 0; i < frames; i++) {
      viewer.seek((i / frames) * duration);
      viewer.renderOnce();
      compose(ctx, ectx, outW, outH, band);
      const { data } = ctx.getImageData(0, 0, outW, outH);
      // One global palette from the first frame keeps files small; the studio
      // scene's colors are stable across a loop, so it stays accurate.
      if (!palette) palette = quantize(data, 256);
      gif.writeFrame(applyPalette(data, palette), outW, outH, {
        palette,
        delay: Math.round(1000 / fps),
      });
      if (i % 5 === 0) {
        ectx.onProgress(`GIF ${Math.round((i / frames) * 100)}%`);
        await new Promise((r) => setTimeout(r)); // keep the UI responsive
      }
    }
    gif.finish();
  } finally {
    viewer.setAutoRotate(hadAutoRotate);
    restore();
    ectx.onProgress(null);
  }
  // slice() = exact-size copy with a plain ArrayBuffer (bytes() may be a
  // subarray view over a larger internal buffer).
  const bytes = gif.bytes().slice();
  download(new Blob([bytes.buffer as ArrayBuffer], { type: "image/gif" }), `${slug(ectx.name())}.gif`);
}

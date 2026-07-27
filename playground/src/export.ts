import type { Viewer } from "posecode-render";
import { GIFEncoder, applyPalette, quantize } from "gifenc";

export interface ExportContext {
  viewer: Viewer;
  sourceCanvas: HTMLCanvasElement;
  name: () => string;
  caption: () => { phase: string; cue: string };
  onProgress: (label: string | null) => void;
}

function compose(
  ctx: CanvasRenderingContext2D,
  ectx: ExportContext,
  width: number,
  height: number,
  band: number,
): void {
  // captureFrame renders synchronously. Copying the WebGL canvas in the same
  // task keeps the pixels readable without preserveDrawingBuffer.
  ectx.viewer.captureFrame();
  ctx.drawImage(ectx.sourceCanvas, 0, 0, width, height - band);
  ctx.fillStyle = "#0e1011";
  ctx.fillRect(0, height - band, width, band);

  const { phase, cue } = ectx.caption();
  const pad = Math.round(band * 0.22);
  ctx.textBaseline = "top";
  ctx.fillStyle = "#d4ff3f";
  ctx.font = `700 ${Math.round(band * 0.3)}px system-ui, sans-serif`;
  ctx.fillText(phase || ectx.name(), pad, height - band + pad, width - pad * 2);
  ctx.fillStyle = "#aaa9a2";
  ctx.font = `400 ${Math.round(band * 0.24)}px system-ui, sans-serif`;
  ctx.fillText(
    cue,
    pad,
    height - band + pad + Math.round(band * 0.38),
    width - pad * 2,
  );

  ctx.fillStyle = "#74746f";
  ctx.font = `600 ${Math.round(band * 0.2)}px system-ui, sans-serif`;
  const mark = "posecode";
  const markWidth = ctx.measureText(mark).width;
  ctx.fillText(mark, width - pad - markWidth, height - band + pad);
}

function download(blob: Blob, filename: string): void {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 30_000);
}

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "movement"
  );
}

function restorePoint(viewer: Viewer): () => void {
  const time = viewer.time;
  const wasPlaying = viewer.playing;
  return () => {
    viewer.seek(time);
    if (wasPlaying) viewer.play();
    else viewer.pause();
  };
}

export async function exportVideo(ectx: ExportContext): Promise<void> {
  const { viewer } = ectx;
  const duration = viewer.duration;
  if (duration <= 0) return;
  if (typeof MediaRecorder === "undefined") {
    throw new Error("Video export is not supported in this browser");
  }

  const width = Math.max(1, ectx.sourceCanvas.width);
  const bodyHeight = Math.max(1, ectx.sourceCanvas.height);
  const band = Math.max(56, Math.round(bodyHeight * 0.14));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = bodyHeight + band;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create the export canvas");

  const mime =
    ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((type) =>
      MediaRecorder.isTypeSupported(type),
    ) ?? "";
  const recorder = new MediaRecorder(canvas.captureStream(30), {
    ...(mime ? { mimeType: mime } : {}),
    videoBitsPerSecond: 6_000_000,
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  const stopped = new Promise<void>((resolve, reject) => {
    recorder.onstop = () => resolve();
    recorder.onerror = (event) =>
      reject((event as ErrorEvent).error ?? new Error("Video export failed"));
  });

  const restore = restorePoint(viewer);
  let animationFrame = 0;
  try {
    viewer.seek(0);
    viewer.play();
    const paint = (): void => {
      compose(ctx, ectx, canvas.width, canvas.height, band);
      animationFrame = requestAnimationFrame(paint);
    };
    paint();
    recorder.start(250);

    await new Promise<void>((resolve, reject) => {
      stopped.catch(reject);
      const startedAt = performance.now();
      let previousTime = viewer.time;
      const tick = (): void => {
        const elapsed = (performance.now() - startedAt) / 1000;
        ectx.onProgress(
          `video ${Math.min(100, Math.round((viewer.time / duration) * 100))}%`,
        );
        const wrapped = viewer.time < previousTime - 1e-3;
        const ended = elapsed > 0.5 && !viewer.playing;
        previousTime = viewer.time;
        if (wrapped || ended || elapsed > duration * 2.5 + 3) resolve();
        else window.setTimeout(tick, 60);
      };
      tick();
    });

    if (recorder.state !== "inactive") recorder.stop();
    await stopped;
  } finally {
    cancelAnimationFrame(animationFrame);
    if (recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        // The recorder may have stopped between the state check and this call.
      }
    }
    restore();
    ectx.onProgress(null);
  }

  download(
    new Blob(chunks, { type: mime || "video/webm" }),
    `${slug(ectx.name())}.webm`,
  );
}

export async function exportGif(ectx: ExportContext): Promise<void> {
  const { viewer } = ectx;
  const duration = viewer.duration;
  if (duration <= 0) return;

  const fps = duration > 10 ? 10 : 15;
  const width = duration > 10 ? 384 : 480;
  const scale = width / Math.max(1, ectx.sourceCanvas.width);
  const bodyHeight = Math.max(1, Math.round(ectx.sourceCanvas.height * scale));
  const band = Math.max(40, Math.round(bodyHeight * 0.16));
  const height = bodyHeight + band;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Could not create the export canvas");

  const frameCount = Math.max(2, Math.round(duration * fps));
  const gif = GIFEncoder();
  const restore = restorePoint(viewer);
  try {
    viewer.pause();
    let palette: number[][] | null = null;
    for (let index = 0; index < frameCount; index++) {
      viewer.seek((index / frameCount) * duration);
      compose(ctx, ectx, width, height, band);
      const { data } = ctx.getImageData(0, 0, width, height);
      if (!palette) palette = quantize(data, 256);
      gif.writeFrame(applyPalette(data, palette), width, height, {
        palette,
        delay: Math.round(1000 / fps),
      });
      if (index % 5 === 0) {
        ectx.onProgress(`GIF ${Math.round((index / frameCount) * 100)}%`);
        await new Promise((resolve) => window.setTimeout(resolve));
      }
    }
    gif.finish();
  } finally {
    restore();
    ectx.onProgress(null);
  }

  const bytes = gif.bytes().slice();
  download(
    new Blob([bytes.buffer as ArrayBuffer], { type: "image/gif" }),
    `${slug(ectx.name())}.gif`,
  );
}

import { Frame } from "@/lib/types";

/**
 * Export the clip with the overlay burnt in. The video plays through once at `rate` while every
 * presented frame is drawn (video + overlay) onto a canvas that a MediaRecorder captures. Playing
 * instead of seeking keeps decode real-time, so timing in the file matches playback speed.
 */

export type ExportOptions = {
  video: HTMLVideoElement;
  fps: number;
  /** Playback speed baked into the file (0.25 gives a slow-motion export). */
  rate: number;
  frames: Frame[];
  /** Draw the overlay for frame `index` onto `ctx` (video already drawn). */
  drawOverlay: (ctx: CanvasRenderingContext2D, index: number) => void;
  onProgress?: (fraction: number, index: number) => void;
  signal?: AbortSignal;
};

const MIME_CANDIDATES = [
  "video/mp4;codecs=avc1.640028",
  "video/mp4;codecs=avc1",
  "video/mp4",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
];

export function pickMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? null;
}

export function canExport(): boolean {
  return pickMimeType() !== null && typeof HTMLCanvasElement.prototype.captureStream === "function";
}

function once<K extends keyof HTMLMediaElementEventMap>(el: HTMLMediaElement, ev: K): Promise<void> {
  return new Promise((resolve) => el.addEventListener(ev, () => resolve(), { once: true }));
}

export async function exportVideo(o: ExportOptions): Promise<{ blob: Blob; ext: string }> {
  const { video, fps, rate, frames, drawOverlay, onProgress, signal } = o;
  const mime = pickMimeType();
  if (!mime) throw new Error("This browser cannot record video (no MediaRecorder support).");
  // Hidden tabs stop presenting video frames, which would leave the recording mostly static.
  if (document.visibilityState === "hidden") throw new Error("Keep this tab visible while exporting.");
  const w = video.videoWidth;
  const h = video.videoHeight;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D unavailable.");

  const stream = canvas.captureStream();
  const recorder = new MediaRecorder(stream, {
    mimeType: mime,
    videoBitsPerSecond: Math.min(40e6, Math.round(w * h * Math.min(fps, 60) * 0.1)),
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
    recorder.onerror = () => resolve();
  });

  const prev = { t: video.currentTime, rate: video.playbackRate, loop: video.loop, paused: video.paused };
  video.pause();
  video.loop = false;
  video.playbackRate = rate;
  video.currentTime = 0;
  await once(video, "seeked");

  // Progress goes to React state, which re-renders the page and the on-screen overlay; doing that
  // on every captured frame competes with the capture itself for the main thread, so it is throttled.
  let lastProgress = -Infinity;
  const report = (mediaTime: number, idx: number, force = false) => {
    const now = performance.now();
    if (!force && now - lastProgress < 100) return;
    lastProgress = now;
    onProgress?.(video.duration ? mediaTime / video.duration : 0, idx);
  };
  const paint = (mediaTime: number, force = false) => {
    const idx = Math.max(0, Math.min(frames.length - 1, Math.round(mediaTime * fps)));
    ctx.drawImage(video, 0, 0, w, h);
    drawOverlay(ctx, idx);
    report(mediaTime, idx, force);
  };
  paint(0, true);

  let aborted = false;
  // Set once recording is over: frame callbacks queued earlier can still fire afterwards (restoring
  // the playhead presents a frame), and must not paint or report progress any more.
  let done = false;
  const onAbort = () => {
    aborted = true;
    video.pause();
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  // Browsers (and the host app) can pause a playing video behind our back, e.g. when the tab is
  // hidden or resized. Resume rather than hang.
  const onPause = () => {
    if (!aborted && !video.ended) video.play().catch(() => {});
  };
  video.addEventListener("pause", onPause);

  recorder.start(200);
  const ended = once(video, "ended");
  const rvfc = (video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number })
    .requestVideoFrameCallback;
  let lastPaint = performance.now();
  let lastTime = -1;
  const paintAt = (mediaTime: number) => {
    if (done || mediaTime === lastTime) return;
    lastTime = mediaTime;
    lastPaint = performance.now();
    paint(mediaTime);
  };
  if (rvfc) {
    const tick = (_now: number, meta: { mediaTime: number }) => {
      if (done || aborted || video.ended) return;
      paintAt(meta.mediaTime);
      rvfc.call(video, tick);
    };
    rvfc.call(video, tick);
  } else {
    const tick = () => {
      if (done || aborted || video.ended) return;
      paintAt(video.currentTime);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  // Safety net when frame callbacks stall (tab briefly hidden, heavy load): paint from the clock.
  const fallback = window.setInterval(() => {
    if (aborted || video.ended || video.paused) return;
    if (performance.now() - lastPaint > 80) paintAt(video.currentTime);
  }, 1000 / Math.min(fps, 60));
  await video.play();
  // Deadline: the clip's wall-clock length at this rate, plus slack, in case `ended` never fires.
  const deadlineMs = ((video.duration || 10) / rate) * 1000 * 1.5 + 3000;
  await Promise.race([
    ended,
    new Promise<void>((r) => signal?.addEventListener("abort", () => r(), { once: true })),
    new Promise<void>((r) => setTimeout(r, deadlineMs)),
  ]);
  window.clearInterval(fallback);
  video.removeEventListener("pause", onPause);
  video.pause();
  // Make sure the final frame is in the recording before stopping.
  if (!aborted) paint(video.duration, true);
  done = true;
  await new Promise((r) => setTimeout(r, 250));
  if (recorder.state !== "inactive") recorder.stop();
  await Promise.race([stopped, new Promise<void>((r) => setTimeout(r, 3000))]);
  signal?.removeEventListener("abort", onAbort);

  video.loop = prev.loop;
  video.playbackRate = prev.rate;
  video.currentTime = prev.t;

  if (aborted) throw new DOMException("Export cancelled", "AbortError");
  const ext = mime.startsWith("video/mp4") ? "mp4" : "webm";
  return { blob: new Blob(chunks, { type: mime.split(";")[0] }), ext };
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

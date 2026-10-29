import { ClubMark, Frame, LM, Pt, Shaft } from "@/lib/types";
import { hands, torsoLen } from "@/lib/geometry";
import { acceptRay, scanRays } from "@/lib/ridge";

/**
 * Club shaft from the video pixels, no model. The shaft is a thin straight line that starts at
 * the hands, so each frame is a radial scan: for every direction from the hand centre, walk a
 * ray and sum the "ridge" response (how much brighter or darker the pixel on the ray is than
 * the pixels either side of it). The best direction with a long enough consistent ridge is
 * the shaft; the ridge dying out marks the clubhead. Directions along either forearm are
 * ignored, since arms are lines from the hands too.
 *
 * It runs on a downscaled square crop around the hands during analysis, so it costs far less
 * than the pose model. It fails on motion blur (60 fps phone clips through the downswing) and
 * when the shaft points at the camera; a hand-placed mark on a frame always wins over it.
 */

/** Crop side in pixels after downscaling. */
const S = 176;
/** Crop half-size in torso lengths: a shaft is 2 to 2.5 torsos from the hands. */
const REACH = 2.9;
const ANGLE_STEP = 1.5;
/** Ridge sampling offset either side of the ray, crop pixels. */
const D = 2;
/** Ignore directions within this many degrees of a forearm. */
const ARM_EXCLUDE = 16;
/** A ridge shorter than this fraction of the crop radius is not a shaft. */
const LEN_MIN = 0.22;

let canvas: HTMLCanvasElement | null = null;

function cropCanvas(): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null;
  canvas ??= document.createElement("canvas");
  return canvas.getContext("2d", { willReadFrequently: true });
}

/**
 * Detect the shaft on the current frame of `video` given that frame's pose. `prev` is the last
 * frame's detection, used as a soft continuity prior. Returns the clubhead in normalised image
 * coordinates with a quality score (how far the line stands out from the other directions), or null when nothing line-like
 * leaves the hands.
 */
export function detectShaft(video: HTMLVideoElement, lm: Pt[], prev: Shaft | null | undefined): Shaft | null {
  const W = video.videoWidth;
  const H = video.videoHeight;
  if (!W || !H) return null;
  const ctx = cropCanvas();
  if (!ctx) return null;

  const h = hands(lm);
  const hx = h.x * W;
  const hy = h.y * H;
  const R = Math.max(80, Math.min(Math.max(W, H) * 0.6, torsoLen(lm) * H * REACH));
  const x0 = Math.max(0, Math.floor(hx - R));
  const y0 = Math.max(0, Math.floor(hy - R));
  const x1 = Math.min(W, Math.ceil(hx + R));
  const y1 = Math.min(H, Math.ceil(hy + R));
  if (x1 - x0 < 16 || y1 - y0 < 16) return null;
  const s = S / (2 * R);
  const cw = Math.max(2, Math.round((x1 - x0) * s));
  const ch = Math.max(2, Math.round((y1 - y0) * s));
  canvas!.width = cw;
  canvas!.height = ch;
  try {
    ctx.drawImage(video, x0, y0, x1 - x0, y1 - y0, 0, 0, cw, ch);
  } catch {
    return null;
  }
  const { data } = ctx.getImageData(0, 0, cw, ch);
  const lum = new Float32Array(cw * ch);
  for (let i = 0; i < cw * ch; i++) lum[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];

  // Hand centre in crop coordinates, and the forearm directions to ignore (both ways: a ray from
  // the hands runs back up the forearm toward the elbow).
  const ox = (hx - x0) * s;
  const oy = (hy - y0) * s;
  const exclude: number[] = [];
  for (const [e, w] of [
    [LM.leftElbow, LM.leftWrist],
    [LM.rightElbow, LM.rightWrist],
  ] as const) {
    const dx = (lm[w].x - lm[e].x) * W;
    const dy = (lm[w].y - lm[e].y) * H;
    if (Math.hypot(dx, dy) < 1) continue;
    exclude.push((Math.atan2(dy, dx) * 180) / Math.PI, (Math.atan2(-dy, -dx) * 180) / Math.PI);
  }
  const prior = prev ? (Math.atan2((prev.y - h.y) * H, (prev.x - h.x) * W) * 180) / Math.PI : null;

  const Rs = S / 2;
  const best = scanRays(lum, cw, ch, ox, oy, {
    d: D,
    step: ANGLE_STEP,
    exclude,
    excludeHalfWidth: ARM_EXCLUDE,
    prior,
    r0: Math.max(3, Rs * 0.08),
    rMax: Rs,
    minLen: Rs * LEN_MIN,
  });
  if (!acceptRay(best)) return null;
  const th = (best.deg * Math.PI) / 180;
  const lenPx = best.len / s;
  return { x: (hx + Math.cos(th) * lenPx) / W, y: (hy + Math.sin(th) * lenPx) / H, score: Math.round(best.ratio * 10) / 10 };
}

export type ResolvedShaft = { x: number; y: number; source: "mark" | "auto" };

/** The shaft to use for a frame: a hand-placed mark on that frame, else the automatic detection. */
export function shaftAt(frame: Frame | undefined, marks: ClubMark[]): ResolvedShaft | null {
  if (!frame) return null;
  const m = marks.find((k) => k.frame === frame.index);
  if (m) return { x: m.x, y: m.y, source: "mark" };
  if (frame.shaft) return { x: frame.shaft.x, y: frame.shaft.y, source: "auto" };
  return null;
}

/** How many frames have a shaft from either source. */
export function shaftCoverage(frames: Frame[], marks: ClubMark[]): { auto: number; marks: number } {
  return { auto: frames.filter((f) => f.shaft).length, marks: marks.length };
}

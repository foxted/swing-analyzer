import { ClubMark, Frame, LM, Pt, Shaft } from "@/lib/types";
import { hands, hipMid, median, shoulderMid, torsoLen } from "@/lib/geometry";
import { findLines, ridgeMaps, trackLines } from "@/lib/ridge";

/**
 * Club shaft from the video pixels, no model. The shaft is a thin straight line that starts at
 * the hands, so each frame is a search for thin lines passing close to the hand centre (see
 * ridge.ts). Thin is the point: the detector works at a resolution where the shaft is one to two
 * pixels wide and only counts pixels that differ from both sides, so arms, legs and the body
 * outline, which are lines from the hands too, do not respond.
 *
 * A single frame cannot tell the shaft from a seam on a shirt, so each frame only yields
 * candidates. Once the clip is analysed `trackShafts` picks at most one per frame so the choices
 * move the way a club does; a line that appears on one frame and nowhere near it on the next is
 * dropped unless it is unmistakable.
 *
 * It fails on motion blur (60 fps phone clips through the downswing) and when the shaft points at
 * the camera; a hand-placed mark on a frame always wins over it.
 */

/** Crop side in pixels at the working resolution. */
const S = 480;
/** Crop half-size in torso lengths: a shaft is 2 to 2.5 torsos from the hands. */
const REACH = 2.9;
/** The shaft line may miss the wrist midpoint by this much, torso lengths: the grip sits beyond the wrists and the pose is rough at the top. */
const RHO_MAX = 0.5;
/** The visible shaft may start this far from the hand centre, torso lengths. */
const START_MAX = 0.8;
/** A line shorter than this is not a shaft, torso lengths. */
const LEN_MIN = 0.5;
/** Candidates kept per frame. */
const TOP = 5;

let canvas: HTMLCanvasElement | null = null;

function cropCanvas(): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null;
  canvas ??= document.createElement("canvas");
  return canvas.getContext("2d", { willReadFrequently: true });
}

/**
 * Shaft candidates on the current frame of `video` given that frame's pose, best first. Each is
 * a line from its grip end (gx, gy) to its far end (x, y) in normalised image coordinates, with a
 * dimensionless quality: summed ridge response over the noise floor, per torso length.
 */
export function detectShaftCands(video: HTMLVideoElement, lm: Pt[]): Shaft[] {
  const W = video.videoWidth;
  const H = video.videoHeight;
  if (!W || !H) return [];
  const ctx = cropCanvas();
  if (!ctx) return [];

  const h = hands(lm);
  const hx = h.x * W;
  const hy = h.y * H;
  const torsoPx = torsoLen(lm) * H;
  const R = Math.max(80, Math.min(Math.max(W, H) * 0.6, torsoPx * REACH));
  const x0 = Math.max(0, Math.floor(hx - R));
  const y0 = Math.max(0, Math.floor(hy - R));
  const x1 = Math.min(W, Math.ceil(hx + R));
  const y1 = Math.min(H, Math.ceil(hy + R));
  if (x1 - x0 < 16 || y1 - y0 < 16) return [];
  const s = S / (2 * R);
  const cw = Math.max(2, Math.round((x1 - x0) * s));
  const ch = Math.max(2, Math.round((y1 - y0) * s));
  // Drawn at twice the working size and box-averaged down: a canvas downscale on its own samples
  // sparsely, which turns a thin line into dashes.
  const w2 = cw * 2;
  const h2 = ch * 2;
  canvas!.width = w2;
  canvas!.height = h2;
  try {
    ctx.drawImage(video, x0, y0, x1 - x0, y1 - y0, 0, 0, w2, h2);
  } catch {
    return [];
  }
  const { data } = ctx.getImageData(0, 0, w2, h2);
  const lum = new Float32Array(cw * ch);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        const i = ((2 * y + (k >> 1)) * w2 + 2 * x + (k & 1)) * 4;
        sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      }
      lum[y * cw + x] = sum * 0.25;
    }
  }

  const t = Math.max(8, torsoPx * s);
  const { lines, tau } = findLines(ridgeMaps(lum, cw, ch), cw, ch, (hx - x0) * s, (hy - y0) * s, {
    rhoMax: RHO_MAX * t,
    startMax: START_MAX * t,
    r0: 0.3 * t,
    rMax: S / 2,
    minLen: LEN_MIN * t,
    top: TOP,
  });
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  return lines.map((l) => ({
    x: r3((x0 + l.tx / s) / W),
    y: r3((y0 + l.ty / s) / H),
    gx: r3((x0 + l.gx / s) / W),
    gy: r3((y0 + l.gy / s) / H),
    score: Math.round((l.score / (tau * t)) * 10) / 10,
  }));
}

/**
 * Tracking quality = detection quality, marked down for the two things that separate a shaft from
 * a shirt seam or a pole behind the golfer: a shaft's response per unit length is high (CRISP, in
 * noise floors; seams and blurred edges sit well under it), and its grip end is at the hands
 * (within OFF_FREE torso lengths; further only when the pose has misplaced the hands).
 */
const CRISP = 5;
const FAINT_COST = 1.5;
const OFF_FREE = 0.3;
const OFF_COST = 8;

/** Hands this far apart, in torso lengths, are in a different place. */
const MOVED = 0.35;
/** Two lines are the same line when their directions agree within this (degrees) and one's midpoint lies this close to the other (torso lengths). */
const SAME_DEG = 3;
const SAME_DIST = 0.06;
/** A line seen with the hands in this many different places belongs to the background. */
const STATIC_PLACES = 4;

/**
 * Candidates that are part of the scene rather than the club: a line that sits in the same place
 * in the image while the hands are in four or more different places (a roof beam, a net cable, a
 * mat edge). The club at address is in the same place for a long time too, but so are the hands;
 * and an on-plane downswing brings the shaft back along its address line with the hands sliding
 * down that line, which is why two or three places are not enough to call it scenery. Returns,
 * per frame, which candidates to keep.
 */
function movingCands(frames: Frame[]): boolean[][] {
  type L = { mx: number; my: number; ux: number; uy: number; hx: number; hy: number; t: number };
  // Median-filtered hands: the pose jumps for a frame or two on its own, which is not the hands moving.
  const hxs = median(frames.map((f) => (f.lm ? hands(f.lm).x : NaN)), 3);
  const hys = median(frames.map((f) => (f.lm ? hands(f.lm).y : NaN)), 3);
  const lines: (L | null)[][] = frames.map((f, i) => {
    if (!f.lm || !f.shaftCands) return [];
    const a = f.aspect ?? 1;
    const sm = shoulderMid(f.lm);
    const hm = hipMid(f.lm);
    const t = Math.max(1e-3, Math.hypot((sm.x - hm.x) * a, sm.y - hm.y));
    return f.shaftCands.map((c) => {
      if (c.gx === undefined || c.gy === undefined) return null;
      const dx = (c.x - c.gx) * a;
      const dy = c.y - c.gy;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) return null;
      return { mx: ((c.x + c.gx) / 2) * a, my: (c.y + c.gy) / 2, ux: dx / len, uy: dy / len, hx: hxs[i] * a, hy: hys[i], t };
    });
  });
  const cosSame = Math.cos((SAME_DEG * Math.PI) / 180);
  return lines.map((ls) =>
    ls.map((l) => {
      if (!l) return true;
      const places = [{ x: l.hx, y: l.hy }];
      for (let j = 0; j < lines.length && places.length < STATIC_PLACES; j++) {
        for (const m of lines[j]) {
          if (!m) continue;
          if (places.some((p) => Math.hypot(m.hx - p.x, m.hy - p.y) < MOVED * l.t)) break; // a place already counted
          if (Math.abs(m.ux * l.ux + m.uy * l.uy) < cosSame) continue;
          if (Math.abs((l.mx - m.mx) * m.uy - (l.my - m.my) * m.ux) > SAME_DIST * l.t) continue;
          places.push({ x: m.hx, y: m.hy });
          break;
        }
      }
      return places.length < STATIC_PLACES;
    })
  );
}

/** Body segments a line can be mistaken for: trunk sides and centre, thighs, shins, upper arms, forearms. */
const LIMBS: [number, number][] = [
  [LM.leftShoulder, LM.leftHip],
  [LM.rightShoulder, LM.rightHip],
  [LM.leftHip, LM.leftKnee],
  [LM.leftKnee, LM.leftAnkle],
  [LM.rightHip, LM.rightKnee],
  [LM.rightKnee, LM.rightAnkle],
  [LM.leftShoulder, LM.leftElbow],
  [LM.rightShoulder, LM.rightElbow],
  [LM.leftElbow, LM.leftWrist],
  [LM.rightElbow, LM.rightWrist],
];
/** Parallel to a limb within this (degrees) and its midpoint this close to it (torso lengths) = part of the body. */
const LIMB_DEG = 12;
const LIMB_DIST = 0.2;

/**
 * Whether a candidate runs along the body: a trouser crease, a shirt seam, the gap between arm
 * and chest. Those are thin lines that start at the hands too, and they move smoothly with the
 * golfer, so tracking alone cannot tell them from the club.
 */
function alongBody(f: Frame, c: Shaft): boolean {
  if (!f.lm || c.gx === undefined || c.gy === undefined) return false;
  const a = f.aspect ?? 1;
  const lm = f.lm;
  const P = (p: { x: number; y: number }) => ({ x: p.x * a, y: p.y });
  const sm = P(shoulderMid(lm));
  const hm = P(hipMid(lm));
  const t = Math.max(1e-3, Math.hypot(sm.x - hm.x, sm.y - hm.y));
  const g = P({ x: c.gx, y: c.gy });
  const e = P(c);
  const len = Math.hypot(e.x - g.x, e.y - g.y);
  if (len < 1e-6) return false;
  const ux = (e.x - g.x) / len;
  const uy = (e.y - g.y) / len;
  const mx = (g.x + e.x) / 2;
  const my = (g.y + e.y) / 2;
  const cosLimb = Math.cos((LIMB_DEG * Math.PI) / 180);
  const segs = LIMBS.map(([i, j]) => [P(lm[i]), P(lm[j])] as const);
  segs.push([sm, hm]);
  for (const [p, q] of segs) {
    const sl = Math.hypot(q.x - p.x, q.y - p.y);
    if (sl < 1e-6) continue;
    const vx = (q.x - p.x) / sl;
    const vy = (q.y - p.y) / sl;
    if (Math.abs(ux * vx + uy * vy) < cosLimb) continue;
    const along = Math.max(0, Math.min(sl, (mx - p.x) * vx + (my - p.y) * vy));
    if (Math.hypot(mx - (p.x + vx * along), my - (p.y + vy * along)) < LIMB_DIST * t) return true;
  }
  return false;
}

/**
 * Choose each frame's shaft from its candidates so the choices form a continuous motion, and
 * write it to `frame.shaft` (null when the frame has none worth keeping). Background lines and
 * lines along the body are discarded first. Frames without candidates recorded (clips analysed before tracking existed)
 * are left as they are.
 */
export function trackShafts(frames: Frame[], fps: number): void {
  if (!frames.some((f) => f.shaftCands)) return;
  const keep = movingCands(frames);
  const kept = frames.map((f, i) => (f.shaftCands ?? []).filter((c, k) => (keep[i][k] ?? true) && !alongBody(f, c)));
  const cands = kept.map((cs, i) => {
    const f = frames[i];
    const a = f.aspect ?? 1;
    const h = f.lm ? hands(f.lm) : null;
    const t = f.lm ? Math.max(1e-3, Math.hypot((shoulderMid(f.lm).x - hipMid(f.lm).x) * a, shoulderMid(f.lm).y - hipMid(f.lm).y)) : 1;
    return cs.map((c) => {
      const gx = c.gx ?? c.x;
      const gy = c.gy ?? c.y;
      const len = Math.hypot((c.x - gx) * a, c.y - gy) / t;
      const off = h ? Math.hypot((gx - h.x) * a, gy - h.y) / t : 0;
      // A shaft is crisp (strong along its whole length, not a long faint seam) and starts at the hands.
      const contrast = len > 0 ? c.score / len : 0;
      const q = c.score - FAINT_COST * Math.max(0, CRISP - contrast) - OFF_COST * Math.max(0, off - OFF_FREE);
      return { deg: (Math.atan2(c.y - gy, (c.x - gx) * a) * 180) / Math.PI, q };
    });
  });
  const pick = trackLines(cands, fps);
  frames.forEach((f, i) => {
    f.shaft = pick[i] >= 0 ? kept[i][pick[i]] : null;
  });
}

export type ResolvedShaft = {
  x: number;
  y: number;
  source: "mark" | "auto";
  /** Grip end of a detected line. The shaft direction runs from here; absent = from the hand centre. */
  from?: { x: number; y: number };
};

/** The shaft to use for a frame: a hand-placed mark on that frame, else the automatic detection. */
export function shaftAt(frame: Frame | undefined, marks: ClubMark[]): ResolvedShaft | null {
  if (!frame) return null;
  const m = marks.find((k) => k.frame === frame.index);
  if (m) return { x: m.x, y: m.y, source: "mark" };
  if (frame.shaft) {
    const s = frame.shaft;
    return { x: s.x, y: s.y, source: "auto", from: s.gx !== undefined && s.gy !== undefined ? { x: s.gx, y: s.gy } : undefined };
  }
  return null;
}

/** How many frames have a shaft from either source. */
export function shaftCoverage(frames: Frame[], marks: ClubMark[]): { auto: number; marks: number } {
  return { auto: frames.filter((f) => f.shaft).length, marks: marks.length };
}

/**
 * Ball tracer: fit a flight path to a handful of user-placed ball marks and extrapolate it to landing.
 *
 * Model. A drag-free ball flies a 3D parabola: X(t) (sideways) and Z(t) (along the camera axis)
 * linear in t, Y(t) (up) quadratic with gravity. A pinhole camera projects that to image coordinates
 *
 *     x(t) = (p0 + p1 t) / (1 + k t),   y(t) = (q0 + q1 t + q2 t²) / (1 + k t)
 *
 * with one shared k = (axial speed / initial depth). k ≈ 0 is the plain image-space parabola you
 * get face-on; k > 0 is a down-the-line shot slowing and converging toward the vanishing point as it
 * flies away. The linear x numerator can never turn back on itself and q2 ≥ 0 means gravity only
 * ever bends the path downward in the image. Sidespin curve is not modelled. Time is anchored at
 * impact (P4); marks before impact are the ball at rest, t = 0.
 *
 * Why priors. Over the first few frames after impact (all a hand-marked DTL clip usually has)
 * perspective (k) and gravity (q2) both show up as the same image-space curvature, so the marks
 * alone cannot separate them; a free fit picks an arbitrary mix and extrapolates nonsense. Physics
 * pins q2: with s = image-height units per metre at the ball's depth (the golfer's size at
 * address, `estimateScale`), q2 = s·g/2 exactly. We use that as a soft prior,
 * SSE + λ·ln(q2/q2prior)², so a long run of well-spread marks can still override a wrong scale or
 * fps. DTL also constrains k ≥ 0 (the ball flies away from the camera).
 *
 * Landing. The ground at the ball's depth projects to cy + (q0 − cy)/(1 + k t), where cy is the
 * image y of the camera's eye level (the horizon). Subtracting that from y(t) gives
 * t·(q1 − cy·k + q2 t)/(1 + k t), so the ball is on the ground again at
 *
 *     tLand = (cy·k − q1) / q2
 *
 * and is above it for every t in between. The path therefore ends at landing instead of running
 * on to the bottom of the frame, which is what used to make a DTL trace look like the ball flew
 * back toward the camera. Face-on the ground at the ball's depth stays where the tee is, so
 * cy = q0. DTL needs the horizon from the caller (a line the user can drag); without one we fall
 * back to cy = q0, which lands late but still never below the tee.
 *
 * Coordinates are normalised image space (0..1) so the fit is independent of clip resolution.
 */

import { CameraView, Frame, LM } from "@/lib/types";

export type BallMark = { frame: number; x: number; y: number };

export type FitOptions = {
  view: CameraView;
  /** Image y (0..1) of the camera's eye level / horizon. Used for the DTL landing; ignored face-on. */
  horizon?: number;
  /** Image-height units per metre at the ball's depth (golfer's size at address). Enables the gravity prior. */
  scale?: number;
};

export type Trajectory = {
  k: number;
  /** x numerator: p0 + p1 t (p2 is always 0, kept for shape parity with py). */
  px: [number, number, number];
  /** y numerator: q0 + q1 t + q2 t², q2 > 0. */
  py: [number, number, number];
  impactFrame: number;
  fps: number;
  /** Time of the last mark, seconds after impact. Beyond this the path is extrapolated. */
  lastMarkT: number;
  /** Time where drawing stops: landing, ball leaves the frame, or a hard cap. */
  tEnd: number;
  /** RMS residual of the marks, normalised units. */
  rms: number;
  /** Time the ball reaches the ground, seconds after impact, or null if it leaves the frame first. */
  tLand: number | null;
  /** Where it lands (normalised), when tLand is set. */
  landing: { x: number; y: number } | null;
  /** Time of the highest point in the image. */
  tApex: number;
};

export const MIN_MARKS = 3;

const G = 9.81;
const MAX_FLIGHT_S = 8;
/** The fit may not launch the ball into the ground: it stays airborne at least this long. */
const MIN_LAND_T = 0.2;
/**
 * Scale assumed when the address pose gives none (image heights per metre: a 1.75 m golfer filling
 * about a third of the frame). A free q2 is unidentifiable from early-flight marks and drifts to
 * whatever bound it is given, so a rough prior beats none.
 */
const DEFAULT_SCALE = 0.2;
/**
 * Prior weight: λ = n·σ² with σ = 0.004 (≈4 px on a 1080-tall clip). Moving q2 to twice (or half)
 * the prior then costs ln(2)²·λ, the same as an extra ~2.8 px of RMS residual on every mark.
 * Three or four marks from the first tenth of a second can be fit to within a pixel for any q2, so
 * they stay on the prior; six marks spread over a second or more cannot, so they win.
 */
const PRIOR_SIGMA = 0.004;
const SCAN_DT = 1 / 240;

type Core = { k: number; px: [number, number, number]; py: [number, number, number]; sse: number };

/** Least squares for v ≈ a·c0 + b·c1 via the normal equations. */
function lsq2(a: number[], b: number[], v: number[]): [number, number] | null {
  let aa = 0;
  let ab = 0;
  let bb = 0;
  let av = 0;
  let bv = 0;
  for (let i = 0; i < v.length; i++) {
    aa += a[i] * a[i];
    ab += a[i] * b[i];
    bb += b[i] * b[i];
    av += a[i] * v[i];
    bv += b[i] * v[i];
  }
  const det = aa * bb - ab * ab;
  if (Math.abs(det) < 1e-14) return null;
  return [(av * bb - ab * bv) / det, (aa * bv - ab * av) / det];
}

/** Least squares for v ≈ a·c. */
function lsq1(a: number[], v: number[]): number {
  let aa = 0;
  let av = 0;
  for (let i = 0; i < v.length; i++) {
    aa += a[i] * a[i];
    av += a[i] * v[i];
  }
  return aa > 0 ? av / aa : 0;
}

/**
 * Closed-form fit of the numerators for a given (k, q2). The landing constraint (the ball must
 * rise off the ground for at least MIN_LAND_T) is linear in (q0, q1), so when the free solution
 * violates it we refit on the constraint boundary.
 */
function solveCore(t: number[], xs: number[], ys: number[], k: number, q2: number, dtl: boolean, horizon: number | undefined): Core | null {
  const n = t.length;
  if (1 + k * t[n - 1] <= 0.05 || 1 + k * t[0] <= 0.05) return null;
  const w = t.map((ti) => 1 / (1 + k * ti));
  const wt = w.map((wi, i) => wi * t[i]);

  const p = lsq2(w, wt, xs);
  if (!p) return null;

  const yt = ys.map((yi, i) => yi - w[i] * q2 * t[i] * t[i]);
  let q = lsq2(w, wt, yt);
  if (!q) return null;
  let [q0, q1] = q;
  const tau = MIN_LAND_T * q2;
  if (dtl && horizon !== undefined) {
    // Ground line is cy + (q0 − cy)/(1 + k t): need q1 ≤ k·cy − τ.
    const q1max = k * horizon - tau;
    if (q1 > q1max) {
      q1 = q1max;
      q0 = lsq1(
        w,
        ys.map((yi, i) => yi - w[i] * (q1 * t[i] + q2 * t[i] * t[i]))
      );
    }
  } else {
    // Ground at the tee's depth stays at q0: need q1 ≤ k·q0 − τ. On the boundary the model is
    // q0 + w·q2·t·(t − MIN_LAND_T), so q0 is a plain mean.
    if (q1 > k * q0 - tau) {
      let s = 0;
      for (let i = 0; i < n; i++) s += ys[i] - w[i] * q2 * t[i] * (t[i] - MIN_LAND_T);
      q0 = s / n;
      q1 = k * q0 - tau;
    }
  }
  q = [q0, q1];

  let sse = 0;
  for (let i = 0; i < n; i++) {
    const ex = w[i] * (p[0] + p[1] * t[i]) - xs[i];
    const ey = w[i] * (q0 + q1 * t[i] + q2 * t[i] * t[i]) - ys[i];
    sse += ex * ex + ey * ey;
  }
  return { k, px: [p[0], p[1], 0], py: [q0, q1, q2], sse };
}

/** Golden-section minimum of f on [lo, hi]. */
function golden(f: (x: number) => number, lo: number, hi: number, iters = 24): number {
  const g = (Math.sqrt(5) - 1) / 2;
  let a = hi - g * (hi - lo);
  let b = lo + g * (hi - lo);
  let fa = f(a);
  let fb = f(b);
  for (let i = 0; i < iters; i++) {
    if (fa < fb) {
      hi = b;
      b = a;
      fb = fa;
      a = hi - g * (hi - lo);
      fa = f(a);
    } else {
      lo = a;
      a = b;
      fa = fb;
      b = lo + g * (hi - lo);
      fb = f(b);
    }
  }
  return (lo + hi) / 2;
}

export function evalTrajectory(tr: Trajectory, t: number): { x: number; y: number } {
  const d = 1 + tr.k * t;
  return {
    x: (tr.px[0] + tr.px[1] * t + tr.px[2] * t * t) / d,
    y: (tr.py[0] + tr.py[1] * t + tr.py[2] * t * t) / d,
  };
}

export function fitTrajectory(marks: BallMark[], impactFrame: number, fps: number, opts: FitOptions): Trajectory | null {
  const dtl = opts.view === "dtl";
  const horizon = dtl && opts.horizon !== undefined && Number.isFinite(opts.horizon) ? opts.horizon : undefined;
  const scale = opts.scale !== undefined && Number.isFinite(opts.scale) && opts.scale > 0 ? opts.scale : undefined;

  // One mark per frame; marks before impact are the ball at rest, i.e. t = 0.
  const byFrame = new Map<number, BallMark>();
  for (const m of marks) {
    const frame = Math.max(impactFrame, m.frame);
    byFrame.set(frame, { ...m, frame });
  }
  const pts = [...byFrame.values()].sort((a, b) => a.frame - b.frame);
  const n = pts.length;
  if (n < MIN_MARKS) return null;
  const t = pts.map((m) => (m.frame - impactFrame) / fps);
  const xs = pts.map((m) => m.x);
  const ys = pts.map((m) => m.y);

  // Search space. k: DTL flies away (k ≥ 0, log-spaced since k = axial speed / camera distance
  // can reach the tens); face-on a small band around 0. q2: around the gravity prior, from the
  // pose scale when we have one and a typical framing otherwise.
  const q2Prior = ((scale ?? DEFAULT_SCALE) * G) / 2;
  const lambda = n * PRIOR_SIGMA * PRIOR_SIGMA;
  const penalty = (q2: number) => lambda * Math.log(q2 / q2Prior) ** 2;
  const objective = (k: number, q2: number): number => {
    const c = solveCore(t, xs, ys, k, q2, dtl, horizon);
    return c ? c.sse + penalty(q2) : Infinity;
  };

  let kGrid: number[];
  if (dtl) {
    kGrid = [0];
    for (let e = -2; e <= 2.3; e += 0.1) kGrid.push(Math.pow(10, e));
  } else {
    kGrid = [];
    for (let k = -0.5; k <= 2.0001; k += 0.05) kGrid.push(k);
  }
  const q2Grid: number[] = [];
  for (let e = -3; e <= 3.0001; e += 0.25) q2Grid.push(q2Prior * Math.pow(2, e));
  const q2Lo = q2Prior / 8;
  const q2Hi = q2Prior * 8;

  let bestK = kGrid[0];
  let bestQ2 = q2Grid[0];
  let bestF = Infinity;
  let bi = 0;
  let bj = 0;
  for (let i = 0; i < kGrid.length; i++) {
    for (let j = 0; j < q2Grid.length; j++) {
      const f = objective(kGrid[i], q2Grid[j]);
      if (f < bestF) {
        bestF = f;
        bestK = kGrid[i];
        bestQ2 = q2Grid[j];
        bi = i;
        bj = j;
      }
    }
  }
  if (!Number.isFinite(bestF)) return null;

  // Refine: alternate golden sections on k and q2 inside the neighbouring grid cells.
  if (kGrid.length > 1 || q2Grid.length > 1) {
    const kLo = kGrid[Math.max(0, bi - 1)];
    const kHi = kGrid[Math.min(kGrid.length - 1, bi + 1)];
    const lo2 = Math.max(q2Lo, q2Grid[Math.max(0, bj - 1)]);
    const hi2 = Math.min(q2Hi, q2Grid[Math.min(q2Grid.length - 1, bj + 1)]);
    for (let round = 0; round < 3; round++) {
      if (kGrid.length > 1) {
        const k = golden((kk) => objective(kk, bestQ2), kLo, kHi);
        const f = objective(k, bestQ2);
        if (f < bestF) {
          bestF = f;
          bestK = k;
        }
      }
      const lq = golden((e) => objective(bestK, Math.exp(e)), Math.log(lo2), Math.log(hi2));
      const q2 = Math.exp(lq);
      const f = objective(bestK, q2);
      if (f < bestF) {
        bestF = f;
        bestQ2 = q2;
      }
    }
  }

  const core = solveCore(t, xs, ys, bestK, bestQ2, dtl, horizon);
  if (!core) return null;

  const tr: Trajectory = {
    k: core.k,
    px: core.px,
    py: core.py,
    impactFrame,
    fps,
    lastMarkT: t[n - 1],
    tEnd: 0,
    rms: Math.sqrt(core.sse / (2 * n)),
    tLand: null,
    landing: null,
    tApex: 0,
  };

  // Landing: the ground at the ball's depth is cy + (q0 − cy)/(1 + k t).
  const cy = horizon ?? tr.py[0];
  const tLandRaw = (cy * tr.k - tr.py[1]) / tr.py[2];
  const tLand = Number.isFinite(tLandRaw) && tLandRaw > 0 ? tLandRaw : null;

  // Walk the path until landing, the ball leaving the frame (sides or top only: a ball that is
  // still airborne cannot drop below the ground line, so the bottom edge is never an exit) or the cap.
  const tMax = Math.min(MAX_FLIGHT_S, tLand ?? MAX_FLIGHT_S);
  let tEnd = 0;
  let leftFrame = false;
  let tApex = 0;
  let yApex = Infinity;
  for (let tt = 0; tt <= tMax + 1e-9; tt += SCAN_DT) {
    const tc = Math.min(tt, tMax);
    if (1 + tr.k * tc <= 0.05) {
      leftFrame = true;
      break;
    }
    const p = evalTrajectory(tr, tc);
    if (p.x < -0.1 || p.x > 1.1 || p.y < -0.1) {
      leftFrame = true;
      break;
    }
    tEnd = tc;
    if (p.y < yApex) {
      yApex = p.y;
      tApex = tc;
    }
    if (tc === tMax) break;
  }
  // Marks are inside the frame by construction; never cut the path short of them.
  tEnd = Math.max(tEnd, Math.min(tr.lastMarkT, tMax));
  tr.tEnd = tEnd;
  tr.tApex = Math.min(tApex, tEnd);
  if (tLand !== null && !leftFrame && tLand <= MAX_FLIGHT_S) {
    tr.tLand = tLand;
    tr.landing = evalTrajectory(tr, tLand);
  }
  return tr;
}

/** Evenly spaced points along the path from t0 to t1 (inclusive). */
export function samplePath(tr: Trajectory, t0: number, t1: number, n: number): { x: number; y: number; t: number }[] {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = t0 + ((t1 - t0) * i) / n;
    out.push({ ...evalTrajectory(tr, t), t });
  }
  return out;
}

/**
 * Image-height units per metre at the golfer's depth, from the address pose. Uses only vertical
 * extents (x and y are normalised by different edges, and the Frame does not carry the aspect
 * ratio): each shank (knee→ankle ≈ 0.246·H), hip→ankle (≈ 0.50·H) and the hip-mid→shoulder-mid
 * span (≈ 0.288·H upright; 0.27 used to allow for some forward bend). Knee flex and spine tilt at
 * address shorten these a little, so expect the estimate to run ~5–15 % low; the gravity prior it
 * feeds is soft, so that is tolerable. Median of the available segments, undefined without landmarks.
 */
export function estimateScale(address: Frame | undefined, golferHeightM = 1.75): number | undefined {
  const lm = address?.lm;
  if (!lm || !(golferHeightM > 0)) return undefined;
  const ok = (i: number) => lm[i] && (lm[i].visibility === undefined || lm[i].visibility! > 0.5);
  const est: number[] = [];
  const vert = (top: number, bottom: number, frac: number) => {
    if (!ok(top) || !ok(bottom)) return;
    const d = lm[bottom].y - lm[top].y;
    if (d > 0.005) est.push(d / (frac * golferHeightM));
  };
  vert(LM.leftKnee, LM.leftAnkle, 0.246);
  vert(LM.rightKnee, LM.rightAnkle, 0.246);
  vert(LM.leftHip, LM.leftAnkle, 0.5);
  vert(LM.rightHip, LM.rightAnkle, 0.5);
  if (ok(LM.leftHip) && ok(LM.rightHip) && ok(LM.leftShoulder) && ok(LM.rightShoulder)) {
    const hipY = (lm[LM.leftHip].y + lm[LM.rightHip].y) / 2;
    const shY = (lm[LM.leftShoulder].y + lm[LM.rightShoulder].y) / 2;
    const d = hipY - shY;
    if (d > 0.005) est.push(d / (0.27 * golferHeightM));
  }
  if (!est.length) return undefined;
  est.sort((a, b) => a - b);
  const m = est.length >> 1;
  return est.length % 2 ? est[m] : (est[m - 1] + est[m]) / 2;
}

/** Ground line (image y) at the golfer's depth from the address pose: max ankle y plus a small offset. */
export function groundLine(address: Frame | undefined): number | undefined {
  const lm = address?.lm;
  if (!lm) return undefined;
  const y = Math.max(lm[LM.leftAnkle].y, lm[LM.rightAnkle].y);
  return Number.isFinite(y) ? y + 0.02 : undefined;
}

/**
 * Snap a click to the ball: inside a small window around the click, take the brightness-weighted
 * centroid of the brightest pixels. Falls back to the raw click when the window has no clear
 * bright blob (ball against a bright sky, ball hidden, etc.).
 */
export function refineMark(video: HTMLVideoElement, x: number, y: number, radiusPx = 14): { x: number; y: number } {
  const W = video.videoWidth;
  const H = video.videoHeight;
  if (!W || !H) return { x, y };
  const cx = Math.round(x * W);
  const cy = Math.round(y * H);
  const x0 = Math.max(0, cx - radiusPx);
  const y0 = Math.max(0, cy - radiusPx);
  const w = Math.min(W, cx + radiusPx) - x0;
  const h = Math.min(H, cy + radiusPx) - y0;
  if (w <= 2 || h <= 2) return { x, y };
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { x, y };
  try {
    ctx.drawImage(video, x0, y0, w, h, 0, 0, w, h);
  } catch {
    return { x, y };
  }
  const { data } = ctx.getImageData(0, 0, w, h);
  const lum = new Float32Array(w * h);
  let max = 0;
  let sum = 0;
  for (let i = 0; i < w * h; i++) {
    const l = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    lum[i] = l;
    sum += l;
    if (l > max) max = l;
  }
  const mean = sum / (w * h);
  if (max - mean < 35) return { x, y }; // nothing stands out
  const thr = max - (max - mean) * 0.25;
  let sx = 0;
  let sy = 0;
  let sw = 0;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const l = lum[j * w + i];
      if (l < thr) continue;
      const wgt = l - thr + 1;
      sx += (x0 + i + 0.5) * wgt;
      sy += (y0 + j + 0.5) * wgt;
      sw += wgt;
    }
  }
  if (sw === 0) return { x, y };
  return { x: sx / sw / W, y: sy / sw / H };
}

/**
 * Radial ridge scan: find the direction from an origin along which a thin bright-or-dark line
 * runs, and how far it runs. Pure arithmetic on a greyscale buffer so it can be tested in Node;
 * shaft.ts wraps it with the video crop. See shaft.ts for the idea.
 */

export type Ray = { deg: number; len: number; score: number };

export type ScanOptions = {
  /** Perpendicular sampling offset, pixels. About the line width. */
  d?: number;
  /** Angular step, degrees. */
  step?: number;
  /** Directions (degrees) to skip, with the half-width of the exclusion. */
  exclude?: number[];
  excludeHalfWidth?: number;
  /** Soft continuity prior: a direction, and the sigma in degrees. */
  prior?: number | null;
  priorSigma?: number;
  /** Start of the scan along each ray, pixels from the origin (skips the hands themselves). */
  r0?: number;
  /** Longest ray, pixels. */
  rMax: number;
  /** Shortest run that counts as a line, pixels. */
  minLen: number;
  /** Response below this is noise, lum levels. */
  tau?: number;
};

export function angDiff(a: number, b: number): number {
  let d = Math.abs(a - b) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

/**
 * Signed ridge response along a ray: pixel on the ray minus the mean of the pixels `d` either
 * side of it. Positive = brighter than its surroundings.
 */
export function rayResponses(lum: Float32Array, w: number, h: number, ox: number, oy: number, deg: number, o: Required<Pick<ScanOptions, "d" | "r0" | "rMax">>): number[] {
  const th = (deg * Math.PI) / 180;
  const cx = Math.cos(th);
  const cy = Math.sin(th);
  const nx = -cy * o.d;
  const ny = cx * o.d;
  const at = (x: number, y: number) => {
    const xi = x < 0 ? 0 : x >= w ? w - 1 : x | 0;
    const yi = y < 0 ? 0 : y >= h ? h - 1 : y | 0;
    return lum[yi * w + xi];
  };
  const out: number[] = [];
  for (let r = o.r0; r < o.rMax; r += 1) {
    const px = ox + cx * r;
    const py = oy + cy * r;
    if (px < 0 || py < 0 || px >= w || py >= h) break;
    out.push(at(px, py) - 0.5 * (at(px + nx, py + ny) + at(px - nx, py - ny)));
  }
  return out;
}

/**
 * Best consistent-sign run that starts near the origin: for each start within the first `maxStart`
 * samples, extend while the running sum of (|response| - tau) keeps growing, in either sign. Score
 * is the mean excess response over the run, weighted up for longer runs.
 */
export function bestRun(vals: number[], o: { minLen: number; tau: number; rMax: number; maxStart: number }): { len: number; score: number; end: number } {
  let best = { len: 0, score: 0, end: 0 };
  for (const sign of [1, -1]) {
    for (let a = 0; a <= Math.min(o.maxStart, vals.length - 1); a++) {
      let sum = 0;
      let peak = 0;
      let peakEnd = a;
      for (let b = a; b < vals.length; b++) {
        sum += vals[b] * sign - o.tau;
        if (sum > peak) {
          peak = sum;
          peakEnd = b;
        } else if (sum < peak - o.tau * 12) break; // well past the end of the line
      }
      // Trim: noise can push the running sum to a new peak well past the line's end, so pull the
      // end back until the tail is at least half as strong as the run's average.
      let end = peakEnd;
      let len = end - a + 1;
      while (len > o.minLen) {
        const mean = peak / len;
        const k = Math.min(6, len);
        let tail = 0;
        for (let i = end - k + 1; i <= end; i++) tail += vals[i] * sign - o.tau;
        if (tail / k >= 0.5 * mean) break;
        for (let i = end - k + 1; i <= end; i++) peak -= vals[i] * sign - o.tau;
        end -= k;
        len = end - a + 1;
      }
      if (len < o.minLen || peak <= 0) continue;
      const score = (peak / len) * Math.min(1, len / (o.rMax * 0.5)) ** 0.5;
      if (score > best.score) best = { len, score, end };
    }
  }
  return best;
}

export type ScanResult = Ray & {
  /** Best score over the 95th percentile of the other directions: how much the line stands out. */
  ratio: number;
  /** Median |response| over the crop: the noise floor the score is judged against. */
  noise: number;
};

/** Acceptance thresholds shared by the detector and its tests. */
export const ACCEPT = { ratio: 2.5, noiseK: 2.0, abs: 2.5 };
export function acceptRay(r: ScanResult | null): r is ScanResult {
  return !!r && r.score >= ACCEPT.abs && r.score >= ACCEPT.noiseK * r.noise && r.ratio >= ACCEPT.ratio;
}

/** Scan all directions and return the best, with how it compares to the other directions and the noise. */
export function scanRays(lum: Float32Array, w: number, h: number, ox: number, oy: number, opt: ScanOptions): ScanResult | null {
  const d = opt.d ?? 2;
  const step = opt.step ?? 1.5;
  const r0 = opt.r0 ?? 3;
  const tau = opt.tau ?? 1.5;
  const halfW = opt.excludeHalfWidth ?? 16;
  const maxStart = Math.max(2, Math.round(opt.rMax * 0.15));
  const absVals: number[] = [];
  const one = (deg: number, collect = false) => {
    const vals = rayResponses(lum, w, h, ox, oy, deg, { d, r0, rMax: opt.rMax });
    if (collect) for (let i = 0; i < vals.length; i += 3) absVals.push(Math.abs(vals[i]));
    const run = bestRun(vals, { minLen: opt.minLen, tau, rMax: opt.rMax, maxStart });
    return { deg, len: r0 + run.end, score: run.score };
  };
  let best: Ray = { deg: 0, len: 0, score: 0 };
  const scored: { deg: number; score: number }[] = [];
  for (let deg = -180; deg < 180; deg += step) {
    if (opt.exclude?.some((a) => angDiff(a, deg) < halfW)) continue;
    const r = one(deg, true);
    let sc = r.score;
    if (opt.prior !== null && opt.prior !== undefined) sc *= 1 + 0.3 * Math.exp(-((angDiff(opt.prior, deg) / (opt.priorSigma ?? 30)) ** 2));
    scored.push({ deg, score: sc });
    if (sc > best.score) best = { ...r, score: sc };
  }
  if (!scored.length || best.score <= 0) return null;
  absVals.sort((a, b) => a - b);
  const noise = absVals.length ? absVals[Math.floor(absVals.length / 2)] : 0;
  // Distinctness: the winner against the strong end of every other direction, its own neighbourhood excluded.
  const others = scored.filter((x) => angDiff(x.deg, best.deg) > 6).map((x) => x.score).sort((a, b) => a - b);
  const p95 = others.length ? others[Math.floor(others.length * 0.95)] : 0;
  // Refine around the winner at a finer angular step.
  for (let deg = best.deg - step; deg <= best.deg + step; deg += step / 6) {
    const r = one(deg);
    if (r.score > best.score) best = r;
  }
  return { ...best, ratio: best.score / Math.max(0.05, p95), noise };
}

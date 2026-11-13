/**
 * Thin-line finder: the straight thin lines (darker or brighter than both sides) that pass close
 * to a point, and how far each runs. Pure arithmetic on a greyscale buffer so it can be exercised
 * in Node; shaft.ts wraps it with the video crop. Three steps:
 *
 *   ridgeMaps  per pixel, per orientation: how much the pixel differs from BOTH neighbours across
 *              the line. An edge (a limb or the body against the sky) scores 0, a thin line scores
 *              its contrast.
 *   vote       every ridge pixel votes for the lines through it that pass near the origin
 *              (direction x offset). Peaks are candidate lines.
 *   walk       each candidate is walked from the origin outwards; the longest consistent run gives
 *              its two ends and a score.
 */
/** Normal offsets of the four ridge orientations: line running along x, along y, and the two diagonals. */
const NORMALS: [number, number][] = [
  [0, 3], // line along x (0 deg): normal is y
  [-2, 2], // line along 45 deg (x+, y+): normal (-1, 1)
  [3, 0], // line along y (90 deg)
  [2, 2], // line along 135 deg (x-, y+): normal (1, 1)
];

/**
 * Four signed ridge maps, one per line orientation. Positive = a line darker than both sides,
 * negative = brighter than both sides, 0 = flat or an edge (only one side differs).
 */
export function ridgeMaps(lum: Float32Array, w: number, h: number): Float32Array[] {
  const maps = NORMALS.map(() => new Float32Array(w * h));
  for (let k = 0; k < 4; k++) {
    const [nx, ny] = NORMALS[k];
    const off = ny * w + nx;
    const m = maps[k];
    const x0 = Math.abs(nx), x1 = w - Math.abs(nx);
    for (let y = Math.abs(ny); y < h - Math.abs(ny); y++) {
      let i = y * w + x0;
      for (let x = x0; x < x1; x++, i++) {
        const c = lum[i];
        const a = lum[i + off];
        const b = lum[i - off];
        const lo = a < b ? a : b;
        const hi = a > b ? a : b;
        if (lo > c) m[i] = lo - c;
        else if (hi < c) m[i] = hi - c;
      }
    }
  }
  return maps;
}

/** Orientation index (0..3) for a line direction in degrees. */
export function orientOf(deg: number): number {
  const a = ((deg % 180) + 180) % 180;
  return Math.round(a / 45) % 4;
}

export type Line = {
  /** Direction from the grip end to the far end, degrees (image coords, y down). */
  deg: number;
  /** Grip end and far end, buffer pixels. */
  gx: number; gy: number; tx: number; ty: number;
  len: number;
  /** Summed ridge response above the noise floor along the run. */
  score: number;
  /** Mean response along the run, lum levels. */
  mean: number;
  /** +1 dark line, -1 bright line. */
  pol: number;
};

export type FindOptions = {
  /** Lines must pass within this distance of the origin, pixels. */
  rhoMax: number;
  /** The run must start within this distance along the line from the origin's foot point, pixels. */
  startMax: number;
  /** Ignore pixels closer than this to the origin when voting, pixels. */
  r0: number;
  /** Longest line, pixels. */
  rMax: number;
  /** Shortest run that counts, pixels. */
  minLen: number;
  /** How many candidates to return. */
  top?: number;
};

const TH_STEP = 1;
const NTH = Math.round(360 / TH_STEP);

export function noiseFloor(maps: Float32Array[]): number {
  // Median of the non-zero |response| over a sparse sample of all four maps.
  const v: number[] = [];
  for (const m of maps) for (let i = 0; i < m.length; i += 7) if (m[i] !== 0) v.push(Math.abs(m[i]));
  if (!v.length) return 0;
  v.sort((a, b) => a - b);
  return v[v.length >> 1];
}

export function findLines(maps: Float32Array[], w: number, h: number, ox: number, oy: number, o: FindOptions): { lines: Line[]; tau: number } {
  const top = o.top ?? 5;
  const tau = Math.max(2.5, 2 * noiseFloor(maps));
  const cap = tau * 8;
  const NR = 2 * Math.ceil(o.rhoMax) + 1;
  const rc = Math.ceil(o.rhoMax);
  // Two accumulators (dark, bright) over direction x offset.
  const acc = [new Float32Array(NTH * NR), new Float32Array(NTH * NR)];
  const cosT = new Float32Array(NTH), sinT = new Float32Array(NTH);
  for (let t = 0; t < NTH; t++) {
    const th = ((t * TH_STEP - 180) * Math.PI) / 180;
    cosT[t] = Math.cos(th);
    sinT[t] = Math.sin(th);
  }
  const xa = Math.max(3, Math.floor(ox - o.rMax)), xb = Math.min(w - 3, Math.ceil(ox + o.rMax));
  const ya = Math.max(3, Math.floor(oy - o.rMax)), yb = Math.min(h - 3, Math.ceil(oy + o.rMax));
  const r0sq = o.r0 * o.r0, rMsq = o.rMax * o.rMax;
  for (let y = ya; y < yb; y++) {
    const dy = y - oy;
    for (let x = xa; x < xb; x++) {
      const dx = x - ox;
      const rsq = dx * dx + dy * dy;
      if (rsq < r0sq || rsq > rMsq) continue;
      // Orientation of a line from the origin through this pixel, without atan2.
      const ax = Math.abs(dx), ay = Math.abs(dy);
      let k: number;
      if (ay < ax * 0.4142) k = 0;
      else if (ax < ay * 0.4142) k = 2;
      else k = dx * dy > 0 ? 1 : 3;
      const v = maps[k][y * w + x];
      const av = v < 0 ? -v : v;
      if (av < tau) continue;
      // The ridge must run along the bearing: texture responds in every orientation, a line in one.
      const i = y * w + x;
      const c1 = Math.abs(maps[(k + 2) & 3][i]);
      if (c1 > av * 0.6) continue;
      const wgt = av > cap ? cap : av;
      const a = v > 0 ? acc[0] : acc[1];
      const r = Math.sqrt(rsq);
      const bearing = (Math.atan2(dy, dx) * 180) / Math.PI;
      const spread = Math.min(30, (Math.asin(Math.min(1, o.rhoMax / r)) * 180) / Math.PI);
      const t0 = Math.ceil((bearing - spread + 180) / TH_STEP), t1 = Math.floor((bearing + spread + 180) / TH_STEP);
      for (let tt = t0; tt <= t1; tt++) {
        const t = ((tt % NTH) + NTH) % NTH;
        const rho = -dx * sinT[t] + dy * cosT[t];
        const ri = Math.round(rho) + rc;
        if (ri < 0 || ri >= NR) continue;
        a[t * NR + ri] += wgt;
      }
    }
  }
  // Peaks: best cells with non-maximum suppression, both polarities together.
  type Peak = { t: number; ri: number; p: number; v: number };
  const kept: Peak[] = [];
  // Smooth across the offset, then take maxima one at a time, clearing a neighbourhood around each.
  const sm = acc.map((a) => {
    const o2 = new Float32Array(a.length);
    for (let t = 0; t < NTH; t++) for (let ri = 1; ri < NR - 1; ri++) o2[t * NR + ri] = a[t * NR + ri - 1] + a[t * NR + ri] + a[t * NR + ri + 1];
    return o2;
  });
  const DT = Math.round(5 / TH_STEP), DR = 10;
  for (let n = 0; n < top * 3; n++) {
    let bv = 0, bp = 0, bi = 0;
    for (let p = 0; p < 2; p++) {
      const a = sm[p];
      for (let i = 0; i < a.length; i++) if (a[i] > bv) { bv = a[i]; bp = p; bi = i; }
    }
    if (bv <= 0) break;
    const t = (bi / NR) | 0, ri = bi % NR;
    kept.push({ t, ri, p: bp, v: bv });
    for (let dt = -DT; dt <= DT; dt++) {
      const tt = (((t + dt) % NTH) + NTH) % NTH;
      for (let r = Math.max(0, ri - DR); r <= Math.min(NR - 1, ri + DR); r++) sm[bp][tt * NR + r] = 0;
    }
  }
  const lines: Line[] = [];
  for (const pk of kept) {
    let best: Line | null = null;
    const deg0 = pk.t * TH_STEP - 180;
    for (let dd = -1; dd <= 1; dd += 0.25) {
      for (let dr = -1; dr <= 1; dr += 1) {
        const l = walk(maps, w, h, ox, oy, deg0 + dd, pk.ri - rc + dr, pk.p === 0 ? 1 : -1, tau, o);
        if (l && (!best || l.score > best.score)) best = l;
      }
    }
    if (best) lines.push(best);
  }
  lines.sort((a, b) => b.score - a.score);
  // De-duplicate refined lines that converged on the same ridge.
  const out: Line[] = [];
  for (const l of lines) {
    if (out.some((q) => angDiff(q.deg, l.deg) < 4 && Math.hypot(q.tx - l.tx, q.ty - l.ty) < 12)) continue;
    out.push(l);
    if (out.length >= top) break;
  }
  return { lines: out, tau };
}

export function angDiff(a: number, b: number): number {
  let d = Math.abs(a - b) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

/** Walk one line (direction, offset from the origin) and find the best run starting near the origin. */
function walk(maps: Float32Array[], w: number, h: number, ox: number, oy: number, deg: number, rho: number, pol: number, tau: number, o: FindOptions): Line | null {
  const th = (deg * Math.PI) / 180;
  const ux = Math.cos(th), uy = Math.sin(th);
  const nx = -uy, ny = ux;
  const m = maps[orientOf(deg)];
  const bx = ox + nx * rho, by = oy + ny * rho;
  const sMin = -o.startMax;
  const vals: number[] = [];
  for (let s = sMin; s < o.rMax; s++) {
    const px = bx + ux * s, py = by + uy * s;
    if (px < 1 || py < 1 || px >= w - 1 || py >= h - 1) {
      if (s < 0) { vals.push(0); continue; }
      break;
    }
    // Strongest of the pixel and its two neighbours across the line: tolerates half-pixel misalignment.
    let v = 0;
    for (let e = -1; e <= 1; e++) {
      const q = m[((py + ny * e + 0.5) | 0) * w + ((px + nx * e + 0.5) | 0)] * pol;
      if (q > v) v = q;
    }
    vals.push(v);
  }
  const maxStart = Math.min(vals.length - 1, Math.round(2 * o.startMax));
  let best: { a: number; end: number; peak: number } | null = null;
  const drop = tau * 10;
  for (let a = 0; a <= maxStart; a++) {
    if (vals[a] < tau) continue; // a run starts on the line
    let sum = 0, peak = 0, peakEnd = a;
    for (let b = a; b < vals.length; b++) {
      sum += Math.min(vals[b], tau * 8) - tau;
      if (sum > peak) { peak = sum; peakEnd = b; }
      else if (sum < peak - drop) break;
    }
    if (!best || peak > best.peak) best = { a, end: peakEnd, peak };
  }
  if (!best) return null;
  const len = best.end - best.a + 1;
  if (len < o.minLen || best.peak <= 0) return null;
  const s0 = sMin + best.a, s1 = sMin + best.end;
  return { deg, gx: bx + ux * s0, gy: by + uy * s0, tx: bx + ux * s1, ty: by + uy * s1, len, score: best.peak, mean: best.peak / len + tau, pol };
}

// ---------------------------------------------------------------------------------------------
// Tracking: pick at most one candidate per frame so the choices form a continuous motion.

export type TrackCand = {
  /** Line direction, degrees, in undistorted image space. */
  deg: number;
  /** Dimensionless quality: summed response / (noise floor x torso length). */
  q: number;
};

/** Quality a candidate needs to be kept when it continues the previous frame's line. */
export const Q_KEEP = 3;
/** Extra quality needed to start a track (or to stand alone on one frame). */
export const Q_START = 2;
/** Fastest shaft rotation a sharp frame can show, degrees per second, plus a fixed allowance. */
const MAX_RATE = 1200;
const FREE_DEG = 10;

/**
 * Viterbi over the frames: each frame takes one of its candidates or none. A candidate earns its
 * quality above Q_KEEP; starting from nothing costs Q_START, so a lone weak line on one frame is
 * dropped while the same line continuing a track is kept; a jump in direction larger than the
 * club can turn in one frame counts as a new start. Returns the chosen candidate index per frame,
 * -1 for none.
 */
export function trackLines(cands: TrackCand[][], fps: number): number[] {
  const n = cands.length;
  const allowed = FREE_DEG + MAX_RATE / Math.max(1, fps);
  const score: number[][] = [];
  const back: number[][] = [];
  let prevNone = 0;
  const noneBack: number[] = [];
  for (let i = 0; i < n; i++) {
    const cs = cands[i];
    const prev = i > 0 ? cands[i - 1] : [];
    const ps = i > 0 ? score[i - 1] : [];
    const sc: number[] = [];
    const bk: number[] = [];
    for (let k = 0; k < cs.length; k++) {
      let best = prevNone - Q_START;
      let from = -1;
      for (let j = 0; j < prev.length; j++) {
        const d = angDiff(prev[j].deg, cs[k].deg);
        const v = ps[j] - (d <= allowed ? (0.5 * d) / allowed : Q_START + 1);
        if (v > best) {
          best = v;
          from = j;
        }
      }
      sc.push(best + cs[k].q - Q_KEEP);
      bk.push(from);
    }
    let nb = prevNone;
    let nf = -1;
    for (let j = 0; j < prev.length; j++)
      if (ps[j] > nb) {
        nb = ps[j];
        nf = j;
      }
    score.push(sc);
    back.push(bk);
    noneBack.push(nf);
    prevNone = nb;
  }
  const out = new Array<number>(n).fill(-1);
  let cur = -1;
  let best = prevNone;
  if (n) for (let k = 0; k < score[n - 1].length; k++) if (score[n - 1][k] > best) { best = score[n - 1][k]; cur = k; }
  for (let i = n - 1; i >= 0; i--) {
    out[i] = cur;
    cur = cur >= 0 ? back[i][cur] : noneBack[i];
  }
  return out;
}

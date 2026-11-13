import { CameraView, Frame, Positions } from "@/lib/types";
import { firstValid, hands, hipMid, median, motionEnergy, shoulderWidth, smooth, torsoLen } from "@/lib/geometry";

/**
 * Face-on: shoulders look wide relative to torso height. DTL: narrow. Judged at address (`at`,
 * the median over the frames leading up to it) when the positions are known: a clip often opens
 * with the golfer walking in or turned to the camera, which says nothing about the swing's view.
 */
export function detectView(frames: Frame[], at?: number): CameraView {
  const ratio = (f: Frame | undefined) => (f?.lm ? shoulderWidth(f.lm) / Math.max(1e-6, torsoLen(f.lm)) : NaN);
  let r = NaN;
  if (at !== undefined) {
    const rs: number[] = [];
    for (let i = Math.max(0, at - 30); i <= at && i < frames.length; i++) {
      const v = ratio(frames[i]);
      if (Number.isFinite(v)) rs.push(v);
    }
    rs.sort((a, b) => a - b);
    if (rs.length) r = rs[rs.length >> 1];
  }
  if (!Number.isFinite(r)) r = ratio(firstValid(frames));
  if (!Number.isFinite(r)) return "dtl";
  return r > 0.55 ? "faceOn" : "dtl";
}

/**
 * Heuristic P-position finder. Address and impact come from the tracked club when there is one
 * (see swingFromShaft), since the club at rest and the club coming back to the ball are far clearer
 * events than anything in the pose; otherwise from landmark motion:
 *  P4 impact  : max hand speed, refined to the frame where hands are closest to their address position
 *  P1 address : last quiet frame before the swing starts (searching back from P4)
 *  P3 top     : highest hands between P1 and P4
 *  P2 / P5    : hands crossing hip height going up, before P3 / after P4
 *  P6 finish  : motion settles after P5 (or the last frame)
 */
export function detectPositions(frames: Frame[]): Positions {
  const n = frames.length;
  const last = n - 1;
  const fallback: Positions = { P1: 0, P2: 0, P3: 0, P4: 0, P5: 0, P6: last };
  if (n < 10) return fallback;

  // Median first: the pose model drops the wrists somewhere else for a frame or two now and then
  // (backlit clips especially), and one such jump is faster than any real downswing.
  const hx = smooth(median(frames.map((f) => (f.lm ? hands(f.lm).x : NaN)), 2), 1);
  const hy = smooth(median(frames.map((f) => (f.lm ? hands(f.lm).y : NaN)), 2), 1);
  const hipY = smooth(frames.map((f) => (f.lm ? hipMid(f.lm).y : NaN)), 2);
  const energy = smooth(motionEnergy(frames), 2);

  const handSpeed = hx.map((_, i) =>
    i === 0 || !Number.isFinite(hx[i]) || !Number.isFinite(hx[i - 1])
      ? 0
      : Math.hypot(hx[i] - hx[i - 1], hy[i] - hy[i - 1])
  );

  // Quiet threshold relative to the clip's own energy distribution.
  const sorted = [...energy].filter(Number.isFinite).sort((a, b) => a - b);
  const quiet = sorted[Math.floor(sorted.length * 0.2)] * 1.5 + 1e-4;

  // Address and impact from the club when it was tracked, else from the hands alone.
  let p1: number;
  let p4: number;
  const club = swingFromShaft(frames, hx, hy, handSpeed);
  if (club) {
    p1 = club.p1;
    p4 = club.p4;
  } else {
    // P4: fastest hands, biased toward the middle of the clip when there are ties.
    p4 = 0;
    let best = -1;
    for (let i = 3; i < n - 3; i++) {
      if (handSpeed[i] > best) {
        best = handSpeed[i];
        p4 = i;
      }
    }

    // P1: walk back from P4 to the last sustained quiet window.
    p1 = 0;
    {
      let run = 0;
      for (let i = p4; i >= 0; i--) {
        if (energy[i] < quiet) run++;
        else run = 0;
        if (run >= 3) {
          p1 = i + 2;
          break;
        }
      }
    }
    // Need at least some backswing between P1 and P4.
    if (p4 - p1 < 5) p1 = Math.max(0, p4 - Math.floor(n / 3));

    // Refine P4: within a window after the peak, hands closest to address hands.
    p4 = closestToAddress(hx, hy, p1, Math.max(p1 + 3, p4 - 6), Math.min(last, p4 + 8));
  }

  // P3: highest hands (smallest y) between P1 and P4.
  let p3 = p1;
  for (let i = p1; i <= p4; i++) if (hy[i] < hy[p3]) p3 = i;

  // P2: first frame after P1 where hands rise above hip height.
  let p2 = p1;
  for (let i = p1; i <= p3; i++) {
    if (hy[i] < hipY[i]) {
      p2 = i;
      break;
    }
  }
  if (p2 === p1) p2 = Math.round(p1 + (p3 - p1) * 0.4);

  // P5: first frame after P4 where hands rise above hip height.
  let p5 = Math.min(last, p4 + 3);
  for (let i = p4 + 1; i <= last; i++) {
    if (hy[i] < hipY[i]) {
      p5 = i;
      break;
    }
  }

  // P6: motion settles after P5 for a few frames, else last frame.
  let p6 = last;
  {
    let run = 0;
    for (let i = p5 + 3; i <= last; i++) {
      if (energy[i] < quiet) run++;
      else run = 0;
      if (run >= 4) {
        p6 = i - 3;
        break;
      }
    }
  }

  return { P1: p1, P2: p2, P3: p3, P4: p4, P5: p5, P6: p6 };
}

/** Frame in [from, to] where the hands are closest to where they were at `p1`. */
function closestToAddress(hx: number[], hy: number[], p1: number, from: number, to: number): number {
  let bestD = Infinity;
  let bi = from;
  for (let i = from; i <= to; i++) {
    const d = Math.hypot(hx[i] - hx[p1], hy[i] - hy[p1]);
    if (d < bestD) {
      bestD = d;
      bi = i;
    }
  }
  return bi;
}

/** Shaft direction on a frame in undistorted image space, degrees; NaN when no shaft was tracked there. */
function shaftDeg(f: Frame): number {
  const s = f.shaft;
  if (!s || s.gx === undefined || s.gy === undefined) return NaN;
  return (Math.atan2(s.y - s.gy, (s.x - s.gx) * (f.aspect ?? 1)) * 180) / Math.PI;
}

/** The club counts as still while its direction stays within this of where the still spell began, degrees. */
const STILL_DEG = 4;
/** How long the club must have been still for a frame to count as address, seconds. */
const STILL_SEC = 0.3;
/** The shaft must swing at least this far from its address direction for the motion to be a swing, degrees. */
const SWING_DEG = 80;
/** Back within this of the address direction = the club is coming into the ball, degrees. */
const RETURN_DEG = 25;

/**
 * Address and impact from the tracked shaft. A swing reads as: the club held still (address), then
 * its direction turning more than SWING_DEG away (backswing), then coming back to the address
 * direction (delivery into impact). Address is the last still frame before the backswing; when the
 * clip holds several such swings the one with the fastest hands wins, which is the real shot rather
 * than a rehearsal.
 * Impact is then the frame where the hands are back closest to their address position. Null when the clip has no tracked shaft or no still-swing-return pattern, e.g. a clip
 * that starts mid-swing or a half swing; the caller falls back to the hands.
 */
function swingFromShaft(frames: Frame[], hx: number[], hy: number[], handSpeed: number[]): { p1: number; p4: number } | null {
  const n = frames.length;
  const deg = frames.map(shaftDeg);
  if (deg.filter(Number.isFinite).length < 10) return null;
  const dt = n > 1 ? Math.max(1, (frames[n - 1].timeMs - frames[0].timeMs) / (n - 1)) / 1000 : 1 / 60;
  const sec = (t: number) => Math.max(1, Math.round(t / dt));
  const diff = (a: number, b: number) => {
    const d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  };

  // Still at j: every tracked frame of the last STILL_SEC points the same way, and most were tracked.
  const span = sec(STILL_SEC);
  const still = (j: number) => {
    if (j < span || !Number.isFinite(deg[j])) return false;
    let seen = 0;
    for (let k = j - span; k < j; k++) {
      if (!Number.isFinite(deg[k])) continue;
      if (diff(deg[k], deg[j]) > STILL_DEG) return false;
      seen++;
    }
    return seen >= span / 2;
  };

  // Each backswing, keyed by where it starts, with the last still frame before it as its address.
  const swings = new Map<number, number>();
  for (let j = 0; j < n; j++) {
    if (!still(j)) continue;
    // Backswing: the first two consecutive tracked frames far from the address direction.
    for (let k = j + 1; k < Math.min(n - 1, j + sec(1.5)); k++) {
      if (diff(deg[k], deg[j]) > SWING_DEG && diff(deg[k + 1], deg[j]) > SWING_DEG) {
        swings.set(k, j);
        break;
      }
    }
  }

  let best: { p1: number; p4: number; speed: number } | null = null;
  for (const [top, p1] of swings) {
    // Impact: the hands swing away from their address position and come back to it once, at the
    // ball. Follow them out, wait for them to be most of the way back, then take the closest frame.
    const lim = Math.min(n - 1, top + sec(1.5));
    const away = (j: number) => Math.hypot(hx[j] - hx[p1], hy[j] - hy[p1]);
    let far = 0;
    let zone = -1;
    for (let j = top; j <= lim; j++) {
      const d = away(j);
      if (!Number.isFinite(d)) continue;
      if (d > far) far = d;
      else if (d < 0.35 * far) {
        zone = j;
        break;
      }
    }
    if (zone < 0) continue;
    // The club coming back to its address direction marks the same moment; when it was tracked
    // there and agrees, search around it, otherwise around the hands alone.
    let ret = -1;
    for (let j = top + 1; j <= lim; j++) {
      if (diff(deg[j], deg[p1]) < RETURN_DEG) {
        ret = j;
        break;
      }
    }
    const near = ret >= 0 && Math.abs(ret - zone) <= sec(0.15) ? Math.min(ret, zone) : zone;
    const p4 = closestToAddress(hx, hy, p1, near, Math.min(n - 1, near + sec(0.2)));
    let speed = 0;
    for (let j = top; j <= p4; j++) speed = Math.max(speed, handSpeed[j] || 0);
    if (p4 - p1 >= 5 && (!best || speed > best.speed)) best = { p1, p4, speed };
  }
  return best && { p1: best.p1, p4: best.p4 };
}

/**
 * Delivery: the first frame on the way down where the hands drop back below hip height (shaft
 * roughly parallel to the ground). Where lag and casting are judged. Falls back to 60% of the
 * way from the top to impact when the hands never cross hip height.
 */
export function deliveryFrame(frames: Frame[], pos: Positions): number {
  const hy = smooth(median(frames.map((f) => (f.lm ? hands(f.lm).y : NaN)), 2), 1);
  const hipY = smooth(frames.map((f) => (f.lm ? hipMid(f.lm).y : NaN)), 2);
  // A tracked shaft still pointing well above the hands means the club has not started down: the
  // pose has dropped the hands early (it loses them near the top on backlit clips).
  const stillUp = (i: number) => {
    const s = frames[i]?.shaft;
    return !!s && s.gx !== undefined && s.gy !== undefined && Math.atan2(s.gy - s.y, Math.abs(s.x - s.gx) * (frames[i].aspect ?? 1)) > Math.PI / 6;
  };
  let d = Math.round(pos.P3 + (pos.P4 - pos.P3) * 0.6);
  for (let i = pos.P3 + 1; i < pos.P4; i++) {
    if (Number.isFinite(hy[i]) && Number.isFinite(hipY[i]) && hy[i] > hipY[i] && !stillUp(i)) {
      d = i;
      break;
    }
  }
  while (d < pos.P4 - 1 && stillUp(d)) d++;
  return d;
}

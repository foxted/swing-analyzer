import { CameraView, Frame, Positions } from "@/lib/types";
import { firstValid, hands, hipMid, motionEnergy, shoulderWidth, smooth, torsoLen } from "@/lib/geometry";

/** Face-on: shoulders look wide relative to torso height. DTL: narrow. */
export function detectView(frames: Frame[]): CameraView {
  const f = firstValid(frames);
  if (!f?.lm) return "dtl";
  const ratio = shoulderWidth(f.lm) / Math.max(1e-6, torsoLen(f.lm));
  return ratio > 0.55 ? "faceOn" : "dtl";
}

/**
 * Heuristic P-position finder from landmark motion only (no club tracking).
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

  const hx = smooth(frames.map((f) => (f.lm ? hands(f.lm).x : NaN)), 1);
  const hy = smooth(frames.map((f) => (f.lm ? hands(f.lm).y : NaN)), 1);
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

  // P4: fastest hands, biased toward the middle of the clip when there are ties.
  let p4 = 0;
  let best = -1;
  for (let i = 3; i < n - 3; i++) {
    if (handSpeed[i] > best) {
      best = handSpeed[i];
      p4 = i;
    }
  }

  // P1: walk back from P4 to the last sustained quiet window.
  let p1 = 0;
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
  {
    const ax = hx[p1],
      ay = hy[p1];
    let bestD = Infinity,
      bi = p4;
    for (let i = Math.max(p1 + 3, p4 - 6); i <= Math.min(last, p4 + 8); i++) {
      const d = Math.hypot(hx[i] - ax, hy[i] - ay);
      if (d < bestD) {
        bestD = d;
        bi = i;
      }
    }
    p4 = bi;
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

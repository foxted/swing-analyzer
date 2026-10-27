import { LM, Pt, Frame, Handedness } from "@/lib/types";

export const mid = (a: Pt, b: Pt): Pt => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
  z: (a.z + b.z) / 2,
});

export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** Interior angle at `b` in degrees, 2D. */
export function angleAt(a: Pt, b: Pt, c: Pt): number {
  const v1 = { x: a.x - b.x, y: a.y - b.y };
  const v2 = { x: c.x - b.x, y: c.y - b.y };
  const dot = v1.x * v2.x + v1.y * v2.y;
  const m = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
  if (m === 0) return 0;
  return (Math.acos(Math.max(-1, Math.min(1, dot / m))) * 180) / Math.PI;
}

/** Angle of segment a->b from vertical, degrees. 0 = straight up. Signed by x direction. */
export function tiltFromVertical(bottom: Pt, top: Pt): number {
  const dx = top.x - bottom.x;
  const dy = bottom.y - top.y; // image y grows downward
  return (Math.atan2(dx, dy) * 180) / Math.PI;
}

export const lead = (h: Handedness) =>
  h === "right"
    ? {
        shoulder: LM.leftShoulder,
        elbow: LM.leftElbow,
        wrist: LM.leftWrist,
        hip: LM.leftHip,
        knee: LM.leftKnee,
        ankle: LM.leftAnkle,
        foot: LM.leftFootIndex,
      }
    : {
        shoulder: LM.rightShoulder,
        elbow: LM.rightElbow,
        wrist: LM.rightWrist,
        hip: LM.rightHip,
        knee: LM.rightKnee,
        ankle: LM.rightAnkle,
        foot: LM.rightFootIndex,
      };

export const trail = (h: Handedness) => lead(h === "right" ? "left" : "right");

export function hands(lm: Pt[]) {
  return mid(lm[LM.leftWrist], lm[LM.rightWrist]);
}
export function shoulderMid(lm: Pt[]) {
  return mid(lm[LM.leftShoulder], lm[LM.rightShoulder]);
}
export function hipMid(lm: Pt[]) {
  return mid(lm[LM.leftHip], lm[LM.rightHip]);
}
/** Shoulder-mid to hip-mid distance: the unit we normalise displacements by. */
export function torsoLen(lm: Pt[]) {
  return dist(shoulderMid(lm), hipMid(lm));
}
export function shoulderWidth(lm: Pt[]) {
  return dist(lm[LM.leftShoulder], lm[LM.rightShoulder]);
}

/** Simple moving average over frames for a scalar series. */
export function smooth(series: number[], radius = 2): number[] {
  return series.map((_, i) => {
    let s = 0,
      n = 0;
    for (let k = -radius; k <= radius; k++) {
      const v = series[i + k];
      if (v !== undefined && Number.isFinite(v)) {
        s += v;
        n++;
      }
    }
    return n ? s / n : series[i];
  });
}

/** Mean landmark displacement between consecutive frames (motion energy). */
export function motionEnergy(frames: Frame[]): number[] {
  return frames.map((f, i) => {
    const prev = frames[i - 1];
    if (!f.lm || !prev?.lm) return 0;
    let s = 0;
    for (let j = 11; j < 33; j++) s += dist(f.lm[j], prev.lm[j]);
    return s / 22;
  });
}

export function firstValid(frames: Frame[]): Frame | undefined {
  return frames.find((f) => f.lm);
}

/** Interior angle at `b` in degrees, 3D. */
export function angleAt3D(a: Pt, b: Pt, c: Pt): number {
  const v1 = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
  const v2 = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z };
  const dot = v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;
  const m = Math.hypot(v1.x, v1.y, v1.z) * Math.hypot(v2.x, v2.y, v2.z);
  if (m === 0) return 0;
  return (Math.acos(Math.max(-1, Math.min(1, dot / m))) * 180) / Math.PI;
}

type Side = ReturnType<typeof lead>;

/**
 * Knee angle (hip-knee-ankle, 180 = locked) for one side of one frame. Prefers the 3D world
 * landmarks: face-on, knee flex points at the camera, so the 2D image angle reads ~180° whether
 * the knee is soft or locked. Falls back to 2D when there are no world landmarks. NaN when the
 * leg is not visible enough to trust.
 */
export function kneeAngle(f: Frame, side: Side): number {
  if (!f.lm) return NaN;
  const vis = Math.min(
    f.lm[side.hip].visibility ?? 1,
    f.lm[side.knee].visibility ?? 1,
    f.lm[side.ankle].visibility ?? 1
  );
  if (vis < 0.5) return NaN;
  const w = f.world;
  if (w) return angleAt3D(w[side.hip], w[side.knee], w[side.ankle]);
  return angleAt(f.lm[side.hip], f.lm[side.knee], f.lm[side.ankle]);
}

/** Smoothed per-frame trail knee angle (NaN where unknown). */
export function trailKneeSeries(frames: Frame[], hand: Handedness): number[] {
  const t = trail(hand);
  return smooth(frames.map((f) => kneeAngle(f, t)), 2);
}

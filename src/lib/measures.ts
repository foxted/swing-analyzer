import { Frame, Handedness, LM, Pt } from "@/lib/types";
import { ResolvedShaft } from "@/lib/shaft";
import { angleAt, hands, hipMid, kneeAngle, lead, shoulderMid, shoulderWidth, tiltFromVertical, torsoLen, trail } from "@/lib/geometry";

/**
 * One function per check, each returning the check's number for any frame in the units the UI
 * shows (degrees or percent). `metrics.ts` evaluates them at the P-positions to score the swing;
 * `annotations.ts` evaluates them on the current frame for the live on-video readout. Keeping both
 * on the same function is what makes the live number land exactly on the scored one at the key frame.
 */

export type MeasureCtx = {
  /** Address landmarks: the reference most checks compare against. */
  p1: Pt[];
  /** +1 when "toward the target" is +x in the image for this view and handedness. */
  dir: number;
  /** Torso length and shoulder width at address, normalised units. */
  T: number;
  SW: number;
  hand: Handedness;
  /** Video width / height: normalised landmarks are squashed by it, so angles are measured after undoing it. */
  aspect: number;
};

export function measureCtx(p1: Pt[], dir: number, hand: Handedness, aspect = 1): MeasureCtx {
  return { p1, dir, T: Math.max(1e-6, torsoLen(p1)), SW: Math.max(1e-6, shoulderWidth(p1)), hand, aspect };
}

/** Normalised point to undistorted image space (x scaled by the aspect ratio). */
const sq = (p: { x: number; y: number }, aspect: number) => ({ x: p.x * aspect, y: p.y, z: 0 });

export type MeasureId =
  | "headSwayBack"
  | "headSwayImpact"
  | "leadArm"
  | "hipImpact"
  | "spineTilt"
  | "finish"
  | "posture"
  | "earlyExtension"
  | "spineMaintain"
  | "headHeight"
  | "p2Hands";

const posture = (lm: Pt[]) => Math.abs(tiltFromVertical(hipMid(lm), shoulderMid(lm)));
const toeLine = (lm: Pt[]) => (lm[LM.leftFootIndex].x + lm[LM.rightFootIndex].x) / 2;

export const measures: Record<MeasureId, (lm: Pt[], c: MeasureCtx) => number> = {
  /** Nose x away from the target since address, % of shoulder width. */
  headSwayBack: (lm, c) => (((lm[LM.nose].x - c.p1[LM.nose].x) * -c.dir) / c.SW) * 100,
  /** Nose x toward the target since address, % of shoulder width. */
  headSwayImpact: (lm, c) => (((lm[LM.nose].x - c.p1[LM.nose].x) * c.dir) / c.SW) * 100,
  /** Lead elbow angle, degrees (180 = straight). */
  leadArm: (lm, c) => {
    const L = lead(c.hand);
    return angleAt(sq(lm[L.shoulder], c.aspect), sq(lm[L.elbow], c.aspect), sq(lm[L.wrist], c.aspect));
  },
  /** Lead hip ahead of the lead ankle, % of shoulder width. */
  hipImpact: (lm, c) => {
    const L = lead(c.hand);
    return (((lm[L.hip].x - lm[L.ankle].x) * c.dir) / c.SW) * 100;
  },
  /** Spine tilt away from the target, degrees. */
  spineTilt: (lm, c) => tiltFromVertical(hipMid(lm), shoulderMid(lm)) * -c.dir,
  /** Hip centre ahead of the lead ankle, % of shoulder width. */
  finish: (lm, c) => {
    const L = lead(c.hand);
    return (((hipMid(lm).x - lm[L.ankle].x) * c.dir) / c.SW) * 100;
  },
  /** Spine angle from vertical, degrees. */
  posture: (lm) => posture(lm),
  /** Hip centre toward the ball since address, % of torso length. */
  earlyExtension: (lm, c) => (((hipMid(lm).x - hipMid(c.p1).x) * c.dir) / c.T) * 100,
  /** Change in spine angle since address, degrees (negative = stood up). */
  spineMaintain: (lm, c) => posture(lm) - posture(c.p1),
  /** Nose lower than at address, % of torso length. */
  headHeight: (lm, c) => ((lm[LM.nose].y - c.p1[LM.nose].y) / c.T) * 100,
  /** Hands outside the toe line, % of torso length. */
  p2Hands: (lm, c) => (((hands(lm).x - toeLine(lm)) * c.dir) / c.T) * 100,
};

/** Trail knee angle (3D when available), degrees; NaN when the leg is not visible. */
export function trailKnee(frame: Frame, hand: Handedness): number {
  return kneeAngle(frame, trail(hand));
}
/** Lead knee angle (3D when available), degrees; NaN when the leg is not visible. */
export function leadKnee(frame: Frame, hand: Handedness): number {
  return kneeAngle(frame, lead(hand));
}

// ---------------------------------------------------------------------------------------------
// Shaft-based measures. These need the clubhead for the frame (hand mark or automatic detection),
// so they are not in the `measures` table; callers pass the resolved shaft.

/**
 * Wrist set: angle at the lead wrist between the lead forearm and the shaft, degrees. 180 = forearm
 * and shaft in a straight line (no hinge); 90 = fully set. The shaft direction is taken from the
 * hand centre to the clubhead.
 */
export function wristSet(lm: Pt[], shaft: ResolvedShaft, c: MeasureCtx): number {
  const L = lead(c.hand);
  const w = sq(lm[L.wrist], c.aspect);
  const e = sq(lm[L.elbow], c.aspect);
  const h = sq(hands(lm), c.aspect);
  const s = sq(shaft, c.aspect);
  const tip = { x: w.x + (s.x - h.x), y: w.y + (s.y - h.y), z: 0 };
  return angleAt(e, w, tip);
}

/** Shaft angle from horizontal, degrees; positive when the clubhead is below the hands. */
export function shaftFromHorizontal(lm: Pt[], shaft: ResolvedShaft, c: MeasureCtx): number {
  const h = sq(hands(lm), c.aspect);
  const s = sq(shaft, c.aspect);
  return (Math.atan2(s.y - h.y, Math.abs(s.x - h.x)) * 180) / Math.PI;
}

/**
 * Shaft steepness on a down-the-line clip: angle between the shaft and the ground, degrees, as the
 * club profile's `shaftAngle` is defined (clubhead on the ball side, below the hands). Steeper than
 * the address value means the shaft is above the original plane coming down.
 */
export function shaftSteepness(lm: Pt[], shaft: ResolvedShaft, c: MeasureCtx): number {
  const h = sq(hands(lm), c.aspect);
  const s = sq(shaft, c.aspect);
  const dx = (s.x - h.x) * c.dir; // + toward the ball side
  const dy = s.y - h.y; // + downward
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

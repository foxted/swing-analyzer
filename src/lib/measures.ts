import { Frame, Handedness, LM, Pt } from "@/lib/types";
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
};

export function measureCtx(p1: Pt[], dir: number, hand: Handedness): MeasureCtx {
  return { p1, dir, T: Math.max(1e-6, torsoLen(p1)), SW: Math.max(1e-6, shoulderWidth(p1)), hand };
}

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
    return angleAt(lm[L.shoulder], lm[L.elbow], lm[L.wrist]);
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

import { Analysis, CameraView, ClubMark, Frame, Handedness, Metric, Positions, Pt } from "@/lib/types";
import { hands, hipMid, lead, leadKneeSeries, straightKneeRef, trail, trailKneeSeries } from "@/lib/geometry";
import { MeasureId, measureCtx, measures, shaftFromHorizontal, shaftSteepness, wristSet } from "@/lib/measures";
import { shaftAt } from "@/lib/shaft";
import { deliveryFrame } from "@/lib/positions";
import { ClubProfile } from "@/lib/clubs";

/**
 * Explainable scoring. Each metric compares a measured value to a reference range and
 * deducts proportionally to how far outside the range it lands. Score = 10 - deductions.
 * Reference ranges are hand-tuned amateur-friendly targets, not tour data.
 */

/** Degrees of knee flex (short of fully straight) below which a knee counts as locked. */
export const KNEE_LOCKED_FLEX = 2;
/** Flex the trail knee should keep at its straightest point in the backswing. */
export const KNEE_TOP_MIN_FLEX = 4;

type Range = { lo: number; hi: number; tol: number }; // tol = how far past the edge costs the full deduction

function deduct(value: number, r: Range, max: number): number {
  const over = value > r.hi ? value - r.hi : value < r.lo ? r.lo - value : 0;
  if (over <= 0) return 0;
  return Math.min(max, (over / r.tol) * max);
}

/** +1 means "toward the target" in image x for this view/handedness, -1 the opposite. */
function targetDir(view: CameraView, hand: Handedness, lm: Pt[]): number {
  if (view === "faceOn") {
    // Golfer faces camera: their lead side is toward the target.
    return lm[lead(hand).shoulder].x > lm[trail(hand).shoulder].x ? 1 : -1;
  }
  // DTL: ball side is where the hands hang relative to the hips.
  return hands(lm).x > hipMid(lm).x ? 1 : -1;
}

function pick(frames: Frame[], i: number): Pt[] | null {
  return frames[i]?.lm ?? null;
}

/** Wrist set at the top: degrees between lead forearm and shaft (180 = none). */
export const WRIST_TOP = { lo: 55, hi: 110 };
/** Lag at delivery: above this the wrists have released early (casting). */
export const LAG_MAX = 115;

export function analyse(frames: Frame[], pos: Positions, view: CameraView, hand: Handedness, club: ClubProfile, clubMarks: ClubMark[] = []): Analysis {
  const p1 = pick(frames, pos.P1);
  const p2 = pick(frames, pos.P2);
  const p3 = pick(frames, pos.P3);
  const p4 = pick(frames, pos.P4);
  const p6 = pick(frames, pos.P6);
  const metrics: Metric[] = [];
  const missingShaft: string[] = [];
  const straightKnee = straightKneeRef(frames, hand);
  if (!p1 || !p3 || !p4) return { view, score: 0, metrics, straightKnee, missingShaft };

  const dir = targetDir(view, hand, p1);
  const aspect = frames[pos.P1]?.aspect ?? 1;
  const r1 = (v: number) => Math.round(v * 10) / 10;

  // Tempo applies to both views.
  const back = Math.max(1, pos.P3 - pos.P1);
  const down = Math.max(1, pos.P4 - pos.P3);
  const tempo = back / down;
  metrics.push({
    id: "tempo",
    label: "Tempo",
    value: r1(tempo),
    unit: "to 1",
    target: "2.5 to 3.5",
    deduction: deduct(tempo, { lo: 2.5, hi: 3.5, tol: 1.5 }, 1),
    maxDeduction: 1,
    tip: tempo < 2.5 ? "Backswing is quick. Count \"1, 2, 3\" going back and \"1\" coming down." : "Downswing is lazy. Finish the backswing, then swing through with commitment.",
    positions: ["P1", "P3", "P4"],
  });

  // Knee angles are measured as degrees of flex short of fully straight, where "straight" is
  // calibrated from the clip (see straightKneeRef): MediaPipe never reads 180° for a locked knee and
  // the offset differs per person and camera, so absolute thresholds misjudge both checks.
  const straight = straightKnee.angle;
  const flexOf = (angle: number) => Math.max(0, straight - angle);
  const refNote = straightKnee.calibrated ? `straight = ${r1(straight)}°` : `straight assumed ${r1(straight)}°`;

  // Knee flex at address: soft, not locked, not sitting. 3D angle, so it works from either view.
  const leadKnees = leadKneeSeries(frames, hand);
  const kneeAddr = leadKnees[pos.P1];
  if (Number.isFinite(kneeAddr)) {
    const flex = flexOf(kneeAddr);
    metrics.push({
      id: "kneeFlex",
      label: "Knee flex at address",
      value: r1(flex),
      unit: "° flex",
      detail: refNote,
      target: `${KNEE_LOCKED_FLEX} to 25°`,
      deduction: deduct(flex, { lo: KNEE_LOCKED_FLEX, hi: 25, tol: 10 }, 1),
      maxDeduction: 1,
      tip: flex < KNEE_LOCKED_FLEX ? "Knees are locked at address. Soften them, like you're about to sit on a tall stool." : "Knees are too bent at address. Stand slightly taller and bend from the hips instead.",
      positions: ["P1"],
    });
  }

  // Trail knee lock: the trail knee should keep the flex it had at address through the backswing.
  // Straightening it kills the trail-hip load and usually brings sway with it. Two checks, the worse
  // one counts: how much flex is left at the knee's straightest point (a locked knee is locked
  // whatever address looked like) and how much it straightened from address. One-sided on purpose:
  // extra flex going back is never penalised.
  const kneeSeries = trailKneeSeries(frames, hand);
  const kneeP1 = kneeSeries[pos.P1];
  if (Number.isFinite(kneeP1)) {
    const from = Math.min(pos.P1, pos.P3);
    const to = Math.max(pos.P1, pos.P3);
    let peak = pos.P1;
    for (let i = from; i <= to; i++) if (kneeSeries[i] > kneeSeries[peak]) peak = i;
    const kneePeak = kneeSeries[peak];
    const flexTop = flexOf(kneePeak);
    const flexAddr = flexOf(kneeP1);
    const straighten = Math.max(0, kneePeak - kneeP1);
    const tip =
      flexAddr < KNEE_LOCKED_FLEX
        ? `Trail knee is already locked at address and stays that way to the top. Set some flex at address and keep it all the way back, knee pointing at the ball.`
        : flexTop < KNEE_TOP_MIN_FLEX
          ? `Trail knee locks going back (${r1(flexAddr)}° of flex at address, ${r1(flexTop)}° at the top). Keep the flex you set at address all the way to the top, knee pointing at the ball.`
          : `Trail knee straightens going back (${r1(flexAddr)}° of flex at address, ${r1(flexTop)}° at the top). Keep the flex you set at address all the way to the top, knee pointing at the ball.`;
    metrics.push({
      id: "trailKnee",
      label: "Trail knee in backswing",
      value: r1(flexTop),
      unit: "° flex left",
      detail: `at its straightest · address ${r1(flexAddr)}° · ${refNote}`,
      target: `at least ${KNEE_TOP_MIN_FLEX}°, within 8° of address`,
      deduction: Math.max(deduct(flexTop, { lo: KNEE_TOP_MIN_FLEX, hi: Infinity, tol: 4 }, 1.5), deduct(straighten, { lo: -Infinity, hi: 8, tol: 12 }, 1.5)),
      maxDeduction: 1.5,
      tip,
      positions: ["P1", "P2", "P3"],
      frame: peak,
    });
  }

  const mc = measureCtx(p1, dir, hand, aspect);
  const at = (id: MeasureId, lm: Pt[]) => measures[id](lm, mc);

  // Shaft checks: need the clubhead on the frame, from a hand mark or the automatic detection.
  const delivery = deliveryFrame(frames, pos);
  const shaftTop = shaftAt(frames[pos.P3], clubMarks);
  const shaftDel = shaftAt(frames[delivery], clubMarks);
  const pDel = pick(frames, delivery);
  if (view === "faceOn") {
    if (shaftTop) {
      const set = wristSet(p3, shaftTop, mc);
      metrics.push({
        id: "wristTop",
        label: "Wrist set at the top",
        value: r1(set),
        unit: "°",
        detail: "lead forearm to shaft · 90° = fully set, 180° = none",
        target: `${WRIST_TOP.lo} to ${WRIST_TOP.hi}°`,
        deduction: deduct(set, { lo: WRIST_TOP.lo, hi: WRIST_TOP.hi, tol: 25 }, 1),
        maxDeduction: 1,
        tip: set > WRIST_TOP.hi ? "Little wrist set at the top. Let the wrists hinge going back so the shaft sits close to 90° to the lead arm." : "Over-hinged at the top. Keep the hinge short of 90° so you do not have to recover it on the way down.",
        positions: ["P3"],
      });
    } else missingShaft.push("Wrist set at the top");
    if (shaftTop && shaftDel && pDel) {
      const top = wristSet(p3, shaftTop, mc);
      const del = wristSet(pDel, shaftDel, mc);
      const opened = del - top;
      metrics.push({
        id: "lag",
        label: "Lag at delivery",
        value: r1(del),
        unit: "°",
        detail: `opened ${r1(opened)}° since the top · hands at hip height coming down`,
        target: `${LAG_MAX}° or less`,
        deduction: deduct(del, { lo: -Infinity, hi: LAG_MAX, tol: 30 }, 2),
        maxDeduction: 2,
        tip: "Casting: the wrist angle releases early in the downswing. Start down with the lower body and keep the hands leading the clubhead until just before impact.",
        positions: ["P3", "P4"],
        frame: delivery,
      });
    } else if (shaftTop) missingShaft.push("Lag at delivery");
  } else {
    if (shaftTop) {
      const v = shaftFromHorizontal(p3, shaftTop, mc);
      metrics.push({
        id: "shaftTop",
        label: "Shaft at the top",
        value: r1(v),
        unit: "°",
        detail: "clubhead below (+) or above (−) the hands · 0 = parallel to the ground",
        target: "-30 to 20°",
        deduction: deduct(v, { lo: -30, hi: 20, tol: 25 }, 1),
        maxDeduction: 1,
        tip: v > 20 ? "Past parallel at the top: the clubhead drops well below the hands. Shorten the backswing so the shaft stops near parallel." : "Very short of parallel at the top. Complete the shoulder turn before starting down.",
        positions: ["P3"],
      });
    } else missingShaft.push("Shaft at the top");
    if (shaftDel && pDel) {
      const steep = shaftSteepness(pDel, shaftDel, mc) - club.shaftAngle;
      metrics.push({
        id: "shaftDelivery",
        label: "Shaft plane at delivery",
        value: r1(steep),
        unit: "°",
        detail: `steeper (+) or shallower (−) than the ${club.shaftAngle}° address plane · hands at hip height coming down`,
        target: "-15 to 12°",
        deduction: deduct(steep, { lo: -15, hi: 12, tol: 20 }, 1.5),
        maxDeduction: 1.5,
        tip: steep > 12 ? "Over the top: the shaft comes down steeper than the address plane. Feel the trail elbow drop toward the hip to start the downswing." : "Shaft drops under the plane coming down. Keep the hands moving down and out toward the ball.",
        positions: ["P3", "P4"],
        frame: delivery,
      });
    } else missingShaft.push("Shaft plane at delivery");
  }

  if (view === "faceOn") {
    // Head sway: nose x displacement toward/away from target, in shoulder widths.
    const swayTop = at("headSwayBack", p3); // + = away from target
    const swayImpact = at("headSwayImpact", p4); // + = toward target
    metrics.push({
      id: "headSwayBack",
      label: "Head sway going back",
      value: r1(swayTop),
      unit: "%",
      detail: "of shoulder width, away from target",
      target: "-10 to 25%",
      deduction: deduct(swayTop, { lo: -10, hi: 25, tol: 30 }, 2),
      maxDeduction: 2,
      tip: swayTop > 25 ? "Head slides away from the target going back. Turn around your trail hip instead of sliding onto it." : "Head moves toward the target going back. Let your weight settle into the trail foot at the top.",
      positions: ["P1", "P3"],
    });
    metrics.push({
      id: "headSwayImpact",
      label: "Head at impact",
      value: r1(swayImpact),
      unit: "%",
      detail: "of shoulder width, toward target",
      target: `${club.headAtImpact[0] * 100} to ${club.headAtImpact[1] * 100}%`,
      deduction: deduct(swayImpact, { lo: club.headAtImpact[0] * 100, hi: club.headAtImpact[1] * 100, tol: 30 }, 1.5),
      maxDeduction: 1.5,
      tip: swayImpact > club.headAtImpact[1] * 100 ? "Head lunges past the ball at impact. Keep your head behind the ball until the club has struck it." : "Head stays well behind at impact. Push your weight onto the lead foot as you start down.",
      positions: ["P1", "P4"],
    });

    // Lead arm straightness at the top.
    const leadArm = at("leadArm", p3);
    metrics.push({
      id: "leadArm",
      label: "Lead arm at the top",
      value: r1(leadArm),
      unit: "°",
      target: "155 to 180°",
      deduction: deduct(leadArm, { lo: 155, hi: 181, tol: 30 }, 1.5),
      maxDeduction: 1.5,
      tip: "Lead arm bends at the top. Keep it long and let the trail elbow fold instead.",
      positions: ["P3"],
    });

    // Hip position at impact: lead hip should be over or ahead of lead ankle.
    const hipLead = at("hipImpact", p4);
    metrics.push({
      id: "hipImpact",
      label: "Hips at impact",
      value: r1(hipLead),
      unit: "%",
      detail: "of shoulder width ahead of the lead ankle",
      target: "0 to 35%",
      deduction: deduct(hipLead, { lo: 0, hi: 35, tol: 30 }, 1.5),
      maxDeduction: 1.5,
      tip: hipLead < 0 ? "Hips hang back at impact. Start the downswing by pushing into the lead foot." : "Hips slide past the lead foot. Turn the lead hip back behind you instead of sliding.",
      positions: ["P4"],
    });

    // Spine tilt at address (away from target).
    const tilt = at("spineTilt", p1);
    metrics.push({
      id: "spineTilt",
      label: "Spine tilt at address",
      value: r1(tilt),
      unit: "°",
      detail: "away from target",
      target: `${club.spineTilt[0]} to ${club.spineTilt[1]}°`,
      deduction: deduct(tilt, { lo: club.spineTilt[0], hi: club.spineTilt[1], tol: 12 }, 1),
      maxDeduction: 1,
      tip: tilt < club.spineTilt[0] ? "Add a little tilt away from the target at address: bump the lead hip toward the target so the trail shoulder sits lower." : `Too much tilt away from the target for a ${club.label.toLowerCase()}. Level the shoulders a touch at address.`,
      positions: ["P1"],
    });

    // Finish: hips stacked over the lead foot.
    if (p6) {
      const finishHips = at("finish", p6);
      metrics.push({
        id: "finish",
        label: "Balance at finish",
        value: r1(finishHips),
        unit: "%",
        detail: "hips past the lead ankle, of shoulder width",
        target: "-25 to 15%",
        deduction: deduct(finishHips, { lo: -25, hi: 15, tol: 30 }, 1),
        maxDeduction: 1,
        tip: "Weight isn't fully on the lead foot at the finish. Hold your finish for three seconds, trail heel up, chest at the target.",
        positions: ["P6"],
      });
    }
  } else {
    // DTL
    const spineP1 = at("posture", p1);
    metrics.push({
      id: "posture",
      label: "Posture at address",
      value: r1(spineP1),
      unit: "°",
      detail: "spine from vertical",
      target: `${club.posture[0]} to ${club.posture[1]}°`,
      deduction: deduct(spineP1, { lo: club.posture[0], hi: club.posture[1], tol: 15 }, 1.5),
      maxDeduction: 1.5,
      tip: spineP1 < club.posture[0] ? "Standing too tall. Push your hips back and bow from the hips, back flat." : "Bent over too far. Stand a little taller and let the arms hang under the shoulders.",
      positions: ["P1"],
    });

    // Early extension: hips moving toward the ball between address and impact.
    const ee = at("earlyExtension", p4); // + = toward ball
    metrics.push({
      id: "earlyExtension",
      label: "Early extension",
      value: r1(ee),
      unit: "%",
      detail: "of torso toward the ball since address",
      target: `${club.earlyExtension[0] * 100} to ${club.earlyExtension[1] * 100}%`,
      deduction: deduct(ee, { lo: club.earlyExtension[0] * 100, hi: club.earlyExtension[1] * 100, tol: 25 }, 2),
      maxDeduction: 2,
      tip: "Hips move toward the ball coming down. Keep your trail glute back, as if against a wall, through impact.",
      positions: ["P1", "P4"],
    });

    const spineDelta = at("spineMaintain", p4);
    metrics.push({
      id: "spineMaintain",
      label: "Posture at impact",
      value: r1(spineDelta),
      unit: "°",
      detail: "change since address, negative = stood up",
      target: "-8 to 10°",
      deduction: deduct(spineDelta, { lo: -8, hi: 10, tol: 15 }, 1.5),
      maxDeduction: 1.5,
      tip: spineDelta < -8 ? "You stand up out of posture into impact. Keep your chest down over the ball until after the strike." : "You dip into impact. Keep your head height steady from address to impact.",
      positions: ["P1", "P4"],
    });

    const headDrop = at("headHeight", p4); // + = lower in image
    metrics.push({
      id: "headHeight",
      label: "Head height at impact",
      value: r1(headDrop),
      unit: "%",
      detail: "of torso lower than address",
      target: "-10 to 15%",
      deduction: deduct(headDrop, { lo: -10, hi: 15, tol: 25 }, 1),
      maxDeduction: 1,
      tip: headDrop < -10 ? "Head rises into impact. Keep the chest over the ball through the strike." : "Head drops a lot into impact. Stay at your address height.",
      positions: ["P1", "P4"],
    });

    // P2 hands relative to the toe line (on plane = hands over or just outside the toes).
    if (p2) {
      const handsP2 = at("p2Hands", p2); // + = outside toe line (toward ball)
      metrics.push({
        id: "p2Hands",
        label: "Takeaway hands",
        value: r1(handsP2),
        unit: "%",
        detail: "of torso outside the toe line",
        target: "-20 to 20%",
        deduction: deduct(handsP2, { lo: -20, hi: 20, tol: 30 }, 1),
        maxDeduction: 1,
        tip: handsP2 > 20 ? "Hands move out away from you in the takeaway. Keep them in front of your chest as the chest turns." : "Hands pull in behind you in the takeaway. Let the chest turn move the hands and keep them in front of you.",
        positions: ["P2"],
      });
    }

    // Lead arm at the top, same as face-on.
    const leadArm = at("leadArm", p3);
    metrics.push({
      id: "leadArm",
      label: "Lead arm at the top",
      value: r1(leadArm),
      unit: "°",
      target: "150 to 180°",
      deduction: deduct(leadArm, { lo: 150, hi: 181, tol: 30 }, 1),
      maxDeduction: 1,
      tip: "Lead arm bends at the top. Keep it long and let the trail elbow fold instead.",
      positions: ["P3"],
    });
  }

  const total = metrics.reduce((s, m) => s + m.deduction, 0);
  const score = Math.max(0, Math.round((10 - total) * 10) / 10);
  return { view, score, metrics: metrics.map((m) => ({ ...m, deduction: Math.round(m.deduction * 10) / 10 })), straightKnee, missingShaft };
}

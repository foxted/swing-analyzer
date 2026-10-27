import { Analysis, CameraView, Frame, Handedness, LM, Metric, Positions, Pt } from "@/lib/types";
import { angleAt, hands, hipMid, lead, shoulderMid, shoulderWidth, tiltFromVertical, torsoLen, trail } from "@/lib/geometry";

/**
 * Explainable scoring. Each metric compares a measured value to a reference range and
 * deducts proportionally to how far outside the range it lands. Score = 10 - deductions.
 * Reference ranges are hand-tuned amateur-friendly targets, not tour data.
 */

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

export function analyse(frames: Frame[], pos: Positions, view: CameraView, hand: Handedness): Analysis {
  const p1 = pick(frames, pos.P1);
  const p2 = pick(frames, pos.P2);
  const p3 = pick(frames, pos.P3);
  const p4 = pick(frames, pos.P4);
  const p6 = pick(frames, pos.P6);
  const metrics: Metric[] = [];
  if (!p1 || !p3 || !p4) return { view, score: 0, metrics };

  const T = Math.max(1e-6, torsoLen(p1));
  const SW = Math.max(1e-6, shoulderWidth(p1));
  const L = lead(hand);
  const dir = targetDir(view, hand, p1);
  const r1 = (v: number) => Math.round(v * 10) / 10;

  // Tempo applies to both views.
  const back = Math.max(1, pos.P3 - pos.P1);
  const down = Math.max(1, pos.P4 - pos.P3);
  const tempo = back / down;
  metrics.push({
    id: "tempo",
    label: "Tempo (backswing : downswing)",
    value: r1(tempo),
    unit: ": 1",
    target: "2.5 to 3.5 : 1",
    deduction: deduct(tempo, { lo: 2.5, hi: 3.5, tol: 1.5 }, 1),
    maxDeduction: 1,
    tip: tempo < 2.5 ? "Backswing is rushed relative to the downswing. Try a slower takeaway." : "Downswing is slow relative to the backswing. Commit through the ball.",
    positions: ["P1", "P3", "P4"],
  });

  if (view === "faceOn") {
    // Head sway: nose x displacement toward/away from target, in shoulder widths.
    const swayTop = ((p3[LM.nose].x - p1[LM.nose].x) * -dir) / SW; // + = away from target
    const swayImpact = ((p4[LM.nose].x - p1[LM.nose].x) * dir) / SW; // + = toward target
    metrics.push({
      id: "headSwayBack",
      label: "Head sway in backswing",
      value: r1(swayTop * 100),
      unit: "% shoulder width (away from target)",
      target: "-10 to 25%",
      deduction: deduct(swayTop, { lo: -0.1, hi: 0.25, tol: 0.3 }, 2),
      maxDeduction: 2,
      tip: swayTop > 0.25 ? "Head drifts off the ball going back. Feel the trail hip load without sliding." : "Head moves toward the target going back (reverse pivot). Let the weight settle into the trail side.",
      positions: ["P1", "P3"],
    });
    metrics.push({
      id: "headSwayImpact",
      label: "Head position at impact",
      value: r1(swayImpact * 100),
      unit: "% shoulder width (toward target)",
      target: "-15 to 10%",
      deduction: deduct(swayImpact, { lo: -0.15, hi: 0.1, tol: 0.3 }, 1.5),
      maxDeduction: 1.5,
      tip: swayImpact > 0.1 ? "Head lunges toward the target at impact. Keep the head behind the ball through the strike." : "Head hangs well behind at impact; that is fine for driver, less so for irons.",
      positions: ["P1", "P4"],
    });

    // Lead arm straightness at the top.
    const leadArm = angleAt(p3[L.shoulder], p3[L.elbow], p3[L.wrist]);
    metrics.push({
      id: "leadArm",
      label: "Lead arm at the top",
      value: r1(leadArm),
      unit: "°",
      target: "155 to 180°",
      deduction: deduct(leadArm, { lo: 155, hi: 181, tol: 30 }, 1.5),
      maxDeduction: 1.5,
      tip: "Lead arm collapses at the top. Width in the backswing comes from the trail arm folding, not the lead arm.",
      positions: ["P3"],
    });

    // Hip position at impact: lead hip should be over or ahead of lead ankle.
    const hipLead = ((p4[L.hip].x - p4[L.ankle].x) * dir) / SW;
    metrics.push({
      id: "hipImpact",
      label: "Lead hip vs lead ankle at impact",
      value: r1(hipLead * 100),
      unit: "% shoulder width (ahead of ankle)",
      target: "0 to 35%",
      deduction: deduct(hipLead, { lo: 0, hi: 0.35, tol: 0.3 }, 1.5),
      maxDeduction: 1.5,
      tip: hipLead < 0 ? "Hips hang back at impact. Start the downswing by shifting pressure into the lead foot." : "Hips slide too far past the lead foot. Rotate rather than slide.",
      positions: ["P4"],
    });

    // Spine tilt at address (away from target).
    const tilt = tiltFromVertical(hipMid(p1), shoulderMid(p1)) * -dir; // + = away from target
    metrics.push({
      id: "spineTilt",
      label: "Spine tilt at address",
      value: r1(tilt),
      unit: "° away from target",
      target: "3 to 15°",
      deduction: deduct(tilt, { lo: 3, hi: 15, tol: 12 }, 1),
      maxDeduction: 1,
      tip: tilt < 3 ? "Upper body is centred or leaning toward the target at address. Bump the lead hip slightly toward the target so the spine tilts away." : "Too much tilt away from the target at address for an iron.",
      positions: ["P1"],
    });

    // Finish: hips stacked over the lead foot.
    if (p6) {
      const finishHips = ((hipMid(p6).x - p6[L.ankle].x) * dir) / SW;
      metrics.push({
        id: "finish",
        label: "Hips over lead foot at finish",
        value: r1(finishHips * 100),
        unit: "% shoulder width (ahead of lead ankle)",
        target: "-25 to 15%",
        deduction: deduct(finishHips, { lo: -0.25, hi: 0.15, tol: 0.3 }, 1),
        maxDeduction: 1,
        tip: "Weight is not fully on the lead side at the finish. Hold the finish with the trail toe down and chest at the target.",
        positions: ["P6"],
      });
    }
  } else {
    // DTL
    const spineP1 = Math.abs(tiltFromVertical(hipMid(p1), shoulderMid(p1)));
    metrics.push({
      id: "posture",
      label: "Spine angle at address",
      value: r1(spineP1),
      unit: "° from vertical",
      target: "28 to 45°",
      deduction: deduct(spineP1, { lo: 28, hi: 45, tol: 15 }, 1.5),
      maxDeduction: 1.5,
      tip: spineP1 < 28 ? "Standing too tall at address. Hinge more from the hips, keep the back flat." : "Bent over too much. Stand a little taller and let the arms hang.",
      positions: ["P1"],
    });

    const knee = angleAt(p1[L.hip], p1[L.knee], p1[L.ankle]);
    metrics.push({
      id: "kneeFlex",
      label: "Knee flex at address",
      value: r1(knee),
      unit: "° (180 = locked)",
      target: "150 to 172°",
      deduction: deduct(knee, { lo: 150, hi: 172, tol: 15 }, 1),
      maxDeduction: 1,
      tip: knee > 172 ? "Knees are locked. Soften them a touch." : "Too much knee bend; it usually comes with a rounded back.",
      positions: ["P1"],
    });

    // Early extension: hips moving toward the ball between address and impact.
    const ee = ((hipMid(p4).x - hipMid(p1).x) * dir) / T; // + = toward ball
    metrics.push({
      id: "earlyExtension",
      label: "Hip movement toward ball at impact",
      value: r1(ee * 100),
      unit: "% torso length",
      target: "-10 to 12%",
      deduction: deduct(ee, { lo: -0.1, hi: 0.12, tol: 0.25 }, 2),
      maxDeduction: 2,
      tip: "Early extension: the hips thrust toward the ball in the downswing. Keep the trail glute back against an imaginary wall through impact.",
      positions: ["P1", "P4"],
    });

    const spineP4 = Math.abs(tiltFromVertical(hipMid(p4), shoulderMid(p4)));
    const spineDelta = spineP4 - spineP1;
    metrics.push({
      id: "spineMaintain",
      label: "Spine angle change at impact",
      value: r1(spineDelta),
      unit: "° (negative = stood up)",
      target: "-8 to 10°",
      deduction: deduct(spineDelta, { lo: -8, hi: 10, tol: 15 }, 1.5),
      maxDeduction: 1.5,
      tip: spineDelta < -8 ? "Standing up out of posture into impact. Keep the chest down over the ball." : "Dipping into impact. Maintain the address height.",
      positions: ["P1", "P4"],
    });

    const headDrop = (p4[LM.nose].y - p1[LM.nose].y) / T; // + = lower in image
    metrics.push({
      id: "headHeight",
      label: "Head height change at impact",
      value: r1(headDrop * 100),
      unit: "% torso length (positive = lower)",
      target: "-10 to 15%",
      deduction: deduct(headDrop, { lo: -0.1, hi: 0.15, tol: 0.25 }, 1),
      maxDeduction: 1,
      tip: headDrop < -0.1 ? "Head rises into impact. Usually a symptom of early extension." : "Head drops a lot into impact.",
      positions: ["P1", "P4"],
    });

    // P2 hands relative to the toe line (on plane = hands over or just outside the toes).
    if (p2) {
      const toes = (p2[LM.leftFootIndex].x + p2[LM.rightFootIndex].x) / 2;
      const handsP2 = ((hands(p2).x - toes) * dir) / T; // + = outside toe line (toward ball)
      metrics.push({
        id: "p2Hands",
        label: "Hands vs toe line at P2",
        value: r1(handsP2 * 100),
        unit: "% torso length (positive = outside toes)",
        target: "-20 to 20%",
        deduction: deduct(handsP2, { lo: -0.2, hi: 0.2, tol: 0.3 }, 1),
        maxDeduction: 1,
        tip: handsP2 > 0.2 ? "Hands work outside the line in the takeaway; club tends to get steep." : "Hands pull inside early in the takeaway; club tends to get flat and behind.",
        positions: ["P2"],
      });
    }

    // Lead arm at the top, same as face-on.
    const leadArm = angleAt(p3[L.shoulder], p3[L.elbow], p3[L.wrist]);
    metrics.push({
      id: "leadArm",
      label: "Lead arm at the top",
      value: r1(leadArm),
      unit: "°",
      target: "150 to 180°",
      deduction: deduct(leadArm, { lo: 150, hi: 181, tol: 30 }, 1),
      maxDeduction: 1,
      tip: "Lead arm collapses at the top.",
      positions: ["P3"],
    });
  }

  const total = metrics.reduce((s, m) => s + m.deduction, 0);
  const score = Math.max(0, Math.round((10 - total) * 10) / 10);
  return { view, score, metrics: metrics.map((m) => ({ ...m, deduction: Math.round(m.deduction * 10) / 10 })) };
}

import { CameraView, Frame, Handedness, LM, Metric, Positions, Pt } from "@/lib/types";
import { hands, hipMid, lead, shoulderMid, trail } from "@/lib/geometry";
import { MeasureId, leadKnee, measureCtx, measures, trailKnee } from "@/lib/measures";

/**
 * On-video check annotations: for each selected check, the geometry it measures drawn on the
 * current frame with a live number, plus a stats card listing the scored results. Everything is
 * sized off the clip's long edge so a 1080p and a 4K export read the same.
 */

export type ChecksState = {
  metrics: Metric[];
  /** Metric ids to draw; "score" shows the overall score at the top of the card. */
  selected: string[];
  score: number;
  positions: Positions;
  currentIndex: number;
  /** Knee angle that reads as fully straight for this clip (see geometry.ts straightKneeRef). */
  straightKnee: number;
};

type P = { x: number; y: number };
type Env = {
  ctx: CanvasRenderingContext2D;
  px: (p: Pt) => P;
  width: number;
  height: number;
  /** Base unit for strokes and radii. */
  u: number;
  font: number;
  lm: Pt[];
  p1: Pt[];
  hand: Handedness;
  dir: number;
};

const COLOR = { good: "#4ade80", warn: "#fbbf24", bad: "#f87171", ref: "rgba(255,255,255,0.75)" };

function tone(m: Metric): string {
  return m.deduction === 0 ? COLOR.good : m.deduction < m.maxDeduction / 2 ? COLOR.warn : COLOR.bad;
}

const deg = (v: number) => `${Math.round(v * 10) / 10}°`;
const pct = (v: number) => `${Math.round(v)}%`;

/** Short unit for the card, derived from the metric's long unit string. */
function shortUnit(m: Metric): string {
  if (m.id === "tempo") return " : 1";
  if (m.unit.startsWith("°")) return "°";
  if (m.unit.startsWith("%")) return "%";
  return "";
}

/** +1 when "toward the target" is +x in the image. Same rule as metrics.ts. */
function targetDir(view: CameraView, hand: Handedness, lm: Pt[]): number {
  if (view === "faceOn") return lm[lead(hand).shoulder].x > lm[trail(hand).shoulder].x ? 1 : -1;
  return hands(lm).x > hipMid(lm).x ? 1 : -1;
}

export function drawChecks(
  ctx: CanvasRenderingContext2D,
  o: { width: number; height: number; frame: Frame | undefined; address: Frame | undefined; view: CameraView; hand: Handedness; checks: ChecksState }
) {
  const { width, height, frame, address, view, hand, checks } = o;
  if (!checks.selected.length) return;
  const long = Math.max(width, height);
  const u = Math.max(2, long / 480);
  const font = Math.max(12, Math.round(long / 64));
  const byId = new Map(checks.metrics.map((m) => [m.id, m]));
  const selected = checks.selected.filter((id) => id === "score" || byId.has(id));

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (frame?.lm && address?.lm) {
    const env: Env = {
      ctx,
      px: (p) => ({ x: p.x * width, y: p.y * height }),
      width,
      height,
      u,
      font,
      lm: frame.lm,
      p1: address.lm,
      hand,
      dir: targetDir(view, hand, address.lm),
    };
    const mc = measureCtx(address.lm, env.dir, hand);
    const live = (id: MeasureId) => measures[id](frame.lm!, mc);
    for (const id of selected) {
      const m = byId.get(id);
      if (!m) continue;
      drawGeometry(env, m, id, live, frame, checks);
    }
  }

  drawCard(ctx, checks, selected, byId, u, font);
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------
// Per-check geometry

function drawGeometry(env: Env, m: Metric, id: string, live: (id: MeasureId) => number, frame: Frame, checks: ChecksState) {
  const { lm, p1, px, hand, dir } = env;
  const L = lead(hand);
  const T = trail(hand);
  const c = tone(m);
  switch (id) {
    case "trailKnee": {
      const v = trailKnee(frame, hand);
      if (!Number.isFinite(v)) return;
      angle(env, px(lm[T.hip]), px(lm[T.knee]), px(lm[T.ankle]), c, `${deg(Math.max(0, checks.straightKnee - v))} knee flex`);
      return;
    }
    case "kneeFlex": {
      const v = leadKnee(frame, hand);
      if (!Number.isFinite(v)) return;
      angle(env, px(lm[L.hip]), px(lm[L.knee]), px(lm[L.ankle]), c, `${deg(Math.max(0, checks.straightKnee - v))} knee flex`);
      return;
    }
    case "leadArm":
      angle(env, px(lm[L.shoulder]), px(lm[L.elbow]), px(lm[L.wrist]), c, `${deg(live("leadArm"))} lead arm`);
      return;
    case "posture":
    case "spineTilt":
    case "spineMaintain": {
      const hip = px(hipMid(lm));
      const sh = px(shoulderMid(lm));
      const len = Math.hypot(sh.x - hip.x, sh.y - hip.y);
      line(env, hip, sh, c, env.u * 1.2);
      line(env, hip, { x: hip.x, y: hip.y - len }, COLOR.ref, env.u * 0.6, true);
      angle(env, { x: hip.x, y: hip.y - len }, hip, sh, c, id === "spineMaintain" ? `${signed(live("spineMaintain"))}° vs address` : `${deg(live(id))} spine`, true);
      return;
    }
    case "headSwayBack":
    case "headSwayImpact": {
      const ref = px(p1[LM.nose]);
      const nose = px(lm[LM.nose]);
      const half = env.height * 0.08;
      line(env, { x: ref.x, y: ref.y - half }, { x: ref.x, y: ref.y + half }, COLOR.ref, env.u * 0.6, true);
      arrow(env, { x: ref.x, y: nose.y }, nose, c);
      label(env, `${pct(live(id))} head ${id === "headSwayBack" ? "away" : "toward target"}`, nose.x, nose.y - env.font * 1.6, c);
      return;
    }
    case "hipImpact":
    case "finish": {
      const ankle = px(lm[L.ankle]);
      const hip = id === "hipImpact" ? px(lm[L.hip]) : px(hipMid(lm));
      line(env, { x: ankle.x, y: ankle.y }, { x: ankle.x, y: hip.y - env.height * 0.05 }, COLOR.ref, env.u * 0.6, true);
      arrow(env, { x: ankle.x, y: hip.y }, hip, c);
      label(env, `${pct(live(id))} hips ahead`, hip.x, hip.y - env.font * 1.6, c);
      return;
    }
    case "earlyExtension": {
      const ref = px(hipMid(p1));
      const hip = px(hipMid(lm));
      line(env, { x: ref.x, y: 0 }, { x: ref.x, y: env.height }, COLOR.ref, env.u * 0.6, true);
      arrow(env, { x: ref.x, y: hip.y }, hip, c);
      label(env, `${pct(live(id))} toward ball`, hip.x + dir * env.font, hip.y - env.font * 1.6, c);
      return;
    }
    case "headHeight": {
      const ref = px(p1[LM.nose]);
      const nose = px(lm[LM.nose]);
      const half = env.width * 0.08;
      line(env, { x: ref.x - half, y: ref.y }, { x: ref.x + half, y: ref.y }, COLOR.ref, env.u * 0.6, true);
      arrow(env, { x: nose.x, y: ref.y }, nose, c);
      label(env, `${signed(live(id))}% head height`, nose.x, Math.min(ref.y, nose.y) - env.font * 1.6, c);
      return;
    }
    case "p2Hands": {
      const toes = px({ x: (lm[LM.leftFootIndex].x + lm[LM.rightFootIndex].x) / 2, y: 0, z: 0 });
      const h = px(hands(lm));
      line(env, { x: toes.x, y: 0 }, { x: toes.x, y: env.height }, COLOR.ref, env.u * 0.6, true);
      arrow(env, { x: toes.x, y: h.y }, h, c);
      label(env, `${pct(live(id))} hands outside toes`, h.x, h.y - env.font * 1.6, c);
      return;
    }
    case "tempo": {
      // No geometry: a small progress bar under the card shows where the current frame sits.
      const { P1, P3, P4 } = checks.positions;
      const i = checks.currentIndex;
      const phase = i < P1 ? "setup" : i <= P3 ? "backswing" : i <= P4 ? "downswing" : "through";
      const t = i <= P3 ? (i - P1) / Math.max(1, P3 - P1) : 1 + (i - P3) / Math.max(1, P4 - P3);
      tempoBar(env, Math.max(0, Math.min(2, t)), phase, c, m.value);
      return;
    }
  }
}

const signed = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v * 10) / 10}`;

function line(env: Env, a: P, b: P, color: string, w: number, dashed = false) {
  const { ctx } = env;
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.setLineDash(dashed ? [env.u * 3, env.u * 3] : []);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.setLineDash([]);
}

function arrow(env: Env, from: P, to: P, color: string) {
  const { ctx, u } = env;
  const d = Math.hypot(to.x - from.x, to.y - from.y);
  line(env, from, to, color, u * 1.2);
  if (d < u * 3) return;
  const ang = Math.atan2(to.y - from.y, to.x - from.x);
  const h = u * 4;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - h * Math.cos(ang - 0.5), to.y - h * Math.sin(ang - 0.5));
  ctx.lineTo(to.x - h * Math.cos(ang + 0.5), to.y - h * Math.sin(ang + 0.5));
  ctx.closePath();
  ctx.fill();
}

/** Arc at `b` between the rays to `a` and `c`, limbs highlighted, label at the arc's bisector. */
function angle(env: Env, a: P, b: P, c: P, color: string, text: string, skipLimbs = false) {
  const { ctx, u } = env;
  if (!skipLimbs) {
    line(env, b, a, color, u * 1.4);
    line(env, b, c, color, u * 1.4);
  }
  const a1 = Math.atan2(a.y - b.y, a.x - b.x);
  const a2 = Math.atan2(c.y - b.y, c.x - b.x);
  let sweep = a2 - a1;
  while (sweep > Math.PI) sweep -= 2 * Math.PI;
  while (sweep < -Math.PI) sweep += 2 * Math.PI;
  const r = Math.min(Math.hypot(a.x - b.x, a.y - b.y), Math.hypot(c.x - b.x, c.y - b.y)) * 0.35;
  ctx.strokeStyle = color;
  ctx.lineWidth = u * 1.2;
  ctx.beginPath();
  ctx.arc(b.x, b.y, r, a1, a1 + sweep, sweep < 0);
  ctx.stroke();
  const mid = a1 + sweep / 2;
  // Label sits just outside the arc, nudged away from the joint.
  label(env, text, b.x + Math.cos(mid) * (r + env.font * 1.2), b.y + Math.sin(mid) * (r + env.font * 1.2), color);
}

/** Centred text on a dark rounded pill so it stays legible over grass and sky. */
function label(env: Env, text: string, x: number, y: number, color: string) {
  const { ctx, font, width, u } = env;
  ctx.font = `600 ${font}px system-ui, -apple-system, sans-serif`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  const w = ctx.measureText(text).width + font * 1.2;
  const h = font * 1.7;
  const cx = Math.max(w / 2 + u, Math.min(width - w / 2 - u, x));
  const cy = Math.max(h / 2 + u, Math.min(env.height - h / 2 - u, y));
  ctx.fillStyle = "rgba(8, 12, 18, 0.72)";
  roundRect(ctx, cx - w / 2, cy - h / 2, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillText(text, cx, cy + font * 0.05);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function tempoBar(env: Env, t: number, phase: string, color: string, ratio: number) {
  const { ctx, width, height, font, u } = env;
  const w = Math.min(width * 0.5, font * 14);
  const h = font * 0.5;
  const x = width - w - font;
  const y = height - font * 2.2;
  ctx.fillStyle = "rgba(8, 12, 18, 0.72)";
  roundRect(ctx, x - font * 0.6, y - font * 1.6, w + font * 1.2, h + font * 2.6, font * 0.6);
  ctx.fill();
  // Two segments: backswing (ratio parts) and downswing (1 part).
  const back = (w * ratio) / (ratio + 1);
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fill();
  const fill = t <= 1 ? back * t : back + (w - back) * (t - 1);
  ctx.fillStyle = color;
  roundRect(ctx, x, y, Math.max(h, fill), h, h / 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.fillRect(x + back - u * 0.5, y - u, u, h + u * 2);
  ctx.font = `600 ${font}px system-ui, -apple-system, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = color;
  ctx.fillText(`tempo ${ratio} : 1`, x, y - font * 0.45);
  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.fillText(phase, x + w, y - font * 0.45);
}

// ---------------------------------------------------------------------------------------------
// Stats card

function drawCard(ctx: CanvasRenderingContext2D, checks: ChecksState, selected: string[], byId: Map<string, Metric>, u: number, font: number) {
  const rows = selected.filter((id) => id !== "score").map((id) => byId.get(id)!);
  const showScore = selected.includes("score");
  if (!rows.length && !showScore) return;
  const pad = font * 0.8;
  const lineH = font * 1.5;
  const scoreH = showScore ? font * 2.6 : 0;
  ctx.font = `500 ${font}px system-ui, -apple-system, sans-serif`;
  let w = showScore ? font * 7 : 0;
  const valueText = (m: Metric) => `${m.value}${shortUnit(m)}`;
  for (const m of rows) w = Math.max(w, ctx.measureText(m.label).width + font * 1.5 + ctx.measureText(valueText(m)).width + font * 1.4);
  const h = pad * 2 + scoreH + rows.length * lineH;
  const x = font;
  const y = font;
  ctx.fillStyle = "rgba(8, 12, 18, 0.72)";
  roundRect(ctx, x, y, w + pad * 2, h, font * 0.7);
  ctx.fill();
  let cy = y + pad;
  ctx.textBaseline = "middle";
  if (showScore) {
    const s = checks.score;
    const c = s >= 8 ? COLOR.good : s >= 6 ? COLOR.warn : COLOR.bad;
    ctx.textAlign = "left";
    ctx.font = `700 ${font * 2}px system-ui, -apple-system, sans-serif`;
    ctx.fillStyle = c;
    ctx.fillText(s.toFixed(1), x + pad, cy + font * 1.1);
    const sw = ctx.measureText(s.toFixed(1)).width;
    ctx.font = `500 ${font * 0.9}px system-ui, -apple-system, sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillText("/ 10", x + pad + sw + font * 0.4, cy + font * 1.4);
    cy += scoreH;
  }
  for (const m of rows) {
    const c = tone(m);
    const my = cy + lineH / 2;
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(x + pad + font * 0.35, my, u * 1.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `500 ${font}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.fillText(m.label, x + pad + font * 1.1, my);
    ctx.textAlign = "right";
    ctx.font = `600 ${font}px system-ui, -apple-system, sans-serif`;
    ctx.fillStyle = c;
    ctx.fillText(valueText(m), x + pad + w, my);
    cy += lineH;
  }
}

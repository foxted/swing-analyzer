import { CameraView, Frame, Handedness, LM, Pt, SKELETON } from "@/lib/types";
import { hands, hipMid, lead, shoulderMid, torsoLen } from "@/lib/geometry";
import { ClubProfile } from "@/lib/clubs";
import { BallMark, Trajectory, evalTrajectory, samplePath } from "@/lib/tracer";

/**
 * Everything drawn on top of the video, as a plain canvas function so the on-screen overlay and
 * the video exporter render exactly the same thing.
 */

export type ShowFlags = { skeleton: boolean; lines: boolean; ghost: boolean; tracer: boolean };

export type TracerState = {
  traj: Trajectory | null;
  marks: BallMark[];
  /** Seconds since impact for the current frame (negative before impact). */
  t: number;
  /** Marking mode: draw the marks and the fitted path preview. */
  showMarks: boolean;
  /** Camera eye level (image y, 0..1) on DTL clips; drawn as a draggable line in marking mode. */
  horizon?: number;
};

export type DrawParams = {
  width: number;
  height: number;
  frame: Frame | undefined;
  address: Frame | undefined; // P1, used for the locked reference lines
  view: CameraView;
  hand: Handedness;
  club: ClubProfile;
  show: ShowFlags;
  tracer?: TracerState;
};

const C = {
  bone: "#4ade80",
  joint: "#ffffff",
  leadArm: "#38bdf8",
  ref: "rgba(251, 191, 36, 0.9)",
  refFill: "rgba(251, 191, 36, 0.12)",
  ghost: "rgba(255,255,255,0.28)",
  horizon: "rgba(125, 211, 252, 0.8)",
};

export function drawOverlay(ctx: CanvasRenderingContext2D, p: DrawParams) {
  const { width, height, frame, address, view, hand, club, show, tracer } = p;
  const px = (p: Pt) => ({ x: p.x * width, y: p.y * height });
  const lw = Math.max(2, width / 400);

  // Reference lines locked from address.
  if (show.lines && address?.lm) {
    const a = address.lm;
    const T = torsoLen(a) * height;
    ctx.lineWidth = lw;
    ctx.strokeStyle = C.ref;
    ctx.setLineDash([8, 6]);

    // Head box
    const nose = px(a[LM.nose]);
    const ears = [px(a[LM.leftEar]), px(a[LM.rightEar])];
    const hw = Math.max(Math.abs(ears[0].x - ears[1].x), T * 0.35);
    ctx.strokeRect(nose.x - hw * 0.7, nose.y - hw * 0.75, hw * 1.4, hw * 1.5);

    // Spine line at address
    const sm = px(shoulderMid(a));
    const hm = px(hipMid(a));
    ctx.beginPath();
    ctx.moveTo(sm.x, sm.y);
    ctx.lineTo(hm.x, hm.y);
    ctx.stroke();

    if (view === "dtl") {
      // Vertical through hips (early-extension wall) and a vertical through the toes.
      ctx.beginPath();
      ctx.moveTo(hm.x, 0);
      ctx.lineTo(hm.x, height);
      ctx.stroke();
      const toes = px({ x: (a[LM.leftFootIndex].x + a[LM.rightFootIndex].x) / 2, y: 0, z: 0 });
      ctx.beginPath();
      ctx.moveTo(toes.x, 0);
      ctx.lineTo(toes.x, height);
      ctx.stroke();

      // Shaft plane: a line through the hands at the club's address shaft angle, down to the ground
      // on the ball side and extended up through the body. Angle comes from the selected club.
      const h = px(hands(a));
      const dir = hands(a).x > hipMid(a).x ? 1 : -1;
      const groundY = ((a[LM.leftAnkle].y + a[LM.rightAnkle].y) / 2) * height + T * 0.05;
      const rad = (club.shaftAngle * Math.PI) / 180;
      const dx = dir * Math.cos(rad);
      const dy = Math.sin(rad);
      const down = (groundY - h.y) / dy;
      const up = Math.hypot(width, height);
      ctx.setLineDash([]);
      ctx.strokeStyle = C.ref;
      ctx.beginPath();
      ctx.moveTo(h.x - dx * up, h.y - dy * up);
      ctx.lineTo(h.x + dx * down, h.y + dy * down);
      ctx.stroke();
      ctx.fillStyle = C.ref;
      ctx.font = `${Math.round(lw * 5)}px system-ui`;
      ctx.fillText(`shaft plane · ${club.label.toLowerCase()} ${club.shaftAngle}°`, h.x + dx * down * 0.5 + 6, h.y + dy * down * 0.5);
    } else {
      // Face-on: vertical lines through both ankles (sway / slide references).
      for (const idx of [LM.leftAnkle, LM.rightAnkle]) {
        const p = px(a[idx]);
        ctx.beginPath();
        ctx.moveTo(p.x, 0);
        ctx.lineTo(p.x, height);
        ctx.stroke();
      }
      // Expected ball position for the selected club: 0 = stance centre, 1 = lead heel.
      const L = lead(hand);
      const T2 = trailIdx(hand);
      const leadHeel = px(a[L.ankle]).x;
      const trailHeel = px(a[T2]).x;
      const centre = (leadHeel + trailHeel) / 2;
      const ballX = centre + (leadHeel - centre) * club.ballPosition;
      const groundY = Math.max(px(a[LM.leftAnkle]).y, px(a[LM.rightAnkle]).y) + T * 0.05;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(ballX, 0);
      ctx.lineTo(ballX, height);
      ctx.stroke();
      ctx.fillStyle = C.ref;
      ctx.beginPath();
      ctx.arc(ballX, groundY, lw * 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = `${Math.round(lw * 5)}px system-ui`;
      ctx.fillText(`ball · ${club.label.toLowerCase()}`, ballX + 6, groundY - 8);
      ctx.setLineDash([8, 6]);
      // Shoulder tilt line
      const ls = px(a[LM.leftShoulder]);
      const rs = px(a[LM.rightShoulder]);
      ctx.beginPath();
      ctx.moveTo(ls.x, ls.y);
      ctx.lineTo(rs.x, rs.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  // Ghost of the address skeleton.
  if (show.ghost && address?.lm && frame?.index !== address.index) {
    drawSkeleton(ctx, address.lm, px, lw * 0.8, C.ghost, C.ghost, C.ghost);
  }

  // Current frame skeleton.
  if (show.skeleton && frame?.lm) {
    const L = lead(hand);
    drawSkeleton(ctx, frame.lm, px, lw, C.bone, C.joint, C.leadArm, [L.shoulder, L.elbow, L.wrist]);
  }

  // Ball tracer: comet from impact to the current frame, on top of everything. In marking mode
  // also show the whole fitted path and where the fit puts the ball on this frame, so wrong
  // marks are obvious.
  if (tracer) {
    if (show.tracer && tracer.traj && tracer.t > 0) {
      const tr = tracer.traj;
      if (tr.landing && tr.tLand !== null && tracer.t >= tr.tLand) drawLanding(ctx, tr.landing, width, height, lw);
      drawComet(ctx, tr, Math.min(tracer.t, tr.tEnd), width, height, lw);
    }
    if (tracer.showMarks) {
      if (tracer.horizon !== undefined) drawHorizon(ctx, tracer.horizon, width, height, lw);
      if (tracer.traj) drawPathPreview(ctx, tracer.traj, tracer.t, width, height, lw);
      drawMarks(ctx, tracer.marks, frame?.index, width, height, lw);
    }
  }
}

const trailIdx = (h: Handedness) => (h === "right" ? LM.rightAnkle : LM.leftAnkle);

function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  lm: Pt[],
  px: (p: Pt) => { x: number; y: number },
  lw: number,
  bone: string,
  joint: string,
  leadColor: string,
  leadChain: number[] = []
) {
  ctx.lineWidth = lw * 1.6;
  ctx.lineCap = "round";
  for (const [a, b] of SKELETON) {
    const isLead = leadChain.includes(a) && leadChain.includes(b);
    ctx.strokeStyle = isLead ? leadColor : bone;
    const pa = px(lm[a]);
    const pb = px(lm[b]);
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
  }
  ctx.fillStyle = joint;
  for (let i = 11; i < 33; i++) {
    const p = px(lm[i]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, lw * 1.4, 0, Math.PI * 2);
    ctx.fill();
  }
  const n = px(lm[LM.nose]);
  ctx.beginPath();
  ctx.arc(n.x, n.y, lw * 2.2, 0, Math.PI * 2);
  ctx.fill();
}

function drawComet(ctx: CanvasRenderingContext2D, tr: Trajectory, tCur: number, width: number, height: number, lw: number) {
  if (tCur <= 0) return;
  // Segment count is capped: this runs on every exported frame, and the comet is longest exactly
  // when the clip is ending. No shadowBlur anywhere in here for the same reason: a blurred stroke
  // costs a full-canvas-sized blur pass per segment and was dropping frames at the end of exports.
  const n = Math.max(24, Math.min(96, Math.round(tCur * tr.fps)));
  const pts = samplePath(tr, 0, tCur, n).map((p) => ({ x: p.x * width, y: p.y * height }));
  // Sized off the clip's long edge so the comet reads the same on a 1080p or 4K clip.
  const base = Math.max(3, lw * 0.5, Math.max(width, height) / 320);
  ctx.save();
  // Butt caps: round caps on translucent segments double up at every joint and read as beads.
  ctx.lineCap = "butt";
  ctx.lineJoin = "round";
  const seg = (i: number, widthPx: number, style: string) => {
    ctx.strokeStyle = style;
    ctx.lineWidth = widthPx;
    ctx.beginPath();
    ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
    ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  };
  // Passes 1-2: the glow, as two wide translucent strokes that fade toward the tail (stands in for
  // the blur). Pass 3: narrow bright core, orange at the tail to white-hot at the head.
  for (let i = 1; i < pts.length; i++) {
    const f = i / (pts.length - 1);
    seg(i, base * (2 + 6 * f), `hsla(${16 + 20 * f}, 100%, 55%, ${0.04 + 0.16 * Math.pow(f, 1.3)})`);
  }
  for (let i = 1; i < pts.length; i++) {
    const f = i / (pts.length - 1);
    seg(i, base * (1.2 + 3.4 * f), `hsla(${16 + 20 * f}, 100%, 55%, ${0.1 + 0.4 * Math.pow(f, 1.3)})`);
  }
  for (let i = 1; i < pts.length; i++) {
    const f = i / (pts.length - 1);
    const a = 0.25 + 0.75 * Math.pow(f, 1.2);
    const light = 60 + 38 * Math.pow(f, 1.5);
    seg(i, base * (0.45 + 1.05 * f), `hsla(${30 + 20 * f}, 100%, ${light}%, ${a})`);
  }
  // Head glow.
  const h = pts[pts.length - 1];
  const r = base * 2.2;
  const g = ctx.createRadialGradient(h.x, h.y, 0, h.x, h.y, r * 2.6);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.3, "rgba(255,235,170,0.7)");
  g.addColorStop(1, "rgba(255,140,30,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(h.x, h.y, r * 2.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(h.x, h.y, r * 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Ground disc under the comet head once the ball is down. */
function drawLanding(ctx: CanvasRenderingContext2D, p: { x: number; y: number }, width: number, height: number, lw: number) {
  const base = Math.max(3, lw * 0.5, Math.max(width, height) / 320);
  ctx.save();
  ctx.fillStyle = "rgba(255, 140, 30, 0.35)";
  ctx.strokeStyle = "rgba(255, 170, 60, 0.9)";
  ctx.lineWidth = Math.max(1, base * 0.35);
  ctx.beginPath();
  ctx.ellipse(p.x * width, p.y * height + base * 0.8, base * 3.2, base * 1.1, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** Draggable camera eye level: dashed line, label at the left, grab handle at the right. */
function drawHorizon(ctx: CanvasRenderingContext2D, horizon: number, width: number, height: number, lw: number) {
  const y = horizon * height;
  ctx.save();
  ctx.strokeStyle = C.horizon;
  ctx.lineWidth = Math.max(1, lw * 0.5);
  ctx.setLineDash([lw * 4, lw * 3]);
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(width, y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineWidth = lw * 1.6;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(width - lw * 14, y);
  ctx.lineTo(width - lw * 4, y);
  ctx.stroke();
  ctx.fillStyle = C.horizon;
  ctx.font = `${Math.round(lw * 4.5)}px system-ui`;
  ctx.fillText("horizon · drag to camera eye level", lw * 3, y - lw * 2);
  ctx.restore();
}

function drawMarks(ctx: CanvasRenderingContext2D, marks: BallMark[], currentFrame: number | undefined, width: number, height: number, lw: number) {
  ctx.save();
  ctx.lineWidth = Math.max(1, lw * 0.6);
  for (const m of marks) {
    const x = m.x * width;
    const y = m.y * height;
    const here = m.frame === currentFrame;
    ctx.strokeStyle = here ? "#fbbf24" : "rgba(251, 191, 36, 0.55)";
    const r = lw * (here ? 3 : 2.2);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - r * 1.8, y);
    ctx.lineTo(x - r * 0.6, y);
    ctx.moveTo(x + r * 0.6, y);
    ctx.lineTo(x + r * 1.8, y);
    ctx.moveTo(x, y - r * 1.8);
    ctx.lineTo(x, y - r * 0.6);
    ctx.moveTo(x, y + r * 0.6);
    ctx.lineTo(x, y + r * 1.8);
    ctx.stroke();
    if (here) {
      ctx.fillStyle = "#fbbf24";
      ctx.font = `${Math.round(lw * 4.5)}px system-ui`;
      ctx.fillText(`#${m.frame}`, x + r * 2, y - r);
    }
  }
  ctx.restore();
}

/** Thin dashed line along the whole fitted path, plus a ring where the fit puts the ball right now. */
function drawPathPreview(ctx: CanvasRenderingContext2D, tr: Trajectory, tCur: number, width: number, height: number, lw: number) {
  const pts = samplePath(tr, 0, tr.tEnd, 160);
  ctx.save();
  ctx.setLineDash([lw * 3, lw * 3]);
  ctx.lineWidth = Math.max(1, lw * 0.5);
  // Fitted span (up to the last mark) solid-ish, extrapolated span fainter.
  for (const [a, b, alpha] of [
    [0, tr.lastMarkT, 0.9],
    [tr.lastMarkT, tr.tEnd, 0.45],
  ] as const) {
    ctx.strokeStyle = `rgba(255, 200, 120, ${alpha})`;
    ctx.beginPath();
    let pen = false;
    for (const q of pts) {
      if (q.t < a || q.t > b) continue;
      if (pen) ctx.lineTo(q.x * width, q.y * height);
      else ctx.moveTo(q.x * width, q.y * height);
      pen = true;
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);
  if (tr.landing) {
    ctx.strokeStyle = "rgba(255, 200, 120, 0.8)";
    ctx.lineWidth = Math.max(1, lw * 0.5);
    ctx.beginPath();
    ctx.arc(tr.landing.x * width, tr.landing.y * height, lw * 2, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (tCur >= 0 && tCur <= tr.tEnd) {
    const q = evalTrajectory(tr, tCur);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    ctx.lineWidth = Math.max(1, lw * 0.7);
    ctx.beginPath();
    ctx.arc(q.x * width, q.y * height, lw * 3.5, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

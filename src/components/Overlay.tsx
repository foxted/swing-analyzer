"use client";

import { useEffect, useRef } from "react";
import { CameraView, Frame, Handedness, LM, Pt, SKELETON } from "@/lib/types";
import { hands, hipMid, lead, shoulderMid, torsoLen } from "@/lib/geometry";

type Props = {
  width: number;
  height: number;
  frame: Frame | undefined;
  address: Frame | undefined; // P1, used for the locked reference lines
  view: CameraView;
  hand: Handedness;
  show: { skeleton: boolean; lines: boolean; ghost: boolean };
};

const C = {
  bone: "#4ade80",
  joint: "#ffffff",
  leadArm: "#38bdf8",
  ref: "rgba(251, 191, 36, 0.9)",
  refFill: "rgba(251, 191, 36, 0.12)",
  ghost: "rgba(255,255,255,0.28)",
};

export default function Overlay({ width, height, frame, address, view, hand, show }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = width;
    canvas.height = height;
    ctx.clearRect(0, 0, width, height);
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

        // Estimated shaft plane: from hands down toward the ball, ball assumed ~0.9 torso lengths outside the toes at ankle height.
        const h = px(hands(a));
        const dir = hands(a).x > hipMid(a).x ? 1 : -1;
        const ankleY = ((a[LM.leftAnkle].y + a[LM.rightAnkle].y) / 2) * height;
        const ball = { x: toes.x + dir * T * 0.9, y: ankleY + T * 0.05 };
        const dx = ball.x - h.x;
        const dy = ball.y - h.y;
        const ext = 2.2;
        ctx.setLineDash([]);
        ctx.strokeStyle = C.ref;
        ctx.beginPath();
        ctx.moveTo(h.x - dx * ext, h.y - dy * ext);
        ctx.lineTo(ball.x, ball.y);
        ctx.stroke();
        ctx.fillStyle = C.ref;
        ctx.font = `${Math.round(lw * 5)}px system-ui`;
        ctx.fillText("shaft plane (est.)", h.x - dx * ext + 6, h.y - dy * ext + 14);
      } else {
        // Face-on: vertical lines through both ankles (sway / slide references).
        for (const idx of [LM.leftAnkle, LM.rightAnkle]) {
          const p = px(a[idx]);
          ctx.beginPath();
          ctx.moveTo(p.x, 0);
          ctx.lineTo(p.x, height);
          ctx.stroke();
        }
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
  }, [width, height, frame, address, view, hand, show]);

  return <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full w-full" />;
}

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

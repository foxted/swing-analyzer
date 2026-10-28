"use client";

import { useEffect, useRef } from "react";
import { DrawParams, drawOverlay } from "@/lib/overlay-draw";

export type { TracerState, ShowFlags } from "@/lib/overlay-draw";

export default function Overlay(p: DrawParams) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { width, height, frame, address, view, hand, club, show, tracer } = p;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = width;
    canvas.height = height;
    ctx.clearRect(0, 0, width, height);
    drawOverlay(ctx, { width, height, frame, address, view, hand, club, show, tracer });
  }, [width, height, frame, address, view, hand, club, show, tracer]);

  return <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full w-full" />;
}

"use client";

import { useEffect, useRef } from "react";
import { CardRect, DrawParams, drawOverlay } from "@/lib/overlay-draw";

export type { TracerState, ShowFlags, ChecksState, ShaftState, CardRect } from "@/lib/overlay-draw";

export default function Overlay(p: DrawParams & { onLayout?: (card: CardRect | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { width, height, frame, address, view, hand, club, show, tracer, shaft, checks, onLayout } = p;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = width;
    canvas.height = height;
    ctx.clearRect(0, 0, width, height);
    const { card } = drawOverlay(ctx, { width, height, frame, address, view, hand, club, show, tracer, shaft, checks });
    onLayout?.(card);
  }, [width, height, frame, address, view, hand, club, show, tracer, shaft, checks, onLayout]);

  return <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full w-full" />;
}

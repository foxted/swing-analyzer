"use client";

import { POSITION_KEYS, POSITION_LABELS, PositionKey, Positions } from "@/lib/types";

type Props = {
  total: number;
  current: number;
  positions: Positions;
  playing: boolean;
  onSeek: (i: number) => void;
  onTogglePlay: () => void;
  onSetPosition: (k: PositionKey, frame: number) => void;
};

const btn = "rounded-md border border-line bg-panel-2 px-2.5 py-1.5 text-sm hover:border-muted";

export default function Timeline({ total, current, positions, playing, onSeek, onTogglePlay, onSetPosition }: Props) {
  const pct = (i: number) => `${(i / Math.max(1, total - 1)) * 100}%`;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-panel p-3">
      <div className="flex items-center gap-1.5">
        <button className={btn} onClick={() => onSeek(Math.max(0, current - 1))} title="Previous frame (←)">
          ‹
        </button>
        <button className={`${btn} min-w-11`} onClick={onTogglePlay} title="Play / pause (space)">
          {playing ? "❚❚" : "▶"}
        </button>
        <button className={btn} onClick={() => onSeek(Math.min(total - 1, current + 1))} title="Next frame (→)">
          ›
        </button>
        <span className="ml-2 text-xs tabular-nums text-muted">
          frame {current} / {total - 1}
        </span>
      </div>

      <div className="relative pb-4">
        <input type="range" className="w-full" min={0} max={Math.max(0, total - 1)} value={current} onChange={(e) => onSeek(Number(e.target.value))} />
        <div className="absolute inset-x-2 bottom-0 h-4">
          {POSITION_KEYS.map((k) => (
            <span
              key={k}
              className="absolute -translate-x-1/2 text-[10px] font-semibold text-warn"
              style={{ left: pct(positions[k]) }}
              title={POSITION_LABELS[k]}
            >
              {k}
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1.5 md:grid-cols-6">
        {POSITION_KEYS.map((k) => {
          const active = positions[k] === current;
          return (
            <div key={k} className="flex flex-col gap-1">
              <button
                className={`flex flex-col items-start gap-0.5 rounded-md border bg-panel-2 p-2 text-left leading-tight ${active ? "border-accent" : "border-line hover:border-muted"}`}
                onClick={() => onSeek(positions[k])}
                title={`Jump to ${POSITION_LABELS[k]} (${k.slice(1)})`}
              >
                <b className="text-sm">{k}</b>
                <small className="text-[11px] text-muted">{POSITION_LABELS[k]}</small>
                <small className="text-[11px] tabular-nums text-warn">#{positions[k]}</small>
              </button>
              <button
                className="rounded-md border border-line px-1.5 py-0.5 text-[11px] text-muted hover:border-muted"
                onClick={() => onSetPosition(k, current)}
                title={`Set ${k} to the current frame`}
              >
                set to current
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

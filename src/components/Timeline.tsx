"use client";

import { POSITION_KEYS, POSITION_LABELS, PositionKey, Positions } from "@/lib/types";

export const RATES = [0.25, 0.5, 0.75, 1] as const;
export type Rate = (typeof RATES)[number];

type Props = {
  total: number;
  current: number;
  positions: Positions;
  playing: boolean;
  rate: Rate;
  loop: boolean;
  onSeek: (i: number) => void;
  onTogglePlay: () => void;
  onRate: (r: Rate) => void;
  onToggleLoop: () => void;
  onSetPosition: (k: PositionKey, frame: number) => void;
};

const btn = "rounded-md border border-line bg-panel px-2.5 py-1.5 text-sm hover:border-line-strong";
const toggle = (on: boolean) => `${btn} px-2 text-xs tabular-nums ${on ? "border-accent bg-accent-soft text-accent" : "text-muted"}`;

export default function Timeline({ total, current, positions, playing, rate, loop, onSeek, onTogglePlay, onRate, onToggleLoop, onSetPosition }: Props) {
  const pct = (i: number) => `${(i / Math.max(1, total - 1)) * 100}%`;
  return (
    <div className="flex shrink-0 flex-col gap-3 rounded-xl border border-line bg-panel p-3">
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
        <div className="ml-auto flex items-center gap-1" role="group" aria-label="Playback speed">
          {RATES.map((r) => (
            <button key={r} className={toggle(rate === r)} aria-pressed={rate === r} onClick={() => onRate(r)} title={`Play at ${r}x`}>
              {r}x
            </button>
          ))}
          <button className={`${toggle(loop)} ml-2`} aria-pressed={loop} onClick={onToggleLoop} title="Loop playback (L)">
            loop
          </button>
        </div>
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
                className={`flex flex-col items-start gap-0.5 rounded-md border p-2 text-left leading-tight ${active ? "border-accent bg-accent-soft" : "border-line bg-panel hover:border-line-strong"}`}
                onClick={() => onSeek(positions[k])}
                title={`Jump to ${POSITION_LABELS[k]} (${k.slice(1)})`}
              >
                <b className="text-sm">{k}</b>
                <small className="text-[11px] text-muted">{POSITION_LABELS[k]}</small>
                <small className="text-[11px] tabular-nums text-warn">#{positions[k]}</small>
              </button>
              <button
                className="rounded-md border border-line px-1.5 py-0.5 text-[11px] text-muted hover:border-line-strong"
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

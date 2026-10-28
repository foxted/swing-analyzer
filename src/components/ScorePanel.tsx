"use client";

import { Analysis, PositionKey } from "@/lib/types";

type Props = { analysis: Analysis | null; onJump: (k: PositionKey) => void; onSeek: (i: number) => void };

export default function ScorePanel({ analysis, onJump, onSeek }: Props) {
  if (!analysis) return null;
  const { score, metrics } = analysis;
  const worst = [...metrics].sort((a, b) => b.deduction - a.deduction).filter((m) => m.deduction >= 0.3);
  const tone = score >= 8 ? "text-accent" : score >= 6 ? "text-warn" : "text-bad";
  const good = metrics.filter((m) => m.deduction === 0).length;

  return (
    <aside className="flex flex-col gap-5 overflow-y-auto overflow-x-hidden rounded-xl border border-line bg-panel p-4 lg:min-h-0">
      <div>
        <div className="flex items-baseline gap-2">
          <span className={`text-6xl font-bold leading-none ${tone}`}>{score.toFixed(1)}</span>
          <span className="text-muted">/ 10</span>
        </div>
        <div className="mt-1 text-xs text-muted">
          {analysis.view === "dtl" ? "Down the line" : "Face on"} · {good} of {metrics.length} checks good
        </div>
      </div>

      {worst.length > 0 ? (
        <section>
          <h3 className="mb-2 text-xs uppercase tracking-widest text-muted">Work on</h3>
          <ol className="flex list-decimal flex-col gap-3 pl-5">
            {worst.slice(0, 3).map((m) => (
              <li key={m.id}>
                <div className="flex items-baseline justify-between gap-2 text-sm font-semibold">
                  <span>{m.label}</span>
                  <span className="shrink-0 text-bad">-{m.deduction.toFixed(1)}</span>
                </div>
                <p className="my-1 text-sm leading-snug">{m.tip}</p>
                <div className="flex flex-wrap gap-1">
                  {m.positions.map((p) => (
                    <button key={p} className="rounded border border-line px-2 py-0.5 text-[11px] hover:border-muted" onClick={() => onJump(p)}>
                      {p}
                    </button>
                  ))}
                  {m.frame !== undefined && (
                    <button className="rounded border border-line px-2 py-0.5 text-[11px] text-warn hover:border-muted" onClick={() => onSeek(m.frame!)} title="Jump to the frame where it peaked">
                      peak #{m.frame}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : (
        <p className="text-sm">Nothing stands out. Keep doing what you're doing.</p>
      )}

      <section>
        <h3 className="mb-2 text-xs uppercase tracking-widest text-muted">All checks</h3>
        <ul className="flex flex-col">
          {metrics.map((m) => {
            const color = m.deduction === 0 ? "text-accent" : m.deduction < m.maxDeduction / 2 ? "text-warn" : "text-bad";
            return (
              <li key={m.id} className="flex items-baseline gap-2 border-t border-line py-1.5 text-sm" title={`Target ${m.target}. ${m.tip}`}>
                <span className={`w-3 shrink-0 ${color}`}>{m.deduction ? "•" : "✓"}</span>
                <span className="min-w-0 flex-1">{m.label}</span>
                <span className="min-w-0 max-w-[55%] text-right text-xs leading-tight text-muted">
                  <span className={`tabular-nums ${color}`}>{m.value}</span> {m.unit}
                  <small className="block text-[10px]">target {m.target}</small>
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <p className="text-xs text-muted">
        Each check compares body landmarks against beginner-friendly ranges. If a P-position looks wrong on the video, set it
        manually and the score updates.
      </p>
    </aside>
  );
}

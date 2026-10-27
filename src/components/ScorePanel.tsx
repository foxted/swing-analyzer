"use client";

import { Analysis, PositionKey } from "@/lib/types";

type Props = { analysis: Analysis | null; onJump: (k: PositionKey) => void };

export default function ScorePanel({ analysis, onJump }: Props) {
  if (!analysis) return null;
  const { score, metrics } = analysis;
  const worst = [...metrics].sort((a, b) => b.deduction - a.deduction).filter((m) => m.deduction >= 0.3);
  const tone = score >= 8 ? "text-accent" : score >= 6 ? "text-warn" : "text-bad";

  return (
    <aside className="sticky top-4 flex max-h-[calc(100vh-2rem)] flex-col gap-5 self-start overflow-auto rounded-xl border border-line bg-panel p-4">
      <div>
        <div className="flex items-baseline gap-2">
          <span className={`text-6xl font-bold leading-none ${tone}`}>{score.toFixed(1)}</span>
          <span className="text-muted">/ 10</span>
        </div>
        <div className="mt-1 text-xs text-muted">{analysis.view === "dtl" ? "Down the line" : "Face on"}</div>
      </div>

      {worst.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs uppercase tracking-widest text-muted">Work on</h3>
          <ol className="flex list-decimal flex-col gap-3 pl-5">
            {worst.slice(0, 3).map((m) => (
              <li key={m.id}>
                <div className="flex justify-between text-sm font-semibold">
                  <span>{m.label}</span>
                  <span className="text-bad">-{m.deduction.toFixed(1)}</span>
                </div>
                <p className="my-1 text-sm">{m.tip}</p>
                <div className="flex gap-1">
                  {m.positions.map((p) => (
                    <button key={p} className="rounded border border-line px-2 py-0.5 text-[11px] hover:border-muted" onClick={() => onJump(p)}>
                      {p}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section>
        <h3 className="mb-2 text-xs uppercase tracking-widest text-muted">All checks</h3>
        <table className="w-full border-collapse text-sm">
          <tbody>
            {metrics.map((m) => {
              const color = m.deduction === 0 ? "text-accent" : m.deduction < m.maxDeduction / 2 ? "text-warn" : "text-bad";
              return (
                <tr key={m.id}>
                  <td className="border-t border-line py-1.5 pr-1 align-top">
                    {m.label}
                    <small className="block text-[11px] text-muted">target {m.target}</small>
                  </td>
                  <td className="whitespace-nowrap border-t border-line py-1.5 text-right align-top tabular-nums">
                    {m.value}
                    <small className="block text-[11px] text-muted">{m.unit}</small>
                  </td>
                  <td className={`w-10 border-t border-line py-1.5 text-right align-top tabular-nums ${color}`}>
                    {m.deduction ? `-${m.deduction.toFixed(1)}` : "✓"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <p className="text-xs text-muted">
        Heuristic score: each check measures body landmarks against amateur-friendly reference ranges and deducts
        proportionally. If auto-detect missed a P-position, set it manually and the score recomputes.
      </p>
    </aside>
  );
}

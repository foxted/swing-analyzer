"use client";

import { Analysis, Metric, PositionKey } from "@/lib/types";

type Props = {
  analysis: Analysis | null;
  onJump: (k: PositionKey) => void;
  onSeek: (i: number) => void;
  /** Check ids drawn on the video ("score" = the overall score on the card). */
  shown: string[];
  onShown: (ids: string[]) => void;
};

const PHASES = ["Address", "Backswing", "Impact", "Finish", "Tempo"] as const;
type Phase = (typeof PHASES)[number];

/** Which part of the swing a check belongs to, from the last position it reads. */
function phaseOf(m: Metric): Phase {
  if (m.id === "tempo") return "Tempo";
  const last = m.positions[m.positions.length - 1];
  if (last === "P1") return "Address";
  if (last === "P2" || last === "P3") return "Backswing";
  if (last === "P6") return "Finish";
  return "Impact";
}

const tone = (m: Metric) => (m.deduction === 0 ? "text-good" : m.deduction < m.maxDeduction / 2 ? "text-warn" : "text-bad");
const dot = (m: Metric) => (m.deduction === 0 ? "bg-good" : m.deduction < m.maxDeduction / 2 ? "bg-warn" : "bg-bad");

function EyeIcon({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" fill={on ? "currentColor" : "none"} />
    </svg>
  );
}

export default function ScorePanel({ analysis, onJump, onSeek, shown, onShown }: Props) {
  if (!analysis) return null;
  const { score, metrics } = analysis;
  const worst = [...metrics].sort((a, b) => b.deduction - a.deduction).filter((m) => m.deduction >= 0.3);
  const scoreTone = score >= 8 ? "text-good" : score >= 6 ? "text-warn" : "text-bad";
  const good = metrics.filter((m) => m.deduction === 0).length;
  const isShown = (id: string) => shown.includes(id);
  const toggle = (id: string) => onShown(isShown(id) ? shown.filter((x) => x !== id) : [...shown, id]);
  const allIds = ["score", ...metrics.map((m) => m.id)];
  const groups = PHASES.map((p) => ({ phase: p, items: metrics.filter((m) => phaseOf(m) === p) })).filter((g) => g.items.length);

  const eye = (id: string, title: string) => (
    <button
      className={`inline-flex size-7 shrink-0 items-center justify-center rounded-full border transition-colors ${
        isShown(id) ? "border-accent bg-accent-soft text-accent" : "border-transparent text-faint hover:border-line hover:text-muted"
      }`}
      onClick={() => toggle(id)}
      aria-pressed={isShown(id)}
      aria-label={title}
      title={title}
    >
      <EyeIcon on={isShown(id)} />
    </button>
  );

  return (
    <aside className="flex flex-col gap-6 overflow-y-auto overflow-x-hidden rounded-xl border border-line bg-panel p-5 lg:min-h-0">
      <div className="flex items-start gap-3">
        <div>
          <div className="flex items-baseline gap-1.5">
            <span className={`font-mono text-5xl font-medium leading-none tracking-tight tabular-nums ${scoreTone}`}>{score.toFixed(1)}</span>
            <span className="text-sm text-muted">/ 10</span>
          </div>
          <div className="mt-2 text-xs text-muted">
            {analysis.view === "dtl" ? "Down the line" : "Face on"} · {good} of {metrics.length} checks good
          </div>
          <div
            className="text-xs text-faint"
            title="MediaPipe never reads 180° for a locked knee, so the straightest either knee gets in this clip is the reference for the knee checks."
          >
            straight knee {analysis.straightKnee.calibrated ? "calibrated at" : "assumed"} {Math.round(analysis.straightKnee.angle)}°
          </div>
        </div>
        <span className="ml-auto">{eye("score", "Show the score on the video and in exports")}</span>
      </div>

      {worst.length > 0 ? (
        <section>
          <h3 className="mb-3 text-[11px] font-medium uppercase tracking-wide text-muted">Work on</h3>
          <ol className="flex flex-col gap-4">
            {worst.slice(0, 3).map((m, i) => (
              <li key={m.id} className="flex gap-3">
                <span className="mt-0.5 font-mono text-xs text-faint tabular-nums">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold">{m.label}</span>
                    <span className="shrink-0 rounded-full bg-bad-soft px-2 py-0.5 font-mono text-[11px] text-bad tabular-nums">−{m.deduction.toFixed(1)}</span>
                  </div>
                  <p className="my-1 text-sm leading-snug text-fg/90">{m.tip}</p>
                  <div className="flex flex-wrap gap-1">
                    {m.positions.map((p) => (
                      <button key={p} className="rounded-full border border-line px-2 py-0.5 text-[11px] font-medium text-muted hover:border-line-strong hover:text-fg" onClick={() => onJump(p)}>
                        {p}
                      </button>
                    ))}
                    {m.frame !== undefined && (
                      <button className="rounded-full border border-line px-2 py-0.5 text-[11px] font-medium text-warn hover:border-line-strong" onClick={() => onSeek(m.frame!)} title="Jump to the frame where it peaked">
                        peak #{m.frame}
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : (
        <p className="text-sm">Nothing stands out. Keep doing what you're doing.</p>
      )}

      <section>
        <div className="mb-1 flex items-baseline gap-2">
          <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted">All checks</h3>
          <span className="ml-auto flex gap-2 text-[11px] text-faint">
            <button className="hover:text-fg" onClick={() => onShown(allIds)}>
              show all on video
            </button>
            <button className="hover:text-fg" onClick={() => onShown([])}>
              hide all
            </button>
          </span>
        </div>
        {groups.map((g) => (
          <div key={g.phase} className="mt-3">
            <div className="mb-1 text-[11px] font-medium text-faint">{g.phase}</div>
            <ul className="divide-y divide-line rounded-lg border border-line">
              {g.items.map((m) => (
                <li key={m.id} className="flex items-center gap-3 px-3 py-2" title={`Target ${m.target}. ${m.tip}`}>
                  <span className={`size-1.5 shrink-0 rounded-full ${dot(m)}`} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{m.label}</div>
                    <div className="truncate text-[11px] text-faint">
                      target {m.target}
                      {m.detail ? ` · ${m.detail}` : ""}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className={`font-mono text-sm font-medium tabular-nums ${tone(m)}`}>{m.value}</span>
                    <span className="ml-0.5 text-[11px] text-muted">{m.unit}</span>
                  </div>
                  {eye(m.id, "Draw this check on the video with its live number; exports include it")}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <p className="text-xs text-faint">
        Each check compares body landmarks against beginner-friendly ranges. If a P-position looks wrong on the video, set it manually and
        the score updates. The eye draws a check on the video with its live number.
      </p>
    </aside>
  );
}

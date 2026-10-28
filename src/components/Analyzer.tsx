"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Overlay, { ChecksState, TracerState } from "./Overlay";
import Timeline, { Rate } from "./Timeline";
import ScorePanel from "./ScorePanel";
import { extractFrames, ModelSize } from "@/lib/pose";
import { detectPositions, detectView } from "@/lib/positions";
import { analyse } from "@/lib/metrics";
import { CameraView, Frame, Handedness, PositionKey, Positions } from "@/lib/types";
import { CLUB_KEYS, CLUBS, ClubType } from "@/lib/clubs";
import { BallMark, MIN_MARKS, estimateScale, fitTrajectory, groundLine, refineMark } from "@/lib/tracer";
import { canExport, downloadBlob, exportVideo } from "@/lib/export";
import { drawOverlay } from "@/lib/overlay-draw";

type Stage = "idle" | "loading-model" | "processing" | "ready";

const selectCls = "rounded-md border border-line bg-panel-2 px-2 py-1 text-sm text-slate-100";
const labelCls = "flex items-center gap-2 text-xs text-muted";

export default function Analyzer() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [fps, setFps] = useState(60);
  const [model, setModel] = useState<ModelSize>("full");
  const [hand, setHand] = useState<Handedness>("right");
  const [club, setClub] = useState<ClubType>("iron");
  const [viewOverride, setViewOverride] = useState<CameraView | "auto">("auto");
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [frames, setFrames] = useState<Frame[]>([]);
  const [positions, setPositions] = useState<Positions | null>(null);
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState<Rate>(1);
  const [loop, setLoop] = useState(false);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [show, setShow] = useState({ skeleton: true, lines: true, ghost: false, tracer: true });
  const [marks, setMarks] = useState<BallMark[]>([]);
  /** Check ids drawn on the video (and burnt into exports). */
  const [shownChecks, setShownChecks] = useState<string[]>([]);
  const [marking, setMarking] = useState(false);
  /** User-dragged horizon (image y, 0..1) for DTL clips; null = use the estimate. */
  const [horizonOverride, setHorizonOverride] = useState<number | null>(null);
  const horizonDrag = useRef<{ pointerId: number; moved: boolean } | null>(null);
  const [exporting, setExporting] = useState<{ fraction: number } | null>(null);
  const exportAbort = useRef<AbortController | null>(null);
  const exportLock = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const view: CameraView = useMemo(
    () => (viewOverride === "auto" ? (frames.length ? detectView(frames) : "dtl") : viewOverride),
    [viewOverride, frames]
  );

  const analysis = useMemo(
    () => (positions && frames.length ? analyse(frames, positions, view, hand, CLUBS[club]) : null),
    [frames, positions, view, hand, club]
  );

  const address = positions ? frames[positions.P1] : undefined;

  // Image-height units per metre at the ball's depth, from the golfer's size at address.
  const scale = useMemo(() => estimateScale(address), [address]);

  // Horizon (camera eye level) for DTL: it tells the fit where the ground is at the ball's depth, so the
  // path can end at the landing. Not observable from early-flight marks, so it is a draggable line with a
  // default that assumes the camera sits 0.5 m above the ground.
  const horizon = useMemo(() => {
    if (view !== "dtl") return undefined;
    if (horizonOverride !== null) return horizonOverride;
    const rest = positions ? marks.find((m) => m.frame <= positions.P4) : undefined;
    const ground = rest?.y ?? groundLine(address);
    if (ground === undefined || scale === undefined) return undefined;
    return Math.min(0.95, Math.max(0.05, ground - scale * 0.5));
  }, [view, horizonOverride, positions, marks, address, scale]);

  // Ball flight fitted to the marks, anchored at impact.
  const trajectory = useMemo(
    () => (positions ? fitTrajectory(marks, positions.P4, fps, { view, horizon, scale }) : null),
    [marks, positions, fps, view, horizon, scale]
  );

  const onFile = (file: File) => {
    abortRef.current?.abort();
    if (src) URL.revokeObjectURL(src);
    setSrc(URL.createObjectURL(file));
    setFileName(file.name);
    setFrames([]);
    setPositions(null);
    setMarks([]);
    setMarking(false);
    setHorizonOverride(null);
    setShownChecks([]);
    setCurrent(0);
    setStage("idle");
    setError(null);
  };

  const run = async () => {
    const v = videoRef.current;
    if (!v || !src) return;
    setError(null);
    setPlaying(false);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      setStage("loading-model");
      setProgress({ done: 0, total: 0 });
      const fr = await extractFrames(
        v,
        fps,
        model,
        (done, total) => {
          setStage("processing");
          setProgress({ done, total });
        },
        ac.signal
      );
      if (ac.signal.aborted) return;
      setFrames(fr);
      const pos = detectPositions(fr);
      setPositions(pos);
      setCurrent(pos.P1);
      setStage("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStage("idle");
    }
  };

  const seekTo = useCallback(
    (i: number) => {
      const v = videoRef.current;
      const clamped = Math.max(0, Math.min(Math.max(0, frames.length - 1), i));
      setCurrent(clamped);
      if (v && !playing) v.currentTime = clamped / fps;
    },
    [frames.length, fps, playing]
  );

  // Playback: follow the video clock and map it to a frame index.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !playing) return;
    v.playbackRate = rate;
    v.play().catch(() => setPlaying(false));
    let raf = 0;
    const tick = () => {
      setCurrent(Math.min(frames.length - 1, Math.round(v.currentTime * fps)));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const onEnd = () => setPlaying(false);
    v.addEventListener("ended", onEnd);
    return () => {
      cancelAnimationFrame(raf);
      v.removeEventListener("ended", onEnd);
      v.pause();
    };
  }, [playing, fps, frames.length, rate]);

  // Speed changes apply live, without restarting playback.
  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = rate;
  }, [rate]);

  // Keyboard: arrows step frames (shift = 5), space toggles play, 1-6 jump to P1-P6.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (stage !== "ready" || exporting) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT") return;
      if (e.key === "ArrowLeft") seekTo(current - (e.shiftKey ? 5 : 1));
      else if (e.key === "ArrowRight") seekTo(current + (e.shiftKey ? 5 : 1));
      else if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === "l" || e.key === "L") setLoop((l) => !l);
      else if (e.key === "b" || e.key === "B") setMarking((m) => !m);
      else if (e.key === "Escape") setMarking(false);
      else if (/^[1-6]$/.test(e.key) && positions) seekTo(positions[`P${e.key}` as PositionKey]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stage, current, positions, seekTo, exporting]);

  const setPosition = (k: PositionKey, frame: number) => setPositions((p) => (p ? { ...p, [k]: frame } : p));

  // Export the clip with whatever helpers are switched on, at the current playback speed.
  const runExport = async () => {
    const v = videoRef.current;
    if (!v || !positions || exporting || exportLock.current) return;
    exportLock.current = true;
    setPlaying(false);
    setMarking(false);
    const ac = new AbortController();
    exportAbort.current = ac;
    setExporting({ fraction: 0 });
    setError(null);
    const base = fileName.replace(/\.[^.]+$/, "") || "swing";
    try {
      const { blob, ext } = await exportVideo({
        video: v,
        fps,
        rate,
        frames,
        signal: ac.signal,
        drawOverlay: (ctx, index) =>
          drawOverlay(ctx, {
            width: dims.w,
            height: dims.h,
            frame: frames[index],
            address: frames[positions.P1],
            view,
            hand,
            club: CLUBS[club],
            show,
            tracer: { traj: trajectory, marks, t: (index - positions.P4) / fps, showMarks: false },
            checks: checksFor(index),
          }),
        onProgress: (fraction, index) => {
          setExporting({ fraction });
          setCurrent(index);
        },
      });
      downloadBlob(blob, `${base}_analysed${rate !== 1 ? `_${rate}x` : ""}.${ext}`);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(null);
      exportAbort.current = null;
      exportLock.current = false;
    }
  };

  const HORIZON_GRAB_PX = 12;
  const nearHorizon = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!marking || view !== "dtl" || horizon === undefined) return false;
    const r = e.currentTarget.getBoundingClientRect();
    return Math.abs(e.clientY - (r.top + horizon * r.height)) <= HORIZON_GRAB_PX;
  };

  // Pointer down near the horizon line starts a drag; everything else is a click that places
  // (or replaces) the ball mark for the current frame.
  const onVideoPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!marking || stage !== "ready" || e.button !== 0) return;
    if (nearHorizon(e)) {
      horizonDrag.current = { pointerId: e.pointerId, moved: false };
      e.currentTarget.setPointerCapture(e.pointerId);
      e.preventDefault();
    }
  };
  const onVideoPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = horizonDrag.current;
    if (d && d.pointerId === e.pointerId) {
      d.moved = true;
      const r = e.currentTarget.getBoundingClientRect();
      setHorizonOverride(Math.min(0.95, Math.max(0.05, (e.clientY - r.top) / r.height)));
      return;
    }
    if (marking && view === "dtl") e.currentTarget.style.cursor = nearHorizon(e) ? "ns-resize" : "";
  };
  const onVideoPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = horizonDrag.current;
    if (d && d.pointerId === e.pointerId) {
      horizonDrag.current = null;
      e.currentTarget.releasePointerCapture(e.pointerId);
      return; // a grab of the horizon never places a mark, even without movement
    }
    const v = videoRef.current;
    if (!marking || stage !== "ready" || !v || e.button !== 0) return;
    const r = e.currentTarget.getBoundingClientRect();
    const raw = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
    const p = e.shiftKey ? raw : refineMark(v, raw.x, raw.y);
    setMarks((ms) => [...ms.filter((m) => m.frame !== current), { frame: current, ...p }].sort((a, b) => a.frame - b.frame));
  };

  const frame = frames[current];
  const busy = stage === "processing" || stage === "loading-model";
  const tracer: TracerState | undefined = positions
    ? { traj: trajectory, marks, t: (current - positions.P4) / fps, showMarks: marking, horizon }
    : undefined;
  const landingFrame = trajectory?.tLand != null && positions ? Math.round(positions.P4 + trajectory.tLand * fps) : null;
  const checksFor = (index: number): ChecksState | undefined =>
    analysis && positions && shownChecks.length
      ? { metrics: analysis.metrics, selected: shownChecks, score: analysis.score, positions, currentIndex: index, straightKnee: analysis.straightKnee.angle }
      : undefined;
  const checks = checksFor(current);

  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh lg:overflow-hidden">
      <header className="flex shrink-0 flex-wrap items-center gap-4 border-b border-line px-5 py-3">
        <h1 className="text-base font-semibold tracking-wide">Swing Analyzer</h1>
        <div className="flex flex-wrap items-center gap-3">
          <label className="max-w-64 cursor-pointer truncate rounded-md border border-dashed border-line bg-panel-2 px-3 py-1.5 text-sm">
            <input type="file" accept="video/*" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
            {fileName || "Choose a swing video"}
          </label>
          <label className={labelCls}>
            fps
            <select className={selectCls} value={fps} onChange={(e) => setFps(Number(e.target.value))} disabled={busy}>
              {[30, 60, 120, 240].map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
          <label className={labelCls}>
            model
            <select className={selectCls} value={model} onChange={(e) => setModel(e.target.value as ModelSize)} disabled={busy}>
              <option value="lite">lite (fast)</option>
              <option value="full">full</option>
              <option value="heavy">heavy (best)</option>
            </select>
          </label>
          <label className={labelCls}>
            club
            <select className={selectCls} value={club} onChange={(e) => setClub(e.target.value as ClubType)}>
              {CLUB_KEYS.map((k) => (
                <option key={k} value={k}>
                  {CLUBS[k].label.toLowerCase()}
                </option>
              ))}
            </select>
          </label>
          <label className={labelCls}>
            hand
            <select className={selectCls} value={hand} onChange={(e) => setHand(e.target.value as Handedness)}>
              <option value="right">right</option>
              <option value="left">left</option>
            </select>
          </label>
          <label className={labelCls}>
            view
            <select className={selectCls} value={viewOverride} onChange={(e) => setViewOverride(e.target.value as CameraView | "auto")}>
              <option value="auto">auto{frames.length ? ` (${view === "dtl" ? "DTL" : "face on"})` : ""}</option>
              <option value="dtl">down the line</option>
              <option value="faceOn">face on</option>
            </select>
          </label>
          <button
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-emerald-950 disabled:opacity-50"
            onClick={run}
            disabled={!src || busy}
          >
            {stage === "loading-model"
              ? "Loading model…"
              : stage === "processing"
                ? `Analysing ${progress.done}/${progress.total}`
                : frames.length
                  ? "Re-analyse"
                  : "Analyse"}
          </button>
          {stage === "processing" && (
            <button className="rounded-md border border-line bg-panel-2 px-3 py-1.5 text-sm" onClick={() => abortRef.current?.abort()}>
              stop
            </button>
          )}
        </div>
      </header>

      {error && <div className="mx-5 mt-3 shrink-0 rounded-md border border-bad bg-red-950 px-3 py-2 text-sm">{error}</div>}

      <main className={`grid flex-1 gap-4 p-5 lg:min-h-0 lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden ${stage === "ready" ? "lg:grid-cols-[minmax(0,1fr)_380px]" : "grid-cols-1"}`}>
        <section className="flex min-w-0 flex-col gap-3 lg:min-h-0">
          {!src && (
            <div
              className="rounded-xl border-2 border-dashed border-line px-5 py-20 text-center text-muted"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files?.[0];
                if (f) onFile(f);
              }}
            >
              Drop a down-the-line or face-on swing video here
            </div>
          )}
          {src && (
            <div
              className={`relative mx-auto max-h-[72vh] max-w-full overflow-hidden rounded-xl bg-black lg:min-h-0 lg:max-h-none lg:flex-1 ${marking ? "cursor-crosshair ring-2 ring-warn" : ""}`}
              style={{ aspectRatio: dims.w && dims.h ? `${dims.w} / ${dims.h}` : "9 / 16" }}
              onPointerDown={onVideoPointerDown}
              onPointerMove={onVideoPointerMove}
              onPointerUp={onVideoPointerUp}
            >
              <video
                ref={videoRef}
                src={src}
                playsInline
                muted
                loop={loop}
                preload="auto"
                className="block h-full w-full object-contain"
                onLoadedMetadata={(e) => {
                  const v = e.currentTarget;
                  v.playbackRate = rate;
                  setDims({ w: v.videoWidth, h: v.videoHeight });
                }}
              />
              {dims.w > 0 && (
                <Overlay width={dims.w} height={dims.h} frame={frame} address={address} view={view} hand={hand} club={CLUBS[club]} show={show} tracer={tracer} checks={checks} />
              )}
              {stage === "processing" && (
                <div className="absolute inset-x-0 bottom-0 h-1 bg-white/15">
                  <div className="h-full bg-accent transition-[width]" style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
                </div>
              )}
            </div>
          )}
          {stage === "ready" && positions && (
            <>
              <div className="flex shrink-0 items-center gap-4 text-xs text-muted">
                {(["skeleton", "lines", "ghost", "tracer"] as const).map((k) => (
                  <label key={k} className="flex items-center gap-1.5">
                    <input type="checkbox" checked={show[k]} onChange={(e) => setShow({ ...show, [k]: e.target.checked })} />
                    {k === "ghost" ? "address ghost" : k === "lines" ? "reference lines" : k === "tracer" ? "ball tracer" : "skeleton"}
                  </label>
                ))}
                <span className="mx-1 h-4 w-px bg-line" />
                <button
                  className={`rounded-md border px-2 py-0.5 ${marking ? "border-warn text-warn" : "border-line hover:border-muted"}`}
                  onClick={() => setMarking((m) => !m)}
                  aria-pressed={marking}
                  disabled={!!exporting}
                  title="Mark the ball on the current frame by clicking it (B). Shift-click to skip the snap."
                >
                  {marking ? "marking ball… (esc)" : "mark ball (B)"}
                </button>
                {frame && !frame.lm && <span className="text-warn">no pose detected on this frame</span>}
                <span className="ml-auto flex items-center gap-2">
                  {exporting ? (
                    <>
                      <span className="tabular-nums">exporting {Math.round(exporting.fraction * 100)}% · keep this tab visible</span>
                      <button className="rounded-md border border-line px-2 py-0.5 hover:border-muted" onClick={() => exportAbort.current?.abort()}>
                        cancel
                      </button>
                    </>
                  ) : (
                    <button
                      className="rounded-md border border-line px-2 py-0.5 hover:border-muted disabled:opacity-50"
                      onClick={runExport}
                      disabled={!canExport()}
                      title={canExport() ? `Download the clip at ${rate}x with the helpers that are switched on` : "This browser cannot record video"}
                    >
                      export video{rate !== 1 ? ` (${rate}x)` : ""}
                    </button>
                  )}
                </span>
              </div>
              {(marks.length > 0 || marking) && (
                <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-xs text-muted">
                  <span>
                    ball marks
                    {marks.length > 0 && marks.length < MIN_MARKS && ` (need ${MIN_MARKS})`}
                    {trajectory && ` · fit ±${(trajectory.rms * dims.h).toFixed(1)}px`}
                    {landingFrame !== null && ` · lands @ #${landingFrame}`}
                    {marks.length ? ":" : ": none yet"}
                  </span>
                  {marks.map((m) => {
                    const here = m.frame === current;
                    return (
                      <span key={m.frame} className={`inline-flex items-center overflow-hidden rounded-md border ${here ? "border-warn text-warn" : "border-line"}`}>
                        <button className="px-1.5 py-0.5 tabular-nums hover:bg-panel-2" onClick={() => seekTo(m.frame)} title={`Jump to frame ${m.frame}`}>
                          #{m.frame}
                          {m.frame <= (positions?.P4 ?? 0) ? " (ball at rest)" : ""}
                        </button>
                        <button
                          className="border-l border-line px-1.5 py-0.5 hover:bg-panel-2 hover:text-bad"
                          onClick={() => setMarks((ms) => ms.filter((x) => x.frame !== m.frame))}
                          title={`Delete mark #${m.frame}`}
                          aria-label={`Delete mark ${m.frame}`}
                        >
                          ×
                        </button>
                      </span>
                    );
                  })}
                  {marks.length > 0 && (
                    <button className="rounded-md border border-line px-2 py-0.5 hover:border-muted" onClick={() => setMarks([])}>
                      clear all
                    </button>
                  )}
                  {horizonOverride !== null && (
                    <button
                      className="rounded-md border border-line px-2 py-0.5 hover:border-muted"
                      onClick={() => setHorizonOverride(null)}
                      title="Put the horizon back at the estimated camera eye level"
                    >
                      reset horizon
                    </button>
                  )}
                </div>
              )}
              {marking && (
                <p className="shrink-0 text-xs text-muted">
                  Click the ball. Mark it at address (or impact), then on {MIN_MARKS - 1}+ frames in flight, spread as far apart as you
                  can; three marks are enough, more make the fit tighter. The dashed line is the fitted path (fainter where it is
                  extrapolated) and the white ring is where the fit expects the ball on this frame: if the ring is off the ball, add
                  a mark here or delete a bad one. Re-click a frame to move its mark.
                  {view === "dtl" &&
                    " On a down-the-line clip, drag the blue dashed line to the camera's eye level (for a phone near the ground that is about the far end of the range): it tells the fit where the ground is, so the path ends at the landing."}
                </p>
              )}
              <Timeline
                total={frames.length}
                current={current}
                positions={positions}
                playing={playing}
                rate={rate}
                loop={loop}
                onSeek={seekTo}
                onTogglePlay={() => setPlaying((p) => !p)}
                onRate={setRate}
                onToggleLoop={() => setLoop((l) => !l)}
                onSetPosition={setPosition}
              />
            </>
          )}
        </section>
        {stage === "ready" && (
          <ScorePanel analysis={analysis} onJump={(k) => positions && seekTo(positions[k])} onSeek={seekTo} shown={shownChecks} onShown={setShownChecks} />
        )}
      </main>
    </div>
  );
}

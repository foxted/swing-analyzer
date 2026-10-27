"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Overlay from "./Overlay";
import Timeline from "./Timeline";
import ScorePanel from "./ScorePanel";
import { extractFrames, ModelSize } from "@/lib/pose";
import { detectPositions, detectView } from "@/lib/positions";
import { analyse } from "@/lib/metrics";
import { CameraView, Frame, Handedness, PositionKey, Positions } from "@/lib/types";
import { CLUB_KEYS, CLUBS, ClubType } from "@/lib/clubs";

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
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [show, setShow] = useState({ skeleton: true, lines: true, ghost: false });
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

  const onFile = (file: File) => {
    abortRef.current?.abort();
    if (src) URL.revokeObjectURL(src);
    setSrc(URL.createObjectURL(file));
    setFileName(file.name);
    setFrames([]);
    setPositions(null);
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
  }, [playing, fps, frames.length]);

  // Keyboard: arrows step frames (shift = 5), space toggles play, 1-6 jump to P1-P6.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (stage !== "ready") return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT") return;
      if (e.key === "ArrowLeft") seekTo(current - (e.shiftKey ? 5 : 1));
      else if (e.key === "ArrowRight") seekTo(current + (e.shiftKey ? 5 : 1));
      else if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (/^[1-6]$/.test(e.key) && positions) seekTo(positions[`P${e.key}` as PositionKey]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stage, current, positions, seekTo]);

  const setPosition = (k: PositionKey, frame: number) => setPositions((p) => (p ? { ...p, [k]: frame } : p));

  const frame = frames[current];
  const address = positions ? frames[positions.P1] : undefined;
  const busy = stage === "processing" || stage === "loading-model";

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-wrap items-center gap-4 border-b border-line px-5 py-3">
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

      {error && <div className="mx-5 mt-3 rounded-md border border-bad bg-red-950 px-3 py-2 text-sm">{error}</div>}

      <main className={`grid flex-1 gap-4 p-5 ${stage === "ready" ? "lg:grid-cols-[minmax(0,1fr)_380px]" : "grid-cols-1"}`}>
        <section className="flex min-w-0 flex-col gap-3">
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
              className="relative mx-auto max-h-[72vh] overflow-hidden rounded-xl bg-black"
              style={{ aspectRatio: dims.w && dims.h ? `${dims.w} / ${dims.h}` : "9 / 16" }}
            >
              <video
                ref={videoRef}
                src={src}
                playsInline
                muted
                preload="auto"
                className="block h-full w-full object-contain"
                onLoadedMetadata={(e) => {
                  const v = e.currentTarget;
                  setDims({ w: v.videoWidth, h: v.videoHeight });
                }}
              />
              {dims.w > 0 && (
                <Overlay width={dims.w} height={dims.h} frame={frame} address={address} view={view} hand={hand} club={CLUBS[club]} show={show} />
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
              <div className="flex items-center gap-4 text-xs text-muted">
                {(["skeleton", "lines", "ghost"] as const).map((k) => (
                  <label key={k} className="flex items-center gap-1.5">
                    <input type="checkbox" checked={show[k]} onChange={(e) => setShow({ ...show, [k]: e.target.checked })} />
                    {k === "ghost" ? "address ghost" : k === "lines" ? "reference lines" : "skeleton"}
                  </label>
                ))}
                {frame && !frame.lm && <span className="ml-auto text-warn">no pose detected on this frame</span>}
              </div>
              <Timeline
                total={frames.length}
                current={current}
                positions={positions}
                playing={playing}
                onSeek={seekTo}
                onTogglePlay={() => setPlaying((p) => !p)}
                onSetPosition={setPosition}
              />
            </>
          )}
        </section>
        {stage === "ready" && <ScorePanel analysis={analysis} onJump={(k) => positions && seekTo(positions[k])} />}
      </main>
    </div>
  );
}

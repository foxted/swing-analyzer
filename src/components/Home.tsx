"use client";

import { useEffect, useMemo, useState } from "react";
import { ClipMeta } from "@/lib/store";
import { CLUBS } from "@/lib/clubs";

type Props = {
  recent: ClipMeta[];
  onFile: (file: File) => void;
  onOpen: (clip: ClipMeta) => void;
  onForget: (clip: ClipMeta) => void;
};

export function timeAgo(t: number): string {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

/** Landing: the drop zone, and once anything has been analysed, the recent swings. */
export default function Home({ recent, onFile, onOpen, onForget }: Props) {
  const [over, setOver] = useState(false);
  const empty = recent.length === 0;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-5 py-10">
      <section className={`flex flex-col items-center gap-4 text-center ${empty ? "py-16" : "py-4"}`}>
        {empty && (
          <>
            <h2 className="text-3xl font-semibold tracking-tight">Analyse your swing</h2>
            <p className="max-w-md text-muted">
              Drop a down-the-line or face-on clip. Posture, tempo, sway, knee flex and more, scored on the video, with a ball tracer you
              can export. Everything stays on this device.
            </p>
          </>
        )}
        <label
          className={`flex w-full max-w-xl cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-6 py-12 transition-colors ${
            over ? "border-accent bg-panel-2" : "border-line hover:border-muted"
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) onFile(f);
          }}
        >
          <input
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) onFile(f);
            }}
          />
          <span className="text-base font-medium">{empty ? "Drop a swing video here" : "Analyse a new swing"}</span>
          <span className="text-sm text-muted">or click to choose a file · phone clips work best, 60 fps or more</span>
        </label>
      </section>

      {!empty && (
        <section>
          <h2 className="mb-3 text-xs uppercase tracking-widest text-muted">Recent swings</h2>
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {recent.map((c) => (
              <Card key={c.key} clip={c} onOpen={() => onOpen(c)} onForget={() => onForget(c)} />
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">
            Saved in this browser only. A card marked “needs file” has its analysis but not the video; open it and pick the same file to
            get it back without re-processing.
          </p>
        </section>
      )}
    </div>
  );
}

function Card({ clip, onOpen, onForget }: { clip: ClipMeta; onOpen: () => void; onForget: () => void }) {
  const thumb = clip.summary?.thumb ?? null;
  const url = useMemo(() => (thumb ? URL.createObjectURL(thumb) : null), [thumb]);
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);
  const score = clip.summary?.score;
  const tone = score === undefined ? "text-muted" : score >= 8 ? "text-accent" : score >= 6 ? "text-warn" : "text-bad";
  const name = clip.name.replace(/\.[^.]+$/, "");
  return (
    <li className="group relative">
      <button className="flex w-full flex-col overflow-hidden rounded-xl border border-line bg-panel text-left hover:border-muted" onClick={onOpen}>
        <div className="relative aspect-[3/4] w-full bg-black">
          {url ? (
            <img src={url} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-muted">no preview</div>
          )}
          {score !== undefined && (
            <span className={`absolute left-2 top-2 rounded-md bg-black/70 px-1.5 py-0.5 text-sm font-bold tabular-nums ${tone}`}>{score.toFixed(1)}</span>
          )}
          {!clip.hasBlob && <span className="absolute right-2 top-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] text-warn">needs file</span>}
        </div>
        <div className="flex flex-col gap-0.5 px-2.5 py-2">
          <span className="truncate text-sm font-medium" title={clip.name}>
            {name}
          </span>
          <span className="truncate text-[11px] text-muted">
            {clip.summary?.view === "faceOn" ? "face on" : "down the line"} · {clip.settings.clubLabel || CLUBS[clip.settings.club]?.label.toLowerCase() || clip.settings.club} ·{" "}
            {timeAgo(clip.savedAt)}
          </span>
        </div>
      </button>
      <button
        className="absolute bottom-2 right-2 hidden rounded-md border border-line bg-panel px-1.5 text-xs text-muted hover:border-bad hover:text-bad group-hover:block"
        onClick={(e) => {
          e.stopPropagation();
          onForget();
        }}
        title="Remove this swing from the list"
        aria-label={`Remove ${clip.name}`}
      >
        ×
      </button>
    </li>
  );
}

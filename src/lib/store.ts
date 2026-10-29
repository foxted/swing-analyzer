import { CameraView, ClubMark, Frame, Handedness, Positions } from "@/lib/types";
import { ClubType } from "@/lib/clubs";
import { ModelSize } from "@/lib/pose";
import { BallMark } from "@/lib/tracer";

/**
 * Local persistence so a reload does not lose the clip. Everything lives in the browser's
 * IndexedDB, nothing leaves the machine:
 *
 *   meta      small record per clip: name, size, timestamps, settings, marks. Cheap to list.
 *   analysis  the pose frames and P-positions: the slow part to recompute, ~1 MB per clip.
 *   blobs     a copy of the video bytes, when the file is under MAX_BLOB_BYTES. With it a reload
 *             restores silently even if the original file moved; without it the app asks for the
 *             file again and restores the analysis the moment the same file is picked.
 *
 * Clips are keyed by name + size + modified time, which is what the file picker exposes. The
 * last MAX_CLIPS are kept. Every call swallows storage failures (private windows, quota, Safari
 * eviction): persistence is a convenience, never something the app depends on.
 */

export const MAX_CLIPS = 5;
export const MAX_BLOB_BYTES = 200 * 1024 * 1024;

const DB = "swing-analyzer";
const VERSION = 1;

export type ClipSettings = {
  fps: number;
  model: ModelSize;
  hand: Handedness;
  club: ClubType;
  /** Free-text club name, e.g. "7-iron"; empty = just the type. */
  clubLabel?: string;
  viewOverride: CameraView | "auto";
  show: { skeleton: boolean; lines: boolean; ghost: boolean; tracer: boolean; shaft?: boolean };
  marks: BallMark[];
  /** Hand-placed clubhead marks; absent on clips saved before shaft support. */
  clubMarks?: ClubMark[];
  horizonOverride: number | null;
  shownChecks: string[];
  /** Where the user dragged the on-video stats card (normalised top-left); absent = default. */
  cardPos?: { x: number; y: number } | null;
};

/** What the home screen shows on a card. */
export type ClipSummary = {
  score: number;
  view: CameraView;
  /** Small JPEG of the impact frame. */
  thumb?: Blob | null;
};

export type ClipMeta = {
  key: string;
  name: string;
  size: number;
  lastModified: number;
  /** When the analysis was last saved. */
  savedAt: number;
  /** Whether the video bytes are stored too (restorable without the file). */
  hasBlob: boolean;
  settings: ClipSettings;
  summary: ClipSummary;
};

export type ClipAnalysis = { key: string; frames: Frame[]; positions: Positions };

export function fileKey(file: { name: string; size: number; lastModified: number }): string {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("no indexedDB"));
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of ["meta", "analysis", "blobs"]) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("blocked"));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function get<T>(store: IDBObjectStore, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const r = store.get(key);
    r.onsuccess = () => resolve(r.result as T | undefined);
    r.onerror = () => reject(r.error);
  });
}

function all<T>(store: IDBObjectStore): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const r = store.getAll();
    r.onsuccess = () => resolve(r.result as T[]);
    r.onerror = () => reject(r.error);
  });
}

/** Ask the browser not to evict our data under storage pressure. Silent either way. */
export async function requestPersistence(): Promise<void> {
  try {
    if (navigator.storage?.persist) await navigator.storage.persist();
  } catch {
    /* ignore */
  }
}

/** Saved clips, most recent first. Empty on any failure. */
export async function listClips(): Promise<ClipMeta[]> {
  try {
    const db = await open();
    const tx = db.transaction("meta", "readonly");
    const rows = await all<ClipMeta>(tx.objectStore("meta"));
    db.close();
    return rows.sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

export async function loadClip(key: string): Promise<{ meta: ClipMeta; analysis: ClipAnalysis | null; blob: Blob | null } | null> {
  try {
    const db = await open();
    const tx = db.transaction(["meta", "analysis", "blobs"], "readonly");
    const meta = await get<ClipMeta>(tx.objectStore("meta"), key);
    if (!meta) {
      db.close();
      return null;
    }
    const analysis = (await get<ClipAnalysis>(tx.objectStore("analysis"), key)) ?? null;
    const blobRow = await get<{ key: string; blob: Blob }>(tx.objectStore("blobs"), key);
    db.close();
    return { meta, analysis, blob: blobRow?.blob ?? null };
  } catch {
    return null;
  }
}

/**
 * Save or update a clip. `analysis` and `blob` are optional so settings changes can be written
 * without rewriting the frames or the video. The file is only stored when under the size cap.
 * Trims the store to MAX_CLIPS afterwards. Returns whether the video bytes are now stored.
 */
export async function saveClip(
  file: { name: string; size: number; lastModified: number },
  settings: ClipSettings,
  summary: ClipSummary,
  analysis?: { frames: Frame[]; positions: Positions },
  blob?: Blob | null
): Promise<boolean> {
  const key = fileKey(file);
  try {
    const db = await open();
    const tx = db.transaction(["meta", "analysis", "blobs"], "readwrite");
    const metaStore = tx.objectStore("meta");
    const prev = await get<ClipMeta>(metaStore, key);
    let hasBlob = prev?.hasBlob ?? false;
    if (blob && !hasBlob && blob.size <= MAX_BLOB_BYTES) {
      tx.objectStore("blobs").put({ key, blob });
      hasBlob = true;
    }
    if (analysis) tx.objectStore("analysis").put({ key, frames: analysis.frames, positions: analysis.positions } satisfies ClipAnalysis);
    const meta: ClipMeta = {
      key,
      name: file.name,
      size: file.size,
      lastModified: file.lastModified,
      savedAt: Date.now(),
      hasBlob,
      settings,
      // Keep an existing thumbnail when this save does not bring one.
      summary: { ...summary, thumb: summary.thumb ?? prev?.summary?.thumb ?? null },
    };
    metaStore.put(meta);
    // Trim: drop the oldest beyond MAX_CLIPS.
    const rows = (await all<ClipMeta>(metaStore)).sort((a, b) => b.savedAt - a.savedAt);
    for (const old of rows.slice(MAX_CLIPS)) {
      if (old.key === key) continue;
      metaStore.delete(old.key);
      tx.objectStore("analysis").delete(old.key);
      tx.objectStore("blobs").delete(old.key);
    }
    await done(tx);
    db.close();
    return hasBlob;
  } catch {
    return false;
  }
}

export async function deleteClip(key: string): Promise<void> {
  try {
    const db = await open();
    const tx = db.transaction(["meta", "analysis", "blobs"], "readwrite");
    tx.objectStore("meta").delete(key);
    tx.objectStore("analysis").delete(key);
    tx.objectStore("blobs").delete(key);
    await done(tx);
    db.close();
  } catch {
    /* ignore */
  }
}

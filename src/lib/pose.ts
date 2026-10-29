import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import { Frame, Shaft } from "@/lib/types";
import { detectShaft } from "@/lib/shaft";

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODELS = {
  lite: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
  full: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
  heavy: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task",
};
export type ModelSize = keyof typeof MODELS;

let landmarker: PoseLandmarker | null = null;
let loadedModel: ModelSize | null = null;
let lastTimestamp = 0;

/**
 * VIDEO mode demands strictly increasing timestamps for the lifetime of a landmarker instance,
 * across runs and across videos. Wall-clock since page load satisfies that regardless of module
 * state (which Fast Refresh can reset), with a +1 guard for calls inside the same millisecond.
 */
function nextTimestamp(): number {
  lastTimestamp = Math.max(lastTimestamp + 1, Math.floor(performance.now()));
  return lastTimestamp;
}

export async function getLandmarker(model: ModelSize): Promise<PoseLandmarker> {
  if (landmarker && loadedModel === model) return landmarker;
  landmarker?.close();
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  landmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODELS[model], delegate: "GPU" },
    runningMode: "VIDEO",
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  loadedModel = model;
  return landmarker;
}

function seek(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      video.removeEventListener("seeked", done);
      resolve();
    };
    video.addEventListener("seeked", done);
    video.currentTime = t;
  });
}

/**
 * Walk the video frame by frame (at `fps`) and run pose detection on each one.
 * Seeking is slow-ish but deterministic; a 6 s clip at 60 fps is ~360 frames.
 */
export async function extractFrames(
  video: HTMLVideoElement,
  fps: number,
  model: ModelSize,
  onProgress: (done: number, total: number) => void,
  signal?: AbortSignal
): Promise<Frame[]> {
  const lm = await getLandmarker(model);
  const total = Math.max(1, Math.floor(video.duration * fps));
  const frames: Frame[] = [];
  const aspect = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : undefined;
  let prevShaft: Shaft | null = null;
  video.pause();
  for (let i = 0; i < total; i++) {
    if (signal?.aborted) break;
    const t = i / fps;
    await seek(video, Math.min(t, video.duration - 1e-3));
    const timeMs = Math.round(t * 1000);
    const res = lm.detectForVideo(video, nextTimestamp());
    const pose = res.landmarks[0] ?? null;
    const world = res.worldLandmarks[0] ?? null;
    // Shaft from the pixels around the hands, on the same seeked frame.
    const shaft: Shaft | null = pose ? detectShaft(video, pose, prevShaft) : null;
    prevShaft = shaft;
    frames.push({ index: i, timeMs, lm: pose, world, aspect, shaft });
    if (i % 5 === 0) onProgress(i + 1, total);
  }
  onProgress(total, total);
  return frames;
}

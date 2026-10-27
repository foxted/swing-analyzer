import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import { Frame } from "@/lib/types";

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODELS = {
  lite: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
  full: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
  heavy: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task",
};
export type ModelSize = keyof typeof MODELS;

let landmarker: PoseLandmarker | null = null;
let loadedModel: ModelSize | null = null;

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
  video.pause();
  for (let i = 0; i < total; i++) {
    if (signal?.aborted) break;
    const t = i / fps;
    await seek(video, Math.min(t, video.duration - 1e-3));
    const timeMs = Math.round(t * 1000);
    const res = lm.detectForVideo(video, timeMs + i * 0.001);
    const pose = res.landmarks[0] ?? null;
    const world = res.worldLandmarks[0] ?? null;
    frames.push({ index: i, timeMs, lm: pose, world });
    if (i % 5 === 0) onProgress(i + 1, total);
  }
  onProgress(total, total);
  return frames;
}

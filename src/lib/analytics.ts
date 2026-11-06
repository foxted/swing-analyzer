import posthog from "posthog-js";
import { CameraView } from "@/lib/types";
import { ClubType } from "@/lib/clubs";
import { ModelSize } from "@/lib/pose";

/**
 * Product events. Everything the analyzer does happens on-device, so these are the only signal
 * of what people actually do with it. No file names, no frames, no PII: shapes and numbers only.
 * posthog.capture is a no-op when PostHog was never initialised (local dev without a key).
 */

export type UploadEvent = { size_bytes: number; mime: string; fps: number; model: ModelSize; club: ClubType };
export type AnalysisEvent = UploadEvent & { view: CameraView; score: number; frames: number; duration_ms: number };
export type FailureEvent = { reason: string; stage: "loading-model" | "processing"; duration_ms: number };
export type ExportEvent = { view: CameraView; rate: number; ext: string; size_bytes: number; duration_ms: number };

export const track = {
  uploaded: (p: UploadEvent) => posthog.capture("swing_video_uploaded", p),
  completed: (p: AnalysisEvent) => posthog.capture("swing_analysis_completed", p),
  failed: (p: FailureEvent) => posthog.capture("swing_analysis_failed", p),
  exported: (p: ExportEvent) => posthog.capture("ball_tracer_exported", p),
};

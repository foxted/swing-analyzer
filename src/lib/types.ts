export type Pt = { x: number; y: number; z: number; visibility?: number };

/** One analysed video frame. `lm` is normalized image coords (0..1), `world` is metres, hip-centred. */
export type Frame = {
  index: number;
  timeMs: number;
  lm: Pt[] | null;
  world: Pt[] | null;
};

export type CameraView = "dtl" | "faceOn";
export type Handedness = "right" | "left";

export type PositionKey = "P1" | "P2" | "P3" | "P4" | "P5" | "P6";
export type Positions = Record<PositionKey, number>;

export const POSITION_LABELS: Record<PositionKey, string> = {
  P1: "Address",
  P2: "Shaft parallel (back)",
  P3: "Top",
  P4: "Impact",
  P5: "Shaft parallel (through)",
  P6: "Finish",
};

export const POSITION_KEYS: PositionKey[] = ["P1", "P2", "P3", "P4", "P5", "P6"];

export type Metric = {
  id: string;
  label: string;
  value: number;
  unit: string;
  target: string;
  deduction: number;
  maxDeduction: number;
  tip: string;
  positions: PositionKey[];
  /** Frame where the measured peak happened, when the metric is not tied to a single P-position. */
  frame?: number;
};

export type Analysis = {
  view: CameraView;
  score: number;
  metrics: Metric[];
  /** Knee angle that reads as fully straight for this clip, and whether it came from the clip or a default. */
  straightKnee: { angle: number; calibrated: boolean };
};

// MediaPipe Pose landmark indices
export const LM = {
  nose: 0,
  leftEye: 2,
  rightEye: 5,
  leftEar: 7,
  rightEar: 8,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
  leftFootIndex: 31,
  rightFootIndex: 32,
} as const;

export const SKELETON: [number, number][] = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
  [27, 29],
  [29, 31],
  [27, 31],
  [28, 30],
  [30, 32],
  [28, 32],
  [7, 8],
  [0, 7],
  [0, 8],
];

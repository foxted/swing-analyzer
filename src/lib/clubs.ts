export type ClubType = "wedge" | "iron" | "hybrid" | "wood" | "driver";

export type ClubProfile = {
  label: string;
  /** Shaft angle from the ground at address, degrees. Drives the DTL shaft-plane line. */
  shaftAngle: number;
  /** Ball position face-on: 0 = stance centre, 1 = lead heel. */
  ballPosition: number;
  /** Spine tilt away from target at address, degrees [lo, hi]. */
  spineTilt: [number, number];
  /** Spine angle from vertical at address (DTL), degrees [lo, hi]. */
  posture: [number, number];
  /** Head position at impact vs address, fraction of shoulder width toward target [lo, hi]. */
  headAtImpact: [number, number];
  /** Hip movement toward ball at impact (early extension), fraction of torso length [lo, hi]. */
  earlyExtension: [number, number];
};

export const CLUBS: Record<ClubType, ClubProfile> = {
  wedge: {
    label: "Wedge",
    shaftAngle: 64,
    ballPosition: 0,
    spineTilt: [2, 10],
    posture: [34, 48],
    headAtImpact: [-0.15, 0.12],
    earlyExtension: [-0.1, 0.12],
  },
  iron: {
    label: "Iron",
    shaftAngle: 61,
    ballPosition: 0.25,
    spineTilt: [3, 15],
    posture: [30, 45],
    headAtImpact: [-0.15, 0.1],
    earlyExtension: [-0.1, 0.12],
  },
  hybrid: {
    label: "Hybrid",
    shaftAngle: 59,
    ballPosition: 0.45,
    spineTilt: [5, 15],
    posture: [28, 42],
    headAtImpact: [-0.2, 0.08],
    earlyExtension: [-0.1, 0.12],
  },
  wood: {
    label: "Fairway wood",
    shaftAngle: 57,
    ballPosition: 0.6,
    spineTilt: [6, 18],
    posture: [25, 40],
    headAtImpact: [-0.25, 0.05],
    earlyExtension: [-0.1, 0.15],
  },
  driver: {
    label: "Driver",
    shaftAngle: 56,
    ballPosition: 0.9,
    spineTilt: [8, 20],
    posture: [22, 36],
    headAtImpact: [-0.35, 0.0],
    earlyExtension: [-0.1, 0.15],
  },
};

export const CLUB_KEYS = Object.keys(CLUBS) as ClubType[];

# Swing Analyzer

Local, in-browser golf swing analysis. Drop a down-the-line or face-on clip, get a stick figure, reference lines, P1-P6 positions and an explainable score out of 10. Nothing leaves the machine; pose detection runs on-device with MediaPipe (WASM + WebGPU/WebGL).

## Run

```
pnpm install
pnpm dev
```

Open http://localhost:5180, pick a clip, set fps to match the clip (60 for standard iPhone, 240 for slo-mo), hit Analyse.

## How it works

- `src/lib/pose.ts` seeks the video frame by frame and runs MediaPipe PoseLandmarker on each one (33 landmarks, normalized + world coords).
- `src/lib/positions.ts` finds P1-P6 from landmark motion alone: impact = fastest hands refined to "hands back at address", address = last quiet window before that, top = highest hands, P2/P5 = hands crossing hip height, finish = motion settles. Every position can be overridden with the `set` button under each P.
- `src/lib/metrics.ts` measures body-only metrics per camera view (early extension, spine angle maintenance, head sway, lead arm, hip position at impact, tempo, etc.), compares each to a reference range and deducts proportionally. Score = 10 minus deductions. Reference ranges are hand-tuned, not tour data; tweak them in that file.
- `src/components/Analyzer.tsx` is the client component mounted by `app/page.tsx`; Tailwind v4 via `@tailwindcss/postcss`.
- `src/components/Overlay.tsx` draws the skeleton plus reference lines locked from address (head box, spine, hip wall, toe line, estimated shaft plane for DTL; ankle lines and shoulder line for face-on).

## Keyboard

- `←` / `→` step one frame (`shift` = 5)
- `space` play / pause
- `1`..`6` jump to P1..P6

## Known limits

- No club detection yet. P2/P5 use hands-at-hip-height as a proxy for shaft parallel; shaft plane at address is an estimate from hand and toe positions.
- Auto view detection uses shoulder width vs torso height at the first frame; override with the `view` dropdown if it guesses wrong.
- Processing speed depends on the model: lite ~15 ms/frame, heavy ~60 ms/frame on an M-series Mac.

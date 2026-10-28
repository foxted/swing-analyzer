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
- Knees: `geometry.ts` measures the hip-knee-ankle angle from the 3D world landmarks (the 2D angle reads ~180° face-on whatever the knee does). MediaPipe never reads 180° for a locked knee, and the offset differs per person and camera, so "fully straight" is calibrated per clip as the 98th percentile of both knees' angles over the whole clip (the lead leg posts straight through impact or at the finish in nearly every swing), falling back to 175° when the clip never shows a straight leg. Both knee checks are then degrees of flex short of that: at address 2 to 25° (both views; anything short of locked and short of sitting is fine); in the backswing `metrics.ts` takes the trail knee's straightest point between P1 and P3 and deducts for whichever is worse, under 4° of flex left (locked) or straightening by more than 8° from address. Extra flex going back is never penalised.
- `src/components/Analyzer.tsx` is the client component mounted by `app/page.tsx`; Tailwind v4 via `@tailwindcss/postcss`.
- `src/components/Overlay.tsx` draws the skeleton plus reference lines locked from address (head box, spine, hip wall, toe line, estimated shaft plane for DTL; ankle lines and shoulder line for face-on).

## Checks on the video

Every check in the score panel has a `show` toggle (`all on video` / `none` above the list, and one for the score itself). A shown check draws what it measures on the current frame with the live number: the knee or elbow angle as an arc, the spine against a vertical, head and hip displacement as an arrow from the address reference, tempo as a backswing/downswing bar. A card in the top-left lists the scored result of each shown check in its colour. Exports burn in whatever is shown. `src/lib/measures.ts` holds one function per check that both the scoring and the live readout call, so the live number lands on the scored one at the key frame; `src/lib/annotations.ts` does the drawing.

## Ball tracer

Click `mark ball` (or press `b`), step to a frame where the ball is visible and click it. Mark the ball at address or impact, then on two or more frames in flight, as spread out as you can; three marks are enough, more tighten the fit. Each click snaps to the brightest blob within a few pixels (shift-click to place it exactly). While marking, the dashed line is the fitted path (fainter where it is extrapolated past the last mark), the white ring is where the fit expects the ball on the current frame and the small ring is the landing. Marks are listed under the video: click one to jump to its frame, `×` deletes it, re-clicking a frame moves its mark.

`src/lib/tracer.ts` fits the marks with the pinhole projection of a drag-free 3D parabola, `x(t) = (p0 + p1 t) / (1 + k t)` and `y(t) = (q0 + q1 t + q2 t²) / (1 + k t)`, time anchored at P4. The vertical curvature `q2` is gravity seen at the ball's distance, so it is pinned by a prior taken from the golfer's size at address (shank and torso lengths against a 1.75 m golfer); that is what lets `k`, the rate at which the ball recedes, be estimated from three marks, where before it had to be fixed at 0 and the path came out as a flat parabola that fell back to the bottom of the frame. `k ≈ 0` is the image-space parabola you get face-on, `k > 0` is a down-the-line shot slowing and converging toward the vanishing point.

The path ends where the ball meets the ground, not where it leaves the frame. Face-on the ground is at the ball's own height. Down the line the ground recedes with the ball, and where it sits at a given depth depends on the camera's eye level, which the marks cannot tell: in marking mode a blue dashed line shows it, defaulting to a camera 0.5 m above the ground. Drag it to the camera's eye level (for a phone near the ground, roughly the far end of the range); `reset horizon` returns to the estimate. Sidespin curve is not modelled, and the extrapolated part can drift by a few percent of the frame per second of flight beyond the marks.

## Export

`export video` plays the clip through once at the selected speed and records it with whatever helpers are switched on (skeleton, reference lines, address ghost, ball tracer) burnt in, then downloads the file. The browser's MediaRecorder picks the container: MP4/H.264 where supported (Chrome, Safari), otherwise WebM. Pick 0.25x or 0.5x first for a slow-motion export; the file plays at that speed. `src/lib/export.ts` and `src/lib/overlay-draw.ts` (the same drawing code the on-screen overlay uses).

## Keyboard

- `←` / `→` step one frame (`shift` = 5)
- `space` play / pause, `l` toggle loop; speed buttons (0.25x to 1x) sit next to the transport
- `b` toggle ball-marking mode, `esc` leaves it
- `1`..`6` jump to P1..P6

## Known limits

- No ball detection: the tracer needs hand-placed marks. The fit ignores drag and spin, and on DTL clips the landing is only as good as the horizon line, so long extrapolations past the last mark are approximate.
- No club detection yet. P2/P5 use hands-at-hip-height as a proxy for shaft parallel; shaft plane at address is an estimate from hand and toe positions.
- Auto view detection uses shoulder width vs torso height at the first frame; override with the `view` dropdown if it guesses wrong.
- Processing speed depends on the model: lite ~15 ms/frame, heavy ~60 ms/frame on an M-series Mac.

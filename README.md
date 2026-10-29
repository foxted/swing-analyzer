# Swing Analyzer

Local, in-browser golf swing analysis. Drop a down-the-line or face-on clip, get a stick figure, reference lines, P1-P6 positions and an explainable score out of 10. Nothing leaves the machine; pose detection runs on-device with MediaPipe (WASM + WebGPU/WebGL).

## Run

```
pnpm install
pnpm dev
```

Open http://localhost:5180, pick a clip, set fps to match the clip (60 for standard iPhone, 240 for slo-mo), hit Analyse.

## How it works

- `src/lib/pose.ts` seeks the video frame by frame and runs MediaPipe PoseLandmarker on each one (33 landmarks, normalized + world coords). See **Model and runtime** below.
- `src/lib/positions.ts` finds P1-P6 from landmark motion alone: impact = fastest hands refined to "hands back at address", address = last quiet window before that, top = highest hands, P2/P5 = hands crossing hip height, finish = motion settles. Every position can be overridden with the `set` button under each P.
- `src/lib/metrics.ts` measures body-only metrics per camera view (early extension, spine angle maintenance, head sway, lead arm, hip position at impact, tempo, etc.), compares each to a reference range and deducts proportionally. Score = 10 minus deductions. Reference ranges are hand-tuned, not tour data; every one is listed under **Heuristics and thresholds** below.
- Knees: `geometry.ts` measures the hip-knee-ankle angle from the 3D world landmarks (the 2D angle reads ~180° face-on whatever the knee does). MediaPipe never reads 180° for a locked knee, and the offset differs per person and camera, so "fully straight" is calibrated per clip as the 98th percentile of both knees' angles over the whole clip (the lead leg posts straight through impact or at the finish in nearly every swing), falling back to 175° when the clip never shows a straight leg. Both knee checks are then degrees of flex short of that: at address 2 to 25° (both views; anything short of locked and short of sitting is fine); in the backswing `metrics.ts` takes the trail knee's straightest point between P1 and P3 and deducts for whichever is worse, under 4° of flex left (locked) or straightening by more than 8° from address. Extra flex going back is never penalised.
- `src/components/Analyzer.tsx` is the client component mounted by `app/page.tsx`; Tailwind v4 via `@tailwindcss/postcss`.
- `src/components/Overlay.tsx` draws the skeleton plus reference lines locked from address (head box, spine, hip wall, toe line, estimated shaft plane for DTL; ankle lines and shoulder line for face-on).

## Model and runtime

No server and no AI API. Everything runs in the browser.

- **Pose**: Google MediaPipe PoseLandmarker through `@mediapipe/tasks-vision` 0.10.14. The WASM runtime loads from jsDelivr and the model file from Google's model store at first use; three sizes are selectable in the header, `lite` (default, ~15 ms/frame on an M-series Mac), `full` and `heavy` (~60 ms/frame). Options: `delegate: "GPU"` (WebGPU/WebGL, falls back to CPU), video mode, one pose, detection and presence confidence 0.5. Each frame gives 33 landmarks in normalised image coordinates plus 3D world coordinates in metres.
- **Frames**: `src/lib/pose.ts` seeks the `<video>` element to each frame at the fps you set and runs the model on the seeked frame, so a 240 fps slow-motion clip is analysed at 240 fps. That is also why the fps setting matters: it is not read from the file.
- **Shaft**: no model either. `src/lib/shaft.ts` finds the club shaft in the pixels around the hands on every analysed frame (see **Club shaft, wrist set and casting**).
- **Everything else is arithmetic** on those landmarks: the P-position finder, the checks, the knee calibration, the shaft detector and the ball tracer are hand-written heuristics in `src/lib`, not models. The constants below are the whole of it.
- **Stack**: Next.js 15, React 19, Tailwind v4, deployed as a static client bundle on Vercel at swing-analysis.roundr.golf. Analyses and clips persist in the browser's IndexedDB only.

## Heuristics and thresholds

All of these are hand-tuned for a beginner to mid-handicap golfer, not tour data. Change them in the file named.

**Camera view** (`positions.ts`): shoulder width divided by torso length on the first frame with a pose; above 0.55 is face on, otherwise down the line. Override with the `view` dropdown.

**Target direction**: face on, the lead shoulder's side of the image is toward the target; down the line, the side where the hands hang relative to the hips is the ball side.

**P-positions** (`positions.ts`), from hand and hip landmark motion only, after light smoothing:

| Position | Rule |
|---|---|
| P4 impact | Fastest hands in the clip (ties go to the middle of the clip), then refined to the frame shortly after the peak where the hands are closest to where they were at address |
| P1 address | Walking back from P4, the last run of 3 or more quiet frames, where quiet means motion energy under 1.5× the clip's 20th percentile. If that leaves fewer than 5 frames of backswing, P1 is set a third of the clip before P4 |
| P3 top | Highest hands between P1 and P4 |
| P2 | First frame after P1 where the hands rise above hip height; if never, 40% of the way from P1 to P3 |
| P5 | First frame after P4 where the hands rise above hip height |
| P6 finish | First run of 4 quiet frames after P5, else the last frame |
| Delivery | Not a card, used by the shaft checks: first frame after P3 where the hands drop back below hip height, else 60% of the way from P3 to P4 |

Every position can be set by hand with the `set` button under its card, and the score recomputes.

**Straight-knee reference** (`geometry.ts`): the hip-knee-ankle angle from the 3D world landmarks. "Fully straight" is the 98th percentile of both knees' angles over the whole clip, accepted when at least 10 readings exist and the result is 160° or more; otherwise 175° is assumed and the panel says so. Knee flex everywhere below is degrees short of that reference.

**Scoring** (`metrics.ts`): score = 10 minus the sum of deductions, floored at 0. Each check has a target range and a tolerance; inside the range costs nothing, and the deduction grows linearly to the check's maximum at `tolerance` past the nearer edge. "SW" is shoulder width at address, "T" is torso length at address, "since address" means the difference from the P1 frame. Percentages are of SW or T so they are size and distance independent.

Both views:

| Check | Measures | Target | Tolerance | Max |
|---|---|---|---|---|
| Tempo | Frames P1→P3 divided by frames P3→P4 | 2.5 to 3.5 | 1.5 | 1 |
| Knee flex at address | Lead knee flex at P1 | 2 to 25° | 10° | 1 |
| Trail knee in backswing | Trail knee at its straightest between P1 and P3: flex left, and straightening since address. The worse of the two counts | at least 4° left; straightened by at most 8° | 4° / 12° | 1.5 |

Face on:

| Check | Measures | Target | Tolerance | Max |
|---|---|---|---|---|
| Head sway going back | Nose x at P3 away from the target since address, % SW | −10 to 25% | 30 | 2 |
| Head at impact | Nose x at P4 toward the target since address, % SW | per club (table below) | 30 | 1.5 |
| Lead arm at the top | Lead elbow angle at P3 | 155 to 180° | 30° | 1.5 |
| Hips at impact | Lead hip ahead of the lead ankle at P4, % SW | 0 to 35% | 30 | 1.5 |
| Spine tilt at address | Shoulder-centre over hip-centre tilt away from the target at P1 | per club | 12° | 1 |
| Balance at finish | Hip centre ahead of the lead ankle at P6, % SW | −25 to 15% | 30 | 1 |
| Wrist set at the top | Angle at the lead wrist between lead forearm and shaft at P3 (180 = no hinge) | 55 to 110° | 25° | 1 |
| Lag at delivery | The same angle at delivery; the casting check. Detail shows how much it opened since the top | 115° or less | 30° | 2 |

Down the line:

| Check | Measures | Target | Tolerance | Max |
|---|---|---|---|---|
| Posture at address | Spine angle from vertical at P1 | per club | 15° | 1.5 |
| Early extension | Hip centre toward the ball at P4 since address, % T | per club | 25 | 2 |
| Posture at impact | Spine angle at P4 minus spine angle at P1 (negative = stood up) | −8 to 10° | 15° | 1.5 |
| Head height at impact | Nose lower at P4 than at P1, % T | −10 to 15% | 25 | 1 |
| Takeaway hands | Hands outside the toe line at P2, % T | −20 to 20% | 30 | 1 |
| Lead arm at the top | Lead elbow angle at P3 | 150 to 180° | 30° | 1 |
| Shaft at the top | Shaft angle from horizontal at P3, + = clubhead below the hands | −30 to 20° | 25° | 1 |
| Shaft plane at delivery | Shaft angle to the ground at delivery minus the club's address shaft angle, + = steeper | −15 to 12° | 20° | 1.5 |

Per-club ranges (`clubs.ts`). The club type also sets the shaft-plane line at address and the face-on ball position marker:

| Club | Spine tilt | Posture | Head at impact (% SW) | Early extension (% T) | Shaft angle |
|---|---|---|---|---|---|
| Wedge | 2 to 10° | 34 to 48° | −15 to 12 | −10 to 12 | 64° |
| Iron | 3 to 15° | 30 to 45° | −15 to 10 | −10 to 12 | 61° |
| Hybrid | 5 to 15° | 28 to 42° | −20 to 8 | −10 to 12 | 59° |
| Fairway wood | 6 to 18° | 25 to 40° | −25 to 5 | −10 to 15 | 57° |
| Driver | 8 to 20° | 22 to 36° | −35 to 0 | −10 to 15 | 56° |

The "Work on" list shows the three largest deductions of at least 0.3.

**Shaft detector** (`shaft.ts`, `ridge.ts`): square crop of 2.9 torso lengths around the hands, downscaled to 176 px; rays every 1.5° from the hand centre, skipping the first 8% and any direction within 16° of either forearm; ridge response = pixel on the ray minus the mean of the pixels 2 px either side; the best consistent-sign run from near the origin gives the direction and the clubhead; accepted when its score is at least 2× the crop's median |response|, 2.5× the 95th percentile of the other directions, and the run is at least 22% of the crop radius. The previous frame's direction is a soft prior (sigma 30°). Angles for the wrist and shaft checks are measured in undistorted image space (x scaled by the video's aspect ratio); the lead-arm angle now is too.

**Ball tracer** (`tracer.ts`): at least 3 marks; gravity prior from the golfer's size assuming 1.75 m tall (fallback scale 0.2 image heights per metre), prior weight σ = 0.004 per mark; flight capped at 8 s; landing accepted from 0.2 s after P4; default horizon at a 0.5 m camera height.

## Checks on the video

Every check in the score panel has a `show` toggle (`all on video` / `none` above the list, and one for the score itself). A shown check draws what it measures on the current frame with the live number: the knee or elbow angle as an arc, the spine against a vertical, head and hip displacement as an arrow from the address reference, tempo as a backswing/downswing bar. A card lists the scored result of each shown check in its colour. It sits below the top 14% of the frame by default and the tempo bar above the bottom 22%, clear of where Instagram and TikTok put the account name, header and caption; drag the card anywhere on the video to move it (`reset card` puts it back) and the position is saved with the clip. Exports burn in whatever is shown, where it is shown. `src/lib/measures.ts` holds one function per check that both the scoring and the live readout call, so the live number lands on the scored one at the key frame; `src/lib/annotations.ts` does the drawing.

## Ball tracer

Click `mark ball` (or press `b`), step to a frame where the ball is visible and click it. Mark the ball at address or impact, then on two or more frames in flight, as spread out as you can; three marks are enough, more tighten the fit. Each click snaps to the brightest blob within a few pixels (shift-click to place it exactly). While marking, the dashed line is the fitted path (fainter where it is extrapolated past the last mark), the white ring is where the fit expects the ball on the current frame and the small ring is the landing. Marks are listed under the video: click one to jump to its frame, `×` deletes it, re-clicking a frame moves its mark.

`src/lib/tracer.ts` fits the marks with the pinhole projection of a drag-free 3D parabola, `x(t) = (p0 + p1 t) / (1 + k t)` and `y(t) = (q0 + q1 t + q2 t²) / (1 + k t)`, time anchored at P4. The vertical curvature `q2` is gravity seen at the ball's distance, so it is pinned by a prior taken from the golfer's size at address (shank and torso lengths against a 1.75 m golfer); that is what lets `k`, the rate at which the ball recedes, be estimated from three marks, where before it had to be fixed at 0 and the path came out as a flat parabola that fell back to the bottom of the frame. `k ≈ 0` is the image-space parabola you get face-on, `k > 0` is a down-the-line shot slowing and converging toward the vanishing point.

The path ends where the ball meets the ground, not where it leaves the frame. Face-on the ground is at the ball's own height. Down the line the ground recedes with the ball, and where it sits at a given depth depends on the camera's eye level, which the marks cannot tell: in marking mode a blue dashed line shows it, defaulting to a camera 0.5 m above the ground. Drag it to the camera's eye level (for a phone near the ground, roughly the far end of the range); `reset horizon` returns to the estimate. Sidespin curve is not modelled, and the extrapolated part can drift by a few percent of the frame per second of flight beyond the marks.

## Club shaft, wrist set and casting

The pose model sees the body, not the club, so the shaft comes from the pixels. On every frame of the analysis, `src/lib/shaft.ts` scans the directions out of the hand centre for a thin straight line with consistent contrast and takes the longest, strongest one as the shaft, with its end as the clubhead. It works wherever the shaft is sharp in the frame and fails on motion blur (60 fps phone clips through the downswing) and when the shaft points at the camera. It draws as a dashed pink line (the `shaft` helper toggle). Press `c` (or `mark club`) and click the clubhead on any frame to place a solid mark that overrides the detection there; re-click to move it, `×` in the list under the video deletes it. Marks are saved with the clip.

Four checks read the shaft, two per view, on two frames: the top (P3) and delivery, the first frame on the way down where the hands drop back below hip height. Face on: **Wrist set at the top** (angle between the lead forearm and the shaft, 180° = no hinge, target 55 to 110°) and **Lag at delivery**, the casting check (the same angle at delivery, 115° or less, with how much it opened since the top). Down the line: **Shaft at the top** (degrees from parallel to the ground, + = clubhead below the hands) and **Shaft plane at delivery** (steeper or shallower than the club's address shaft angle, + = over the top). A check whose frame has no shaft is not scored and the panel says so with a hint to mark those two frames. The eye on each draws the shaft and the angle on the video like the other checks. Face on is the view for casting and lag; down the line is the view for plane. Wrist cup or bow at the top is not measured: the three hand points per side cannot tell flat from cupped.

## Home and saved clips

The app opens on a home screen: a drop zone, and once anything has been analysed, cards for the last five swings with an impact-frame thumbnail, score, view, club and age. Opening a card brings the analysis back exactly as it was left: pose frames, P-positions, ball marks, horizon, shown checks and settings, with no re-processing. The title or `← swings` returns home. Everything is kept in the browser's IndexedDB, including a copy of the video when it is under 200 MB, so the original file is never touched after the picker and moving or deleting it cannot break anything. A card marked “needs file” has its analysis but not the bytes (too big, or evicted by the browser): opening it asks for the file, and picking the same one restores the clip and keeps the bytes from then on. Nothing leaves the machine. `src/lib/store.ts`, `src/components/Home.tsx`.

The club type (wedge, iron, hybrid, wood, driver) drives the reference lines and target ranges; the text box next to it takes the actual club (“7-iron”), which is saved with the clip, shown on its card and used in the on-video captions.

The palette and type follow roundr.golf, light and dark. The theme follows the OS until the button at the right of the header picks one (system → light → dark); the choice is kept in localStorage and applied before first paint. Both sets of colours live at the top of `src/app/globals.css`.

## Export

`export video` plays the clip through once at the selected speed and records it with whatever helpers are switched on (skeleton, reference lines, address ghost, ball tracer) burnt in, then downloads the file. The browser's MediaRecorder picks the container: MP4/H.264 where supported (Chrome, Safari), otherwise WebM. Pick 0.25x or 0.5x first for a slow-motion export; the file plays at that speed. `src/lib/export.ts` and `src/lib/overlay-draw.ts` (the same drawing code the on-screen overlay uses).

## Keyboard

- `←` / `→` step one frame (`shift` = 5)
- `space` play / pause, `l` toggle loop; speed buttons (0.25x to 1x) sit next to the transport
- `b` toggle ball-marking mode, `c` toggle club-marking mode, `esc` leaves either
- `1`..`6` jump to P1..P6

## Known limits

- No ball detection: the tracer needs hand-placed marks. The fit ignores drag and spin, and on DTL clips the landing is only as good as the horizon line, so long extrapolations past the last mark are approximate.
- Shaft detection is pixel-based and needs a sharp shaft: expect gaps through the downswing on 60 fps clips (240 fps slow motion is fine) and whenever the shaft points at the camera. Mark the clubhead by hand on the top and delivery frames when a shaft check is missing. P2/P5 still use hands-at-hip-height as the proxy for shaft parallel.
- Auto view detection uses shoulder width vs torso height at the first frame; override with the `view` dropdown if it guesses wrong.
- Processing speed depends on the model: lite ~15 ms/frame, heavy ~60 ms/frame on an M-series Mac.

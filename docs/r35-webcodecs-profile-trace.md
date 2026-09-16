# R35 — WebCodecs profile/content-hint + encoder trace scout

## Question

R31 established that WebCodecs at 3 Mbps is the lowest tested fixed-bitrate point that clears every semantic ROI against the same-raster x264 CRF22 reference on the canonical vertical C18 fixture. Inspection of the actual R31 outputs then revealed a confounder: the WebCodecs bitstream is Constrained Baseline while the x264 reference is High Profile.

R35 asks whether the remaining byte penalty is primarily a profile/content-mode policy issue before opening more complex rate-control work.

## Fixture

Use exactly the R31 fixture and semantic ROIs:

- `river-station`
- visual system `paper`
- structural variant `hook-first`
- profile `vertical`
- 1080x1920 / 30 fps / 12 seconds
- same Chromium Canvas raster for every codec candidate
- x264 reference explicitly constrained to High Profile / Level 4.0 / CRF22 / veryfast

Creative routing, layout, motion, cover and payload are unchanged.

## Support probe

Before encoding the matrix, call `VideoEncoder.isConfigSupported()` for:

- H.264 Baseline `avc1.420028`
- H.264 Main `avc1.4D0028`
- H.264 High `avc1.640028`

crossed with:

- default vs `contentHint: "text"`
- `latencyMode: "realtime"` vs `"quality"`

The returned config is recorded. Unsupported combinations are evidence, not failures of the run.

## Encode matrix

At the R31 anchor bitrate of 3 Mbps compare:

1. Baseline / default / realtime — R31 anchor semantics.
2. High / default / realtime — isolate codec profile.
3. High / text / realtime — isolate screen-content hint.
4. High / text / quality — test offline semantics.
5. Main / text / quality — fallback/contrast point.

Every produced MP4 is inspected with `ffprobe`; the emitted profile/level is evidence, not inferred from the requested codec string.

The preferred supported policy is then fine-searched at 2.00 / 2.25 / 2.50 / 2.75 / 3.00 Mbps. The same R31 rule is retained: a WebCodecs point passes only when every semantic ROI SSIM meets or exceeds the corresponding same-raster x264 High CRF22 ROI.

## Trace probe

Tracing is separate from performance timing. Capture only 60 frames under the preferred policy and record:

- Chromium `SystemInfo.getInfo` GPU/feature information;
- browser version;
- trace events under media/gpu/blink/cc categories matching encoder, OpenH264, readback, Canvas, SharedImage, texture-copy and RGB/YUV-conversion terms.

The trace is observational. Absence of a named event is not proof of zero-copy. Do not use traced wall time in the codec performance comparison.

## Decision gates

- If High/text materially reduces bytes at equal or better semantic ROI quality, promote that policy and keep quantizer work closed.
- If profile/hint changes do not materially improve rate-distortion, the byte penalty is more fundamental to the current WebCodecs/OpenH264 path and a later bounded rate-control or hardware-backend scout may be justified.
- Do not accept a smaller file that fails any semantic ROI gate.
- Do not claim a GPU or zero-copy path unless trace/SystemInfo evidence identifies it.

## Coordination

R34 owns the single active Runtime PR slot. R35 therefore runs from a push-triggered scratch branch first. Do not open a second Runtime PR until R34 is closed or merged.
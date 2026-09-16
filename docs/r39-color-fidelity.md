# R39 — Color fidelity / color-space contract scout

## Question

Can the current production-shaped Chromium Canvas -> WebCodecs H.264 path be given an explicit, portable color contract before software-vs-hardware/provider comparisons, without re-encoding the video payload or introducing a visible color shift?

This is a correctness experiment, not a throughput optimization.

## Fixed production axis

- Chromium Canvas source at 1080x1920.
- WebCodecs H.264 Baseline (`avc1.420028`).
- Fixed 3 Mbps, 30 fps, `latencyMode=realtime`, Annex-B output.
- Current 4:2:0 encode path; no bitrate/profile/content-hint tuning.
- The same encoded H.264 VCL payload is reused across metadata policies. Explicit variants use FFmpeg `h264_metadata` to edit SPS VUI plus matching MP4 color tags; there is no VCL re-encode.

## Test material

1. A deterministic synthetic 1080x1920 chart with black/white, studio-range neutrals, saturated and book-like colors, plus a grayscale ramp. Patch measurements are taken well inside each block to avoid 4:2:0 edge contamination.
2. A representative C18 vertical book-ad fixture. Frames 45, 165 and 300 (or the final available frame) are captured losslessly from the same Canvas raster and compared with decoded output.

## Metadata policies

- `current`: untouched current H.264 -> MP4 stream copy.
- `bt709-tv`: limited-range BT.709 matrix/transfer/primaries.
- `bt709-pc`: full-range BT.709 diagnostic.
- `bt601-tv`: limited-range SMPTE 170M / BT.601-family diagnostic.

The diagnostics exist to test the assumption; BT.709 limited is not treated as correct merely because the frame is HD.

## Measurements

For every policy:

- `ffprobe`: codec/profile/level/pixel format, range, matrix, transfer, primaries, chroma location.
- Synthetic chart: mean absolute RGB channel error, maximum channel error, neutral cast, black/white endpoint behavior and grayscale monotonicity.
- Representative book frames: full-frame SSIM and PSNR against lossless Canvas PNG references.

The raw browser H.264 stream is probed separately so container defaults are not confused with encoder VUI.

## Predeclared gates

Synthetic pixel gate:

- mean absolute channel error <= 6;
- max absolute channel error <= 18;
- neutral max RGB cast <= 4;
- decoded black mean <= 6;
- decoded white mean >= 249;
- grayscale patches remain strictly monotonic.

An explicit BT.709 limited contract is valid only when:

- `ffprobe` reads `color_range=tv`, `color_space=bt709`, `color_transfer=bt709`, `color_primaries=bt709`;
- the synthetic pixel gate passes;
- representative-book worst SSIM >= 0.97 and worst PSNR >= 30 dB;
- versus untouched current output, worst book SSIM degrades by no more than 0.005 and worst PSNR by no more than 1 dB.

A completed run may therefore be a valid negative result. CI checks report completeness and numeric integrity; it does not require the hypothesis to pass.

## Decision boundary

If explicit BT.709 limited clears the gates while current output is metadata-ambiguous, harden the artifact boundary with explicit SPS VUI + MP4 color tags before hardware/provider economics. If it fails, do not freeze a guessed color contract; use the diagnostic policies and patch errors to identify the real matrix/range behavior first.

R39 does not change concurrency, recycle policy, validation policy, bitrate, profile, creative layout, or provider selection.

# R39 — Color fidelity / color-space contract scout

## Question

Can the current production-shaped Chromium Canvas -> WebCodecs H.264 path be given an explicit, portable color contract before software-vs-hardware/provider comparisons, without re-encoding the video payload or introducing a visible color shift?

This is a correctness experiment, not a throughput optimization.

## Fixed production axis

- Chromium Canvas source at 1080x1920.
- WebCodecs H.264 Baseline (`avc1.420028`).
- Fixed 3 Mbps target, 30 fps, `latencyMode=realtime`, Annex-B output.
- Current 4:2:0 encode path; no bitrate/profile/content-hint tuning.
- The same encoded H.264 VCL payload is reused across metadata policies. Explicit variants use FFmpeg `h264_metadata` to edit SPS VUI plus matching MP4 color tags; there is no VCL re-encode.

## Test material

1. A deterministic synthetic 1080x1920 chart with black/white, studio-range neutrals, saturated and book-like colors, plus a grayscale ramp. Patch measurements are taken well inside each block to avoid 4:2:0 edge contamination.
2. A representative C18 vertical book-ad fixture. Frames 45, 165 and 300 are captured losslessly from the same Canvas raster and compared with decoded output.

## Metadata policies

- `current`: untouched current H.264 -> MP4 stream copy.
- `bt709-tv`: limited-range BT.709 matrix/transfer/primaries.
- `bt709-pc`: full-range BT.709 diagnostic.
- `bt601-tv`: limited-range SMPTE 170M / BT.601-family diagnostic.

The diagnostics test the assumption; BT.709 limited is not treated as correct merely because the frame is HD.

## Canonical run

GitHub Actions run `35150516320` completed successfully after fixing the initial synthetic-page secure-context harness bug. Artifact: `10468993537`.

| policy | range | matrix | transfer | primaries | mean abs RGB err | max RGB err | synthetic gate | book worst SSIM |
|---|---|---|---|---|---:|---:|---|---:|
| current | tv | smpte170m | smpte170m | smpte170m | 0.926 | 3.000 | PASS | 0.993883 |
| bt709-tv | tv | bt709 | bt709 | bt709 | 3.925 | 24.000 | FAIL | 0.993979 |
| bt709-pc | pc | bt709 | bt709 | bt709 | 10.010 | 29.941 | FAIL | 0.972156 |
| bt601-tv | tv | smpte170m | smpte170m | smpte170m | 0.926 | 3.000 | PASS | 0.993883 |

The untouched raw/browser stream is not metadata-ambiguous: it reports TV range with SMPTE 170M matrix, transfer and primaries. Rewriting only VUI/container metadata to BT.709 changes decoder interpretation without changing VCL samples and materially worsens the synthetic RGB round-trip. Full-range BT.709 is worse again.

The exact equality between `current` and explicit `bt601-tv` is useful evidence: the existing encoded samples and their current SMPTE 170M interpretation are internally consistent for this Chromium build/workload. It is not evidence that SMPTE 170M is the desired cross-provider production contract.

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

`bt709-tv` fails the synthetic gate (`max RGB error = 24 > 18`), so explicit BT.709 limited is rejected even though representative-book full-frame SSIM remains high. This is exactly why the patch-level gate exists.

## Decision

Do **not** freeze a post-hoc BT.709 metadata contract and do not rewrite current artifacts to BT.709 by SPS/container tagging alone.

Current Chromium/WebCodecs output is internally consistent as TV-range SMPTE 170M on this tested path. Before comparing QSV/VAAPI/NVENC/provider outputs, run one bounded input-conversion pass that asks a narrower question: can the actual Canvas RGB -> encoder YUV conversion be made explicitly BT.709 (rather than relabeling already encoded samples) while preserving the R31 semantic-quality gate and without material throughput regression?

If the browser/API cannot control that conversion reliably, the production color contract should instead be defined as measured RGB round-trip behavior plus emitted metadata and hardware candidates must match that reference. Provider/hardware economics must not be compared under mismatched color transforms.

R39 does not change concurrency, recycle policy, validation policy, bitrate, profile, creative layout, or provider selection.

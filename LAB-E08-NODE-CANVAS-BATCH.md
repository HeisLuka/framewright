# E08 — Node Canvas batch production probe

Canonical CI run: `35091919070` (PR #17).

## Product question

Can the cheap/editorial Book Ad path run as a browserless mass-production renderer while preserving the existing JavaScript scene/template logic, using pinned fonts and ordinary raster book-cover assets?

## Canonical workload

- 10 diverse `BookAdPayload` fixtures (Cyrillic + Latin, short/long title and author, punctuation, long hooks);
- deterministic 600x900 PNG cover assets;
- 1080x1920, 30 fps, 360 frames / 12 s each;
- pinned DejaVu Sans;
- `@napi-rs/canvas` in one warm Node process;
- raw RGBA directly into FFmpeg;
- `libx264`, preset `veryfast`, CRF 22;
- videos rendered sequentially (no cross-video parallelism in this probe).

Host recorded by the canonical run:

- Linux x64;
- Node `v20.20.2`;
- 4 logical CPUs;
- `AMD EPYC 7763 64-Core Processor`;
- 16,766,414,848 bytes (~15.6 GiB) total RAM.

## Result

- 10 videos: `56.084 s` batch wall time;
- throughput: **641.9 videos/hour**;
- per-video mean: `5.588 s`;
- p50: `5.454 s`;
- p95: `5.715 s`;
- max: `7.063 s` (the intentionally long-title stress fixture);
- peak combined Node + FFmpeg RSS: `711.0 MiB`;
- layout warning groups after the final gate: `0`.

Per-video output sizes were roughly 556–654 KiB for these 12-second flat/editorial fixtures.

## Memory observation

Combined per-video Node+FFmpeg peaks fluctuated between roughly `656` and `711 MiB`. Node RSS after each completed video fluctuated roughly `179–267 MiB` and ended around `222 MiB`; it did not increase monotonically across the 10-video batch.

This is not a long-duration leak proof, but there is **no obvious short-batch memory leak signal**. A later soak test should run hundreds/thousands of payloads before production rollout.

## Chromium parity sanity check

One canonical payload was rendered through both paths with the same pinned font, raster cover and x264 output settings.

Decoded comparison:

- SSIM: **0.997234**;
- PSNR: **38.888497 dB**.

This is stronger than E07's SVG-cover comparison because backend-dependent live SVG text is no longer part of the cover asset.

## Important QA finding

The first visually inspected E08 artifact exposed a bug that the original layout gate missed: the Latin word `Cartographer's` was wider than the book-title column and was clipped at the right edge.

Root cause: `wrapAll()` only wraps at whitespace, while `fitBlock()` previously accepted a block based on line count + height without checking the measured width of every final line.

E08 therefore changed the test template contract so that:

1. `fitBlock()` only accepts a font size when every output line is within `maxW`;
2. a line still too wide at minimum size is ellipsized and marked overflow;
3. the batch QA wrapper independently measures every returned line and fails on width overflow, instead of trusting the template's `overflow` flag alone.

The stress fixture then renders without clipping and the final strengthened gate reports zero warnings.

Before calling the template production-ready, this width-safe fitting rule should be promoted from the E08 template transform into the shared Book Ad / scene runtime itself.

## Decision

For cheap/editorial book ads, **Chromium is no longer required in the hot production render path by the evidence collected so far**.

The leading architecture is now:

`BookAdPayload + pinned assets/fonts -> JS/TS scene logic -> @napi-rs/canvas -> raw RGBA -> encoder -> MP4`

Keep Chromium as a reference/authoring/debug backend if useful, not as a mandatory production dependency.

Do not start a full Rust/C++ renderer rewrite for this workload. The measured browserless JS/Skia-compatible path is already fast enough that the next high-value question is economics and operational throughput, not language replacement.

## Caveats / next checks

- GitHub-hosted runner results are benchmark evidence, not a cloud-cost SLA; run-to-run CPU contention varied materially.
- `@napi-rs/canvas` version must be pinned in the worker image before production benchmarking.
- run a long soak (hundreds+ videos) for memory stability;
- test controlled worker concurrency (1/2/4 simultaneous videos) on an actual priced VM;
- calculate current $/video, $/1k and $/100k on real providers;
- keep heavy RIS/CRT-style templates as a separate cost class because their full-frame post-processing has very different economics.

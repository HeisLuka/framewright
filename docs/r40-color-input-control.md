# R40 — explicit color-input control scout

## Question

R39 proved that relabeling already-encoded SMPTE 170M samples as BT.709 is wrong. R40 asks the narrower blocker before hardware/provider comparisons: can the actual RGB input presented to WebCodecs steer Chromium/OpenH264 into a natively emitted BT.709 limited H.264 stream without post-hoc VUI/container rewriting?

This is a bounded API-control experiment, not another bitrate/profile tuning pass.

## Fixed axes

- exact C18 `river-station / paper / hook-first / vertical` fixture;
- 1080x1920, 30 fps, H.264 Baseline, 3 Mbps, realtime, Annex-B;
- same semantic ROI set used around the R31 quality policy;
- same deterministic synthetic patch/ramp chart family as R39;
- no SPS/MP4 color rewrite after encode.

## Input modes

1. `canvas-direct`: current production-shaped `new VideoFrame(canvas)` path.
2. `rgba-srgb`: exact Canvas RGBA bytes wrapped in a buffer-backed `VideoFrame` with explicit sRGB semantics (`BT.709 primaries + IEC 61966-2-1 transfer + RGB matrix + full range`).
3. `rgba-bt709-rgb`: diagnostic only — the same RGB samples explicitly tagged as BT.709 transfer/primaries with RGB matrix/full range. It tests whether the encoder reacts to source-frame color metadata; it is not automatically accepted merely for emitting BT.709.

The two buffer-backed variants intentionally pay a `getImageData`/RGBA materialization cost. If one proves color control but misses the performance gate, that is evidence for the API/copy boundary, not permission to promote a slow path.

## Predeclared production gate

An explicit input mode passes only if all are true:

- both synthetic and representative book streams natively probe as `tv / bt709 / bt709 / bt709` without post-hoc rewrite;
- R39 synthetic RGB patch gate passes;
- every semantic ROI stays at SSIM >= 0.97 and PSNR >= 30 dB;
- every semantic ROI is no worse than current direct Canvas by more than 0.005 SSIM or 1 dB PSNR;
- full representative-book encode wall is <=10% slower than direct Canvas.

If no mode passes, stop trying to force a BT.709 contract through current browser WebCodecs inputs. Freeze the measured direct-Canvas RGB round-trip plus emitted metadata as the software reference contract, and require QSV/VAAPI/NVENC/provider candidates to match that reference before comparing throughput or dollars.

A negative result is useful: it closes cheap API-level color steering and unblocks the hardware scout with an honest measured-reference contract instead of mislabeled BT.709.

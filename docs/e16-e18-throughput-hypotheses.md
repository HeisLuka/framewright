# E16-E18: stage profile, video-level throughput, encoder presets

Product question: for deterministic mass book-ad rendering, where is the next economically meaningful throughput win?

These experiments intentionally avoid a new renderer rewrite. They measure lifecycle, browser pixel extraction/transport, whole-video scheduling, and encoder settings on the same runner.

## H16A — Chromium lifecycle is not the main cost at current render speed

Measure separately:

- cold Chromium launch;
- first page load + `window.__ready`;
- second page load in the already-warm Chromium process;
- browser-side composition;
- composition + `getImageData()`;
- static `getImageData()` readback;
- localhost binary upload round trip;
- render + readback + upload.

The browser stage numbers are microbenchmarks. Production raw rendering overlaps composition, transfer and FFmpeg, so these values must not be added together as a fake waterfall.

Decision rule: a warm browser pool is high priority only if browser launch/page lifecycle is a material share of canonical full-video wall time. Otherwise keep it as an operational optimization, not the renderer priority.

## H16B — raw readback/localhost transport is not automatically the next bottleneck

`getImageData()` and a same-origin localhost POST are measured independently at 720 and 1080 widths.

Decision rule: prioritize NV12/WebCodecs/shared-memory work only when measured readback + transport is a material share of frame cost or creates backpressure in the real pipeline. Do not infer this from RGBA byte volume alone.

## H17 — video-level parallelism can beat frame-level parallelism

Canonical workload: `examples/book-ad-v0`, 15 seconds / 450 frames, raw RGBA path.

On one runner compare:

- 1 concurrent video × 4 Chromium tabs;
- 2 concurrent videos × 2 tabs each;
- 4 concurrent videos × 1 tab each.

Primary metric: completed videos/hour on one runner. Per-video latency is secondary.

Decision rule: consider job-level partitioning confirmed when the best multi-video configuration improves `videos/hour` by at least 15% over `1 video × 4 tabs` on the same runner. Production capacity still requires rerunning on the actual provider SKU.

## H18 — x264 `slow` may be wasted CPU for book ads

Run the same 15-second book ad with identical source frames, CRF and raw renderer settings using:

- `slow`;
- `medium`;
- `fast`;
- `veryfast`.

Record full render+encode wall time and MP4 size.

Decision rule: an encoder preset is a meaningful throughput lever when it changes full wall time by at least 15%. A production default change additionally requires a visual/perceptual quality gate; speed alone is not sufficient.

## What this experiment does not claim

- GitHub Actions throughput is not DigitalOcean or production throughput.
- A microbenchmark stage time is not an additive production waterfall when stages overlap.
- Faster x264 output is not automatically acceptable quality.
- Warm-pool savings must be compared with full video wall time, not quoted as an isolated launch duration.
- These experiments do not test hardware GPU, hardware encoding, half-resolution CRT or NV12-native post output.

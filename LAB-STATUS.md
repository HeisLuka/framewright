# Framewright Lab status

This branch is the persistent integration point for the Framewright research work.

## Branch policy

- `main` stays pinned to the clean upstream baseline until a separate product decision says otherwise.
- `lab/framewright-research` is the persistent lab branch for reusable benchmark tooling, the production-like Book Ad workload, renderer/encoder experiments, worker infrastructure and reproducibility work.
- One-off experiment branches may remain in Git history after their PR is closed. They are evidence, not merge queues.
- Keep at most one active experiment PR at a time.
- Product decisions and measured conclusions are also recorded in the Framewright Lab Notion page.

## Canonical chain preserved in this branch

The useful canonical research path is now E01-E10:

1. E01 stage profiler.
2. E02 payload-driven Book Ad v0 workload.
3. E03 browser-side WebCodecs path.
4. E04 encoder quality / size / speed matrix.
5. E05 warm worker / concurrency economics.
6. E06 reproducible worker image and golden-frame checks.
7. E07 Node Canvas pinned-font parity.
8. E08 Node Canvas batch production probe with raster covers and strengthened text-layout QA.
9. E09 pinned browserless worker + 100-video soak + cost/provider tooling.
10. E10 4-vCPU concurrency matrix.

The old stacked PRs for completed stages are archival and do not need to remain open.

## Key completed results

- E07: pinned DejaVu Sans raised Node Canvas vs Chromium parity to SSIM `0.994484` / PSNR `32.56 dB` while Node Canvas remained ~2.31x faster end-to-end. Result: `LAB-E07-NODE-CANVAS-FONT-PARITY.md`.
- E08: canonical 10-video browserless batch at `641.9 videos/hour` sequential; p95 `5.715 s`, peak Node+FFmpeg RSS `711 MiB`, Chromium sanity parity SSIM `0.997234`. Result: `LAB-E08-NODE-CANVAS-BATCH.md`.
- E09: pinned worker (`@napi-rs/canvas 1.0.9`, Node 20.20.2, FFmpeg, DejaVu; no Chromium/Puppeteer hot dependency) ran 100 videos at `651.74 videos/hour`, p50 `5.320 s`, p95 `7.004 s`, peak RSS `726.3 MiB`, and no practical monotonic memory-growth signal. Results: `LAB-E09-SOAK-RESULTS.md`, `LAB-E09-COST-SNAPSHOT.md`, `LAB-E09-PROVIDER-TARGETS.md`.
- Visual cost classes: medium/riso and heavy JS full-frame styles were ~3x slower than cheap editorial in the archived Chromium/WebCodecs matrix; real RIS TV spends ~95% of warm render time in `crt()` and is ~3.57 compute fps. Result: `LAB-VISUAL-COST-CLASSES.md`.
- E10: on a 4-CPU / 4 GiB constrained worker, c1=`642.50/h`, c2=`744.64/h`, c4=`771.15/h`. c4 is only `1.20x` c1 and has 30% parallel efficiency, showing the workload is already CPU-saturating. Peak full process-tree RSS at c4 is `2626.8 MiB`. Result: `LAB-E10-CONCURRENCY-RESULTS.md`.

## Current experiment

PR #19 / E10 (`lab/e10-concurrency`) is the only active experiment while the result is being consolidated into `lab/framewright-research`.

Decision from the canonical run `35094835897`:

- batch throughput mode: c4 (`771.15 videos/hour`);
- balanced mode: c2 (`744.64 videos/hour`, ~96.6% of c4 throughput with much lower latency/RAM);
- reference/latency mode: c1;
- do not tune concurrency above 4 on GitHub Actions; the next uncertainty is real provider CPU performance.

After E10 merge, the next step is provider benchmarking with the existing portable E09 runner on actual priced shared and dedicated compute. Cost tables remain normalized estimates until that happens.

## Current architectural direction

Preserve the JS/TS scene/template layer. For cheap/editorial book ads, `@napi-rs/canvas` is the leading production-renderer candidate: it removes Chromium and temporary frame files from the hot path while preserving the current scene logic. Production determinism should come from one pinned renderer + pinned fonts/assets + golden-frame regression tests.

Use separate visual cost tiers:

- STANDARD/FAST: browserless Node Canvas mass-production path;
- RICH: benchmark materialized frame cost, because Canvas can defer rasterization;
- HERO/CRT: optimize full-frame post with GPU/native/shader techniques only if ad-performance lift justifies the cost.

The E08 stress batch exposed a text-fit contract bug for unbreakable wide words. The width-safe fitting rule should be promoted into the shared scene/text runtime rather than remain an experiment-only transform.

A full Rust/C++ rewrite is not a current default direction. Native/GPU work should target measured heavy post-processing bottlenecks, not the scene DSL.

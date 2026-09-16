# Framewright Lab status

This branch is the persistent integration point for the Framewright research work.

## Branch policy

- `main` stays pinned to the clean upstream baseline until a separate product decision says otherwise.
- `lab/framewright-research` is the persistent lab branch for reusable benchmark tooling, the production-like Book Ad workload, renderer/encoder experiments, worker infrastructure and reproducibility work.
- One-off experiment branches may remain in Git history after their PR is closed. They are evidence, not merge queues.
- Keep at most one active experiment PR at a time.
- Product decisions and measured conclusions are also recorded in the Framewright Lab Notion page.

## Canonical chain preserved in this branch

The branch contains the useful E01-E08 research path:

1. E01 stage profiler.
2. E02 payload-driven Book Ad v0 workload.
3. E03 browser-side WebCodecs path.
4. E04 encoder quality / size / speed matrix.
5. E05 warm worker / concurrency economics.
6. E06 reproducible worker image and golden-frame checks.
7. E07 Node Canvas pinned-font parity.
8. E08 Node Canvas batch production probe with raster covers and strengthened text-layout QA.

The old stacked PRs for completed stages are archival and do not need to remain open.

## Parallel / archived experiments

- PR #7: R1 x264 replication control — archival.
- PR #8: T1 compressed intermediate image transport — archival; changing PNG to JPEG/WebP did not solve the transport problem.
- PR #9: T2 raw RGBA request-per-frame control — archival; exact visual parity but unusably slow HTTP-per-frame transport.
- PR #10: T3 persistent raw stream control — archival; browser streaming upload control was not viable in this setup.
- PR #11: style-class throughput matrix — experimental branch retained for results/reference.
- PR #12: real RIS TV pinned-worker profile — experimental branch retained for results/reference.
- PR #13: plate-aware Book Ad QA gate — experimental branch retained for follow-up.
- PR #14: Node Canvas renderer probe — archival. It showed ~2.6x end-to-end speedup and no temporary PNGs, but initially had a large visual parity gap dominated by text/font rendering.
- PR #15: pinned-font parity — completed. Pinning DejaVu Sans raised decoded parity from SSIM 0.961873 to 0.994484 and PSNR from 21.25 dB to 32.56 dB while keeping Node Canvas ~2.31x faster end-to-end. Full result: `LAB-E07-NODE-CANVAS-FONT-PARITY.md`.
- PR #17: Node Canvas batch production probe — completed. Canonical run `35091919070`: 10 x 12 s 1080x1920 videos in 56.084 s on 4 vCPU AMD EPYC 7763, 641.9 videos/hour sequential, p95 5.715 s/video, peak Node+FFmpeg RSS 711 MiB, zero final layout warnings, Chromium sanity parity SSIM 0.997234 / PSNR 38.89 dB. Full result: `LAB-E08-NODE-CANVAS-BATCH.md`.

## Current experiment

PR #18 / E09 (`lab/e09-cost-soak`) is the only active experiment. It turns the E08 browserless path into a reproducible production-worker candidate and starts cost validation:

- Node 20.20.2 base pinned by digest;
- `@napi-rs/canvas` pinned to 1.0.9;
- browserless worker image with FFmpeg + DejaVu only (no Chromium/Puppeteer dependency in the hot worker image);
- 100-video long-lived soak with memory-drift metrics;
- portable provider benchmark runner + measured-throughput cost calculator;
- dated provider-price envelope and target matrix (shared x86, dedicated x86, Spot and ARM candidate).

Current CI run for the canonical 100-video soak: `35092934500`. Provider price tables remain estimates until this exact pinned image is run on the actual priced VM.

## Current architectural direction

Preserve the JS/TS scene/template layer. For cheap/editorial book ads, `@napi-rs/canvas` is now the leading production-renderer candidate: it removes Chromium and temporary frame files from the hot path while preserving the current scene logic. Production determinism should come from one pinned renderer + pinned fonts/assets + golden-frame regression tests, not from requiring two different renderers to be pixel-identical.

The E08 stress batch also exposed and fixed a text-fit contract bug for unbreakable wide words. That width-safe fitting rule should be promoted into the shared scene/text runtime rather than remain an experiment-only transform.

A full Rust/C++ rewrite is not a current default direction. Native/GPU work should be reserved for measured bottlenecks such as expensive full-frame post-processing.

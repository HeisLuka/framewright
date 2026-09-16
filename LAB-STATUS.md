# Framewright Lab status

This branch is the persistent integration point for the Framewright research work.

## Branch policy

- `main` stays pinned to the clean upstream baseline until a separate product decision says otherwise.
- `lab/framewright-research` is the persistent lab branch for reusable benchmark tooling, the production-like Book Ad workload, WebCodecs experiments, worker infrastructure and reproducibility work.
- One-off experiment branches may remain in Git history after their PR is closed. They are evidence, not merge queues.
- Keep at most one active experiment PR at a time.
- Product decisions and measured conclusions are also recorded in the Framewright Lab Notion page.

## Canonical chain preserved in this branch

The branch starts from the accumulated `lab/e06-repro-worker` chain, which contains the useful E01-E06 research path:

1. E01 stage profiler.
2. E02 payload-driven Book Ad v0 workload.
3. E03 browser-side WebCodecs path.
4. E04 encoder quality / size / speed matrix.
5. E05 warm worker / concurrency economics.
6. E06 reproducible worker image and golden-frame checks.

The old stacked PRs for these stages are archival and do not need to remain open.

## Parallel / archived experiments

- PR #7: R1 x264 replication control — archival.
- PR #8: T1 compressed intermediate image transport — archival; changing PNG to JPEG/WebP did not solve the transport problem.
- PR #9: T2 raw RGBA request-per-frame control — archival; exact visual parity but unusably slow HTTP-per-frame transport.
- PR #10: T3 persistent raw stream control — archival; browser streaming upload control was not viable in this setup.
- PR #11: style-class throughput matrix — experimental branch retained for results/reference.
- PR #12: real RIS TV pinned-worker profile — experimental branch retained for results/reference.
- PR #13: plate-aware Book Ad QA gate — experimental branch retained for follow-up; not promoted into this branch yet.
- PR #14: Node Canvas renderer probe — archival. It showed ~2.6x end-to-end speedup and no temporary PNGs, but initially had a large visual parity gap dominated by text/font rendering.
- PR #15: pinned-font parity — completed. Pinning DejaVu Sans raised decoded parity from SSIM 0.961873 to 0.994484 and PSNR from 21.25 dB to 32.56 dB while keeping Node Canvas ~2.31x faster end-to-end. Full result: `LAB-E07-NODE-CANVAS-FONT-PARITY.md`.

## Current experiment

Next: batch production probe for Node Canvas with pinned fonts, raster cover assets and diverse BookAdPayload fixtures. The goal is to test mass-production behavior rather than further Chromium-vs-Node pixel matching.

## Current architectural direction

Preserve the JS/TS scene/template layer. For cheap/editorial book ads, `@napi-rs/canvas` is now a serious backend candidate because it removes Chromium and temporary frame files while preserving the current scene logic. Production determinism should come from one pinned renderer + pinned fonts/assets + golden-frame regression tests, not from requiring two different renderers to be pixel-identical.

A full Rust/C++ rewrite is not a current default direction. Native/GPU work should be reserved for measured bottlenecks such as expensive full-frame post-processing.

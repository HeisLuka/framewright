# Framewright Lab status

This branch is the persistent integration point for the Framewright research work.

## Branch policy

- `main` stays pinned to the clean upstream baseline until a separate product decision says otherwise.
- `lab/framewright-research` is the persistent lab branch for reusable benchmark tooling, the production-like Book Ad workload, renderer/encoder experiments, worker infrastructure and reproducibility work.
- One-off experiment branches may remain in Git history after their PR is closed. They are evidence, not merge queues.
- Keep at most one active experiment PR at a time.
- Product decisions and measured conclusions are also recorded in the Framewright Lab Notion page.

## Canonical chain

The useful canonical research path is now E01-E13:

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
11. E11 three production-oriented visual systems across ten stress books.
12. E12 cheap element-level motion grammar and pacing.
13. E13 deterministic creative router and ranked candidate generation.

The old stacked PRs for completed stages are archival and do not need to remain open.

## Key completed results

- E07: pinned DejaVu Sans raised Node Canvas vs Chromium parity to SSIM `0.994484` / PSNR `32.56 dB` while Node Canvas remained ~2.31x faster end-to-end. Result: `LAB-E07-NODE-CANVAS-FONT-PARITY.md`.
- E08: canonical 10-video browserless batch at `641.9 videos/hour` sequential; p95 `5.715 s`, peak Node+FFmpeg RSS `711 MiB`, Chromium sanity parity SSIM `0.997234`. Result: `LAB-E08-NODE-CANVAS-BATCH.md`.
- E09: pinned worker (`@napi-rs/canvas 1.0.9`, Node 20.20.2, FFmpeg, DejaVu; no Chromium/Puppeteer hot dependency) ran 100 videos at `651.74 videos/hour`, p50 `5.320 s`, p95 `7.004 s`, peak RSS `726.3 MiB`, and no practical monotonic memory-growth signal. Results: `LAB-E09-SOAK-RESULTS.md`, `LAB-E09-COST-SNAPSHOT.md`, `LAB-E09-PROVIDER-TARGETS.md`.
- Visual cost classes: medium/riso and heavy JS full-frame styles were ~3x slower than cheap editorial in the archived Chromium/WebCodecs matrix; real RIS TV spends ~95% of warm render time in `crt()` and is ~3.57 compute fps. Result: `LAB-VISUAL-COST-CLASSES.md`.
- E10: on a 4-CPU / 4 GiB constrained worker, c1=`642.50/h`, c2=`744.64/h`, c4=`771.15/h`. c4 is only `1.20x` c1 and has 30% parallel efficiency. Peak full process-tree RSS at c4 is `2626.8 MiB`. Result: `LAB-E10-CONCURRENCY-RESULTS.md`.
- E11: all 30 videos (3 systems x 10 books) passed layout QA. Swiss=`629.48/h`, Newspaper=`741.87/h`, Paper=`627.12/h`; the visual systems are materially different while remaining in the same cheap browserless cost class. Result: `LAB-E11-VISUAL-SYSTEMS-RESULTS.md`.
- E12: 60 interleaved baseline/active videos proved that cheap element-level motion barely changes render cost. Active throughput ratios were Swiss=`0.992x`, Newspaper=`0.977x`, Paper=`0.988x`; hold-window activity increased `12.03x`, `1.843x`, `2.975x` respectively, with zero layout warnings. Result: `LAB-E12-MOTION-GRAMMAR-RESULTS.md`.
- E13: 10 books x 3 ranked systems = 30 videos, zero layout warnings. Every primary route strictly outranked secondary; mean pairwise candidate-frame difference=`0.111669`, minimum per-book pairwise difference=`0.075348` against a `0.03` floor. Manual review confirms primary/secondary/exploration are real composition alternatives, not palette swaps. The router is an auditable initial prior, not a claim about CTR/CPA. Result: `LAB-E13-CREATIVE-ROUTER-RESULTS.md`.

## Current experiment

PR #22 / E13 (`lab/e13-creative-router`) is complete after canonical run `35113724843` and is ready to consolidate into `lab/framewright-research`.

Product conclusion from E13:

- deterministic metadata/rules are sufficient to create a useful candidate set without AI in the render path;
- route reasons stay inspectable and versionable;
- all three candidates per book remain visually distinct and pass layout QA;
- the ranking weights are only starting priors and must eventually be informed by real campaign outcomes;
- the useful next question is within-system creative variation, not more renderer or routing micro-tuning.

After E13 merge, E14 should build a deterministic variant factory for the routed primary system: structurally different ad sequences (for example hook-first, cover-first, title-first and pacing/emphasis variants) from the same BookPayload, with diversity, layout and cost gates.

## Current architectural direction

Preserve the JS/TS scene/template layer. For STANDARD book ads, `@napi-rs/canvas` is the leading production-renderer candidate: it removes Chromium and temporary frame files from the hot path while preserving the current scene logic. Production determinism should come from one pinned renderer + pinned fonts/assets + golden-frame regression tests.

Use separate visual cost tiers:

- STANDARD/FAST: browserless Node Canvas mass-production path;
- RICH: materialized-frame cost must be benchmarked; avoid assuming scene-function timing captures deferred raster work;
- HERO/CRT: optimize full-frame post with GPU/native/shader techniques only if ad-performance lift justifies the cost.

The product focus is now higher-level creative systems: visual grammar, motion grammar, pacing, category fit, QA, routing and variation. A full Rust/C++ rewrite is not a current default direction. Native/GPU work should target measured heavy post-processing bottlenecks, not the scene DSL.

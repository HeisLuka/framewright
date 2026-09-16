# Framewright Lab status

This branch is the persistent integration point for the Framewright research work.

## Branch policy

- `main` stays pinned to the clean upstream baseline until a separate product decision says otherwise.
- `lab/framewright-research` is the persistent lab branch for reusable benchmark tooling, the production-like Book Ad workload, renderer/encoder experiments, worker infrastructure and product experiments.
- One-off experiment branches may remain in Git history after their PR is closed. They are evidence, not merge queues.
- Keep at most one active experiment PR at a time.
- Product decisions and measured conclusions are also recorded in the Framewright Lab Notion page.

## Canonical chain

The useful canonical research path is now E01-E16:

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
14. E14 deterministic within-system structural variant factory.
15. E15 campaign-ready creative identity, provenance, dedupe and bounded selection.
16. E16 raster-only multi-format delivery probe.

## Key completed results

- E07: pinned DejaVu Sans raised Node Canvas vs Chromium parity to SSIM `0.994484` / PSNR `32.56 dB` while Node Canvas remained ~2.31x faster end-to-end. Result: `LAB-E07-NODE-CANVAS-FONT-PARITY.md`.
- E08: 10-video browserless batch at `641.9 videos/hour` sequential; p95 `5.715 s`, peak Node+FFmpeg RSS `711 MiB`, Chromium sanity parity SSIM `0.997234`. Result: `LAB-E08-NODE-CANVAS-BATCH.md`.
- E09: pinned browserless worker ran 100 videos at `651.74 videos/hour`, p95 `7.004 s`, peak RSS `726.3 MiB`, with no practical monotonic memory-growth signal. Result: `LAB-E09-SOAK-RESULTS.md`.
- E10: 4-vCPU c1=`642.50/h`, c2=`744.64/h`, c4=`771.15/h`; c4 is only `1.20x` c1 and peaks at `2626.8 MiB`. Result: `LAB-E10-CONCURRENCY-RESULTS.md`.
- Visual cost classes: real RIS TV is dominated by `crt()` (~95% of warm frame cost, ~3.57 compute fps). HERO/full-frame post is a separate optimization class, not a reason to rewrite the STANDARD scene DSL. Result: `LAB-VISUAL-COST-CLASSES.md`.
- E11: Swiss / Newspaper / Paper are materially different systems while remaining in the cheap browserless class; all 30 stress videos pass layout QA. Result: `LAB-E11-VISUAL-SYSTEMS-RESULTS.md`.
- E12: active element-level motion retains `0.977x–0.992x` baseline throughput while materially increasing hold-window activity, with zero layout regressions. Result: `LAB-E12-MOTION-GRAMMAR-RESULTS.md`.
- E13: 10 books x 3 ranked systems = 30 videos, zero layout warnings; mean pairwise system difference=`0.111669`, minimum=`0.075348` vs `0.03` floor. Router is an auditable prior, not a CTR/CPA predictor. Result: `LAB-E13-CREATIVE-ROUTER-RESULTS.md`.
- E14: 10 routed-primary books x 4 same-style/same-seed structural variants = 40 videos. v1 correctly failed diversity and was redesigned; canonical v2 passes with mean timeline diff=`0.057161`, minimum=`0.025185`, zero layout warnings. Result: `LAB-E14-VARIANT-FACTORY-RESULTS.md`.
- E15: 40 E14 candidates -> 30 selected campaign creatives (3/book) + 10 reserves; zero exact spec/output duplicates, deterministic repeated package build, stable `creative_id` / `render_id` / `output_sha256`. Result: `LAB-E15-CAMPAIGN-PACKAGE-RESULTS.md`.
- E16: post-raster aspect-ratio adaptation is not a production strategy. Square/contain is geometrically safe (100% retention, 56.25% utilization) but visually reads as a vertical ad inside a square. Square/cover retains only 56.25%. Landscape/contain uses only 31.64% of the frame; landscape/cover retains only 31.64% of the source. Result: `LAB-E16-MULTIFORMAT-DELIVERY-RESULTS.md`.

## Current experiment

PR #27 / E16 (`lab/e16-multiformat-delivery`) completed canonical run `35123196865` and is ready to merge into `lab/framewright-research`.

Product conclusion from E16:

- raster-only square/landscape conversion is not good enough for native-looking advertising creatives;
- square/contain can remain an emergency fallback, but should not be the product format;
- landscape absolutely requires aspect-ratio-aware semantic reflow;
- do not invest in smarter FFmpeg crops for STANDARD ads — safe areas, typography, cover placement and CTA composition must adapt before rasterization.

After E16 merge, E17 should implement responsive semantic layout profiles for `vertical`, `square` and `landscape` while preserving the same BookPayload, visual-system identity, motion grammar and structural-variant semantics.

## Current architectural direction

STANDARD book ads use the browserless JS/TS scene/template layer executed with pinned `@napi-rs/canvas`, pinned fonts/assets and FFmpeg encoding. Chromium remains useful for authoring/reference checks but is not the hot production renderer.

Identity should stay layered:

- `creative_id`: semantic creative identity (book, system, structure, seed, assets/template semantics);
- `delivery_profile`: vertical / square / landscape layout profile;
- `render_id`: creative + delivery profile + renderer/environment/encode profile;
- `output_sha256`: exact delivered bytes.

Use separate visual cost tiers:

- STANDARD/FAST: browserless Node Canvas mass-production path;
- RICH: benchmark materialized-frame cost before adding heavier treatments;
- HERO/CRT: optimize GPU/native/shader post only if measured campaign lift justifies it.

The product focus is now visual grammar, motion/pacing, routing, bounded variation, campaign identity/provenance and responsive delivery — not renderer micro-optimization or a full Rust/C++ rewrite.

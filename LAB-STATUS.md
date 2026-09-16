# Framewright Lab status

`main` stays the clean upstream baseline. `lab/framewright-research` is the persistent integration branch for confirmed lab work. Keep at most one active experiment PR; one-off branches are evidence, not merge queues.

## Canonical chain

E01-E17 are now the useful research path:

1. E01 stage profiler
2. E02 payload-driven Book Ad workload
3. E03 browser-side WebCodecs probe
4. E04 encoder matrix
5. E05 warm worker / concurrency economics
6. E06 reproducible worker image / golden checks
7. E07 Node Canvas pinned-font parity
8. E08 browserless batch + raster-cover/layout QA
9. E09 pinned worker + 100-video soak
10. E10 4-vCPU concurrency matrix
11. E11 Swiss / Newspaper / Paper visual systems
12. E12 cheap element-level motion grammar
13. E13 deterministic creative router
14. E14 deterministic structural variant factory
15. E15 campaign identity / provenance / dedupe / bounded selection
16. E16 raster-only multi-format delivery rejection
17. E17 responsive semantic layout profiles

## Product results that matter

- STANDARD renderer: pinned browserless `@napi-rs/canvas` + pinned fonts/assets + FFmpeg. Chromium is no longer the hot production renderer.
- E09: 100-video soak at `651.74/h`, p95 `7.004 s`, peak RSS `726.3 MiB`, no practical monotonic memory-growth signal.
- E10: c1=`642.50/h`, c2=`744.64/h`, c4=`771.15/h`; four concurrent jobs only give `1.20x`, so one job already saturates much of the 4-vCPU budget.
- E11: Swiss / Newspaper / Paper are materially distinct while staying in the cheap browserless class.
- E12: useful active motion costs only ~1–3% render throughput; it mainly increases bitrate, not CPU.
- E13: deterministic routing creates three genuinely different system candidates per book; routing score is an auditable prior, not a CTR/CPA predictor.
- E14: same-style/same-seed structural remixing creates useful hook-first / cover-first / title-first / hook-title variants; a fake v1 variant was rejected by the diversity gate rather than lowering the gate.
- E15: 40 candidates -> 30 selected campaign creatives (3/book) + 10 reserves, stable `creative_id` / `render_id` / `output_sha256`, zero exact duplicates, deterministic package rebuild.
- E16: post-raster `contain` / `cover` is not a production multi-format solution. Square contain is merely a safe fallback; landscape fails badly either by dead space or destructive crop.
- E17: semantic reflow passes across Paper / Swiss / Newspaper and `vertical` / `square` / `landscape`: `9/9` complete videos, zero layout warnings, correct dimensions, same style/seed across profiles. The long-title Newspaper fixture remains readable. Result: `LAB-E17-RESPONSIVE-LAYOUT-RESULTS.md`.

E17 per-profile rates on canonical run `35123954004`:

| profile | resolution | mean/video | sequential rate | mean MP4 |
|---|---:|---:|---:|---:|
| vertical | 1080x1920 | 5.666 s | 635.32/h | 501.2 KiB |
| square | 1080x1080 | 3.420 s | 1052.72/h | 346.9 KiB |
| landscape | 1920x1080 | 4.926 s | 730.75/h | 454.5 KiB |

## Current experiment

PR #28 / E17 (`lab/e17-responsive-layout`) completed canonical run `35123954004` and is ready to merge into `lab/framewright-research`.

The E17 decision is architectural: aspect ratio is a semantic delivery profile, not a crop mode. Keep `creative_id` stable for the semantic creative; include `delivery_profile` in render provenance so profile-specific renders have distinct `render_id` / exact output identity.

After E17, the next product layer is campaign delivery expansion: take the bounded E15 selected set and emit only the requested delivery profiles with parent creative identity, per-profile render IDs, hashes and QA evidence. Do not multiply every reserve candidate by every format by default.

## Architectural direction

STANDARD: JS/TS scene/template semantics -> pinned Node Canvas -> raw RGBA -> FFmpeg. Keep shared BookPayload, route, structural variant, motion grammar and seed across delivery profiles; let visual systems provide profile-aware layout rules.

RICH/HERO remains a separate cost class. Native/GPU work should target measured full-frame post bottlenecks (e.g. CRT) only if campaign lift justifies it. A full Rust/C++ rewrite of the scene DSL is not the default direction.

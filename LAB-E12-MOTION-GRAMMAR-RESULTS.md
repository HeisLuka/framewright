# E12 — cheap motion grammar + pacing

Canonical GitHub Actions run: `35110611620`.

## Product question

Can the three E11 visual systems become meaningfully more alive during hold periods without returning to expensive full-frame pixel effects or materially reducing throughput?

E12 compares `baseline` and `active` motion modes for Swiss, Newspaper and Paper across the same ten stress-book fixtures: 60 full videos at 1080x1920, 30 fps, 12 seconds / 360 frames, rendered by the pinned browserless `@napi-rs/canvas -> raw RGBA -> libx264 veryfast/CRF22` worker.

The active mode only adds element-level motion: cover drift, staged reveals, moving rules/rails, ticker motion and collage micro-wobble. No full-frame JavaScript pixel loop is used.

## Canonical performance

Runner: 4 logical CPUs, Intel Xeon Platinum 8573C, Node 20.20.2.

| system | baseline videos/hour | active videos/hour | throughput ratio | baseline p95 | active p95 | MP4 size ratio | render-cost ratio | layout warnings |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Swiss | 683.79 | 678.14 | 0.992x | 5.595 s | 5.526 s | 1.103x | 1.009x | 0 |
| Newspaper | 761.89 | 744.68 | 0.977x | 4.772 s | 5.070 s | 1.246x | 1.028x | 0 |
| Paper | 661.84 | 654.18 | 0.988x | 5.662 s | 5.840 s | 1.310x | 1.012x | 0 |

All 60 videos completed and the strengthened text/layout gate remained clean.

The motion layer therefore costs almost nothing in compute terms: active throughput stays within 2.3% of baseline in every system and render cost rises by only ~1-3%.

The main cost is compression entropy rather than rendering: mean MP4 size increases by ~10% for Swiss, ~25% for Newspaper and ~31% for Paper. These remain small files and stay inside the E12 guardrail.

## Hold-window motion activity

Low-resolution frame-difference activity was measured only inside hold windows, excluding major plate transitions, on three stress books.

| system | baseline mean | active mean | active / baseline |
|---|---:|---:|---:|
| Swiss | 0.000033 | 0.000397 | 12.03x |
| Newspaper | 0.000159 | 0.000293 | 1.843x |
| Paper | 0.000122 | 0.000363 | 2.975x |

The exact metric is not a perceptual quality score; its purpose is to verify that the active variants actually continue changing during the previously static parts of each plate. All three systems clear that test by a wide margin.

## Manual review

The 2 fps compare sheets use the same English stress fixture, with baseline on top and active on bottom.

- **Swiss:** the active rail, staged text and cover movement add continuous rhythm without disturbing the hard-grid hierarchy.
- **Newspaper:** moving masthead/rule/ticker details make the editorial frame feel active while keeping the layout readable and restrained.
- **Paper:** collage micro-wobble and moving print accents give the strongest physical-motion character; it also causes the largest bitrate increase, which is expected from moving textured geometry.

The result is still deliberately restrained rather than hyperactive. The important change is that the systems no longer depend only on entrance animation followed by a long frozen poster hold.

## Guardrail verdict

E12 required active motion to retain at least 80% of baseline throughput, stay above 450 videos/hour, keep MP4 growth below 60%, increase hold-window activity by more than 5%, and preserve layout QA.

All three systems pass every guardrail.

## Decision

E12 passes the product hypothesis.

1. Motion density can be improved materially with element-level transforms and reveals at effectively negligible render cost.
2. For STANDARD book ads, motion grammar should be treated as part of the visual system rather than as a heavyweight post-processing layer.
3. The main technical trade-off is bitrate/file size, not CPU.
4. The next product question is no longer renderer performance or whether motion is affordable. It is **creative selection**: which visual system + motion grammar fits which kind of book, hook and campaign objective.

Next experiment should therefore move from renderer benchmarks to a deterministic creative-routing problem: define book/category signals and generate multiple candidate systems per book, then evaluate useful diversity, text/cover fit and variant count without AI in the render path.

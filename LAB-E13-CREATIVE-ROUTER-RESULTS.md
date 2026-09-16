# E13 — deterministic creative router results

Canonical GitHub Actions run: `35113724843`.

## Product question

Can ordinary deterministic catalog metadata produce a useful, auditable set of visually distinct ad candidates per book without AI in the render path?

E13 routes each canonical book across the three E11/E12 visual systems using explicit metadata and rules: `genre`, `tone`, `pace`, `objective`, title length and hook length. The router emits a ranked list plus human-readable scoring reasons. Each book then renders three candidates (`primary`, `secondary`, `exploration`) with E12 active motion.

This experiment tests candidate generation and routing mechanics. It does **not** claim that the highest rule score predicts CTR, CPA, conversion or any other campaign outcome. Those weights must eventually be revised from real campaign data.

## Canonical workload

- 10 canonical stress books.
- 3 ranked systems per book = 30 videos.
- 1080x1920, 30 fps, 12 seconds / 360 frames.
- browserless `@napi-rs/canvas -> raw RGBA -> libx264 veryfast/CRF22` path.
- pinned DejaVu Sans and E12 active-motion grammar.

Runner for this run: 4 logical CPUs, AMD EPYC 9V74, Node 20.20.2.

## Routing outcome

Primary-route distribution:

- Newspaper: 5 books (`night-archive`, `salt`, `winter-map`, `long-title`, `quotes`).
- Swiss: 3 books (`city-seven`, `observatory`, `zero-hour`).
- Paper: 2 books (`river-station`, `letters`).

All ten primary routes strictly outrank the second-ranked candidate. The smallest primary margin is 1 point (`winter-map` and `quotes`), so those are useful examples where campaign data should be allowed to overturn the initial prior quickly.

`river-station` has a tie between the second and third scores (`swiss=2`, `newspaper=2`). This does not violate the E13 primary-route guardrail, but it is a reminder that lower-rank ordering should be treated as exploration ordering rather than a strong preference.

Representative routing logic behaved as intended in manual review:

- dystopia / technical / fast / suspense -> Swiss primary;
- literary / reflective / long-title -> Newspaper primary;
- family-drama / emotional / intimate -> Paper primary;
- atmospheric mystery -> Paper primary with Swiss/Newspaper alternatives.

## Visual diversity

E13 samples hook / book / CTA frames at 90x160 and measures normalized pairwise frame difference between the three candidates for every book.

- mean pairwise difference across books: `0.111669`;
- minimum per-book pairwise difference: `0.075348`;
- guardrail floor: `0.03`;
- every book passes the floor by more than 2x.

The closest recurring pair is usually Paper vs Swiss, but manual inspection of `river-station`, `city-seven` and `long-title` confirms that the candidates still read as different composition languages, not palette swaps.

## Render / QA result

- videos rendered: `30 / 30`;
- layout warning groups: `0`;
- batch wall time: `133.082 s`;
- sequential throughput: `811.53 videos/hour`;
- p50 per video: `4.386 s`;
- p95 per video: `4.843 s`;
- max per video: `6.684 s`;
- peak Node + FFmpeg RSS: `738.4 MiB`.

Do not interpret `811.53/h` as a router optimization versus earlier E11/E12 runs: this run landed on an AMD EPYC 9V74 runner rather than the earlier EPYC 7763. E13 is a product-routing experiment, not a cross-run performance comparison.

## Decision

E13 passes its product hypothesis:

1. a no-AI deterministic router can produce an auditable primary/secondary/exploration candidate set;
2. all routed candidates survive the existing production-shaped layout QA;
3. candidate sets remain materially visually distinct;
4. routing reasons are inspectable and versionable rather than hidden in a model;
5. rule scores should be treated as initial priors, not as evidence of ad effectiveness.

The next useful experiment is not to add more routing weights. It is to increase **within-system creative variation**: for the routed primary system, generate structurally different ads from the same book data (for example hook-first, cover-first, title-first and different pacing/plate emphasis) and measure whether those variants are genuinely distinct while preserving readability and cheap rendering.

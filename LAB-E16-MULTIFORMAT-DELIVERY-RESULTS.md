# E16 — multi-format delivery results

Canonical GitHub Actions run: `35123196865` (run #2; run #1 failed only because E16 initially used `npm ci` instead of the already-established pinned `@napi-rs/canvas@1.0.9` install used by E14/E15).

## Product question

Can a finished 9:16 creative be delivered as useful 1:1 and 16:9 output by cheap post-raster scaling/cropping, or must aspect-ratio adaptation happen in the semantic scene/layout layer?

E16 rendered three representative routed-primary E14 `hook-first` creatives with active motion:

- Paper / `river-station`;
- Swiss / `city-seven`;
- Newspaper / `long-title`.

Source render sanity: `3/3`, zero layout warnings, `636.05 videos/hour` sequential, p95 `5.665 s`, peak Node+FFmpeg RSS `674.1 MiB` on this runner. Performance is not the E16 decision metric.

Each source was then adapted to square `1080x1080` and landscape `1920x1080` using two deliberately simple baselines:

- `contain`: preserve the whole vertical frame, pad the rest;
- `cover`: fill the destination frame, crop the source.

## Geometric result

| format | strategy | source retained | destination area used | minimum gate |
|---|---|---:|---:|---|
| 1:1 | contain | 100% | 56.25% | pass |
| 1:1 | cover | 56.25% | 100% | fail retention |
| 16:9 | contain | 100% | 31.64% | fail utilization |
| 16:9 | cover | 31.64% | 100% | fail retention |

The automated baseline gate was intentionally weak: source retention >=80% and destination-area utilization >=55%. Under that purely geometric rule, only square/contain passes.

## Manual visual review

The review sheets make the product limitation clearer than the numeric gate:

- square/contain is technically safe but visibly reads as a vertical ad placed inside a square canvas; almost half of the square is dead padding, so it is not a strong native square creative;
- square/cover fills the canvas but removes too much vertical composition and risks cutting hierarchy/CTA content;
- landscape/contain becomes a tiny vertical island using only ~31.6% of the 16:9 frame;
- landscape/cover is destructive: titles, labels, cover framing and conversion elements are visibly cropped because ~68.4% of the vertical source is discarded.

This holds across Paper, Swiss and Newspaper, including the long-title stress fixture.

## Decision

E16 rejects post-raster adaptation as the production multi-format strategy.

1. `1:1 contain` is a safe emergency fallback, not a native-looking product output.
2. `1:1 cover` is not safe enough for arbitrary book creatives.
3. Neither raster-only 16:9 strategy is remotely acceptable.
4. Useful multi-format delivery must happen before rasterization, where the scene still knows about semantic regions: safe areas, title/hook blocks, cover, author, brand and CTA.
5. Do not spend time inventing smarter FFmpeg crops for STANDARD ads; this is a layout problem, not a codec problem.

## Next experiment

E17 should add aspect-ratio-aware semantic layout profiles for `9:16`, `1:1` and `16:9` while keeping the same BookPayload, visual-system identity, motion grammar and structural variant semantics.

The desired identity model is:

- the same semantic creative / `creative_id` may have multiple delivery profiles;
- `delivery_profile` (`vertical`, `square`, `landscape`) becomes part of render provenance / `render_id` and exact output identity;
- each profile gets its own safe-area/layout gate and visual review.

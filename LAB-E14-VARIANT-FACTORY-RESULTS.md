# E14 — deterministic structural variant factory

Canonical GitHub Actions run: `35117790919` on head `f2f8da61edb88940794a230810ebaee41a1b37d7`.

## Product question

Can one BookPayload yield several structurally different advertising videos inside the same routed visual system, without AI generation, extra random noise or expensive full-frame effects?

E14 takes the E13 primary visual system for each of the ten canonical books and renders four deterministic dramaturgical variants. All four variants for a book keep the same payload, visual system, raster cover and RNG seed, so measured diversity must come from scene order / emphasis rather than randomization.

Final variant set:

- `hook-first`: hook -> product detail -> CTA;
- `cover-first`: product detail -> hook -> CTA;
- `title-first`: title/cover statement -> hook -> CTA;
- `hook-title`: hook -> title/cover statement -> CTA.

All variants retain the E12 cheap active-motion grammar.

## Useful failed v1

The first E14 run (`35116905729`) rendered all 40 videos and passed layout/render checks, but correctly failed the diversity guardrail:

- mean within-system pairwise timeline difference: `0.056290`;
- minimum per-book pairwise difference: `0.012879`;
- required floor: `0.020`.

The weak pair was usually `hook-first` vs the original `title-first`. The first version of `title-first` only changed the first three seconds (`title -> book -> CTA`), then converged onto the same `book -> CTA` path as `hook-first`. For example, on `night-archive`, the sampled differences for that pair were approximately `[0.074, 0.000, 0.000, 0.000, 0]`.

We did **not** lower the diversity threshold. The variant itself was changed so `title-first` became `title -> hook -> CTA`, making the dramaturgy different through the middle of the ad rather than only at the opening.

## Canonical v2 result

Workload:

- 10 E13 routed-primary books;
- 4 structural variants per book = `40` videos;
- 1080x1920, 30 fps, 12 seconds / 360 frames;
- one visual system and one seed shared by all four variants of a book;
- browserless `@napi-rs/canvas -> raw RGBA -> libx264 veryfast/CRF22` worker;
- pinned DejaVu Sans;
- E12 active motion.

Canonical hosted runner:

- 4 logical CPUs;
- AMD EPYC 9V74;
- Node 20.20.2;
- ~16 GiB RAM.

Render / QA:

- videos: `40 / 40`;
- layout warning groups: `0`;
- batch wall time: `209.733 s`;
- sequential throughput: `686.59 videos/hour`;
- mean per video: `5.223 s`;
- p50: `5.384 s`;
- p95: `5.718 s`;
- max: `5.747 s`;
- peak Node + FFmpeg RSS: `722.8 MiB`.

Do not compare `686.59/h` directly with the intermediate v2 run (`828.42/h`) or older E11/E12 runs: GitHub assigned different hosted CPU models. The E14 acceptance gate is a broad `>450/h`; this experiment is about creative structure, not cross-run CPU benchmarking.

## Within-system diversity

Frames are sampled at `1.2, 3.2, 5.2, 7.6, 10.2` seconds, downscaled to 90x160 grayscale, and compared pairwise between the four variants of each book.

Final result:

- mean pairwise difference across books: `0.057161`;
- minimum per-book pairwise difference: `0.025185`;
- mean guardrail: `>=0.040`;
- minimum guardrail: `>=0.020`;
- both pass without relaxing the thresholds.

Per-book minimums:

| book | routed system | min pairwise diff |
|---|---|---:|
| night-archive | Newspaper | 0.040000 |
| salt | Newspaper | 0.040624 |
| winter-map | Newspaper | 0.040445 |
| river-station | Paper | 0.027360 |
| city-seven | Swiss | 0.026590 |
| letters | Paper | 0.026997 |
| observatory | Swiss | 0.027647 |
| long-title | Newspaper | 0.043040 |
| quotes | Newspaper | 0.042597 |
| zero-hour | Swiss | 0.025185 |

The closest recurring pair is `cover-first` vs `title-first`, especially in Swiss/Paper. That is expected: after their different opening treatment, both eventually contain the same hook and CTA material. They still clear the preset floor.

At the `10.2 s` sample, most pairs are nearly identical. This is intentional: all structural variants converge onto the same conversion-oriented CTA plate. Diversity is concentrated in the first ~8 seconds, while the final product/CTA contract stays stable.

## Manual review

Manual 0.5-fps compare sheets were inspected for:

- `river-station` / Paper;
- `city-seven` / Swiss;
- `long-title` / Newspaper.

All four rows read as different sequence structures rather than palette changes. The custom title/cover scene remains legible, the long-title stress fixture fits correctly, and the v2 `title-first -> hook -> CTA` change is visibly distinct from `hook-first` through the middle of the timeline.

## Decision

E14 passes its product hypothesis:

1. structural remixing alone is enough to produce several materially different creatives inside one visual system;
2. this variation does not require changing the book assets, visual style, RNG seed or adding expensive effects;
3. the existing layout QA remains clean across all 40 videos;
4. the first failed version demonstrated that diversity gates catch fake variants that only alter the opening before converging onto the same timeline;
5. keeping a common CTA ending is compatible with meaningful upstream diversity;
6. campaign performance is still unknown — no structural variant is declared a CTR/CPA winner without real delivery data.

The next useful product layer is a **campaign-ready creative package**: stable creative IDs, provenance, routing reasons, variant semantics, payload/template hashes and duplicate fingerprints. The factory should emit a small selected set with traceable identity, not an uncontrolled Cartesian explosion of every possible combination.

# E11 — three book-ad visual systems

Canonical GitHub Actions run: `35107793565`.

## Product question

Can one deterministic, no-AI BookPayload pipeline produce materially different advertising looks without returning to expensive browser/full-frame effects?

E11 renders the same ten stress-book fixtures through three separate composition/motion systems at 1080x1920, 30 fps, 12 seconds / 360 frames, using the pinned browserless `@napi-rs/canvas -> raw RGBA -> libx264 veryfast/CRF22` worker.

The systems are intentionally different grammars, not palette skins:

- `swiss`: hard grid, asymmetric large type, accent bars, clean product/CTA staging;
- `newspaper`: masthead, rules, editorial clipping, excerpt hierarchy and black story card;
- `paper`: collage/tape, rotated cover, offset color shadow, sparse print dots and hand-cut geometry.

None uses a full-frame JavaScript pixel loop.

## Canonical performance

Runner: 4 logical CPUs, AMD EPYC 7763, Node 20.20.2.

| system | videos/hour sequential | vs Swiss | p50 | p95 | mean MP4 | mean render/frame | mean write wait/frame | layout warnings |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Swiss | 629.48 | 1.000x | 5.525 s | 5.885 s | 426.6 KiB | 13.434 ms | 2.252 ms | 0 |
| Newspaper | 741.87 | 1.179x | 4.703 s | 4.810 s | 338.4 KiB | 10.656 ms | 2.617 ms | 0 |
| Paper | 627.12 | 0.996x | 5.312 s | 6.155 s | 397.6 KiB | 13.530 ms | 2.217 ms | 0 |

All 30 videos completed and all ten book fixtures passed the strengthened text-width/layout gate in all three systems.

## Manual visual review

Review sheets use three deliberately different fixtures (Cyrillic, English long-word/title, and extreme long-title) and show hook / book / CTA plates. A second 1-fps motion strip was inspected for the English fixture.

### Swiss

The system reads as a clean, high-contrast modern book ad. Typography and cover remain legible across stress fixtures. It is a useful general-purpose baseline and clearly stronger than a generic slide template because the hierarchy is intentionally poster-like.

### Newspaper

This is materially different from Swiss, not a reskin. Masthead/rules, excerpt structure, cover caption and the black story card create an editorial/literary identity. It is also the cheapest system in this run: ~18% more sequential throughput than Swiss and ~21% smaller mean MP4.

### Paper

The collage treatment is also materially distinct: rotated cover, offset accent shadow, tape, sparse print dots and slightly imperfect geometry create a physical-print feel without per-pixel post-processing. Its compute cost is effectively the same as Swiss.

## Important finding: motion is now the creative bottleneck

The 1-fps motion strips show a common weakness: each system has a useful entrance animation, then spends much of the plate in a long visual hold. They read as good kinetic posters, but not yet as maximally engaging short-form video creative.

This is not a renderer-performance problem. The next quality experiment should add cheap element-level motion grammar (slow cover drift/zoom, rule/ticker sweeps, collage wobble, staged text reveals, rhythmic cuts) while explicitly avoiding full-frame JS pixel work.

## Decision

E11 passes the product hypothesis:

1. multiple genuinely different book-ad visual systems can share one BookPayload contract;
2. strong visual differentiation does not require AI at render time;
3. it also does not require expensive CRT/pixel effects;
4. visual-system choice has small compute impact at this complexity level;
5. renderer optimization is no longer the primary product work for STANDARD ads.

Keep all three systems as useful research/product seeds. The next iteration should focus on motion density and creative pacing, then on pairing visual systems to book/category rather than squeezing more CPU throughput from the renderer.

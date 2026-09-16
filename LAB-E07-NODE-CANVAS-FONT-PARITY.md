# E07 — Node Canvas font parity

Canonical CI run: `35089436902` (PR #15).

Workload: Book Ad v0, 1080x1920, 30 fps, 360 frames / 12 s, seed 7, identical payload and `libx264 veryfast / CRF 22` output settings.

## Question

E06 showed `@napi-rs/canvas` was ~2.6x faster end-to-end than the Chromium PNG pipeline, but decoded parity was only SSIM `0.961873` / PSNR `21.253871 dB`. Visual diffs suggested font fallback and text metrics were the dominant cause.

E07 isolates that variable: all template text is forced to `DejaVu Sans`; Chromium uses the system DejaVu font and Node Canvas explicitly registers the same regular and bold files.

## Result

| metric | E06 unpinned | E07 pinned font |
|---|---:|---:|
| Node Canvas end-to-end | 5.177 s | 6.312 s |
| Chromium reference | 13.543 s | 14.605 s |
| Node Canvas speedup | 2.616x | 2.314x |
| SSIM | 0.961873 | 0.994484 |
| PSNR | 21.2539 dB | 32.5603 dB |
| temp PNGs on Node path | 0 | 0 |

Node Canvas E07 throughput: `57.036 fps` including raw streaming into x264. Mean scene render time was `13.813 ms/frame`; mean encoder backpressure wait was `3.473 ms/frame`.

## Visual interpretation

Pinned fonts removed the large layout and line-wrap differences seen in E06. Representative-frame diffs now show:

1. text placement and wrapping are essentially aligned;
2. remaining text differences are mostly glyph edge rasterization / antialiasing differences between renderers;
3. the largest localized residual difference in the book plate is text inside the demo SVG cover, because that SVG itself contains live text rendered independently by each backend;
4. background geometry and deterministic decorations are already very close.

The demo SVG cover is not representative of the intended production asset contract. Real book covers should be versioned raster assets (or pre-rasterized once), so backend-specific SVG text rendering should not be part of the hot production path.

## Decision

- Font fallback is confirmed as the primary E06 parity problem.
- Pin fonts as part of the renderer manifest. Do not use platform-dependent fallback stacks for production templates.
- `@napi-rs/canvas` remains a serious production candidate for cheap/editorial book-ad templates: it keeps the existing JS scene logic, removes Chromium from the hot rendering path, removes temporary PNGs, and is still >2x faster end-to-end in this test.
- Do not chase SSIM 1.0 between Chromium and Node Canvas as a product goal. The target is stable production output from one pinned backend plus golden-frame regression tests.
- Next test: multiple payloads with raster cover assets, pinned fonts, layout/QA checks and batch throughput. That answers the product question better than further single-frame Chromium parity work.

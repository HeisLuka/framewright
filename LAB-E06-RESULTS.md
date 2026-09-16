# E06 results — Node Canvas backend probe

Canonical CI run: `35089012343`

Draft PR: #14 — `lab/e06-node-canvas`

Workload: `examples/book-ad-v0`, 1080×1920, 30 fps, 360 frames, 12 s, seed 7. Both outputs use `libx264`, preset `veryfast`, CRF 22.

## What was tested

This is not a manual rewrite of the book-ad scene. The runner extracts and executes the same inline JavaScript template in a Node `vm` context, while replacing browser Canvas primitives with `@napi-rs/canvas`.

The Node path is:

```text
same JS template / plates
→ @napi-rs/canvas in Node
→ RGBA in the same process
→ FFmpeg rawvideo stdin
→ H.264 MP4
```

It removes Chromium from the production render path, removes PNG/dataURL/base64, and removes temporary frame files.

## Performance

| path | total | temp frames | output |
|---|---:|---:|---:|
| Chromium Canvas → PNG → disk → x264 | 13.543 s | 48.71 MiB | 447.9 KiB |
| Node `@napi-rs/canvas` → raw stdin → x264 | 5.177 s | 0 | 510.2 KiB |

End-to-end speedup: **2.616×**.

Node path throughput including concurrent x264 encoding: **69.545 fps**.

Node per-frame measurements:

- render + pixel readback mean: `11.367 ms`, p50 `11.399 ms`, p95 `15.685 ms`;
- FFmpeg stdin/backpressure wait mean: `2.777 ms`, p50 `1.753 ms`, p95 `6.430 ms`.

This is the strongest evidence so far that keeping the JS/TS template layer while replacing the browser raster backend can materially reduce production cost.

## Quality / parity

Decoded output is **not** yet visually equivalent to Chromium:

- SSIM: `0.961873`;
- PSNR: `21.253871 dB`;
- luma SSIM: `0.945483`.

Representative amplified frame diffs show that the dominant discrepancy is text rasterization and text metrics: the same strings occupy visibly different glyph shapes/positions. The geometry and background decorations are much closer. The book scene also shows text differences inside the SVG cover.

The current template uses `Arial, "DejaVu Sans", sans-serif`, which means the actual font can differ by backend. That is incompatible with a reproducible renderer contract.

## Decision

1. **Do not promote Node Canvas to production yet**: 2.6× speedup is attractive, but SSIM 0.962 / PSNR 21.25 is too large a parity gap to ignore.
2. The experiment does **not** justify rewriting scene logic. The same JavaScript template executed successfully in Node.
3. The next experiment should pin/register one exact font in both Chromium and Node Canvas, then repeat the same comparison.
4. Separate renderer parity tests into geometry-only, text-only, cover-only and full-scene fixtures so font shaping, SVG rasterization, antialiasing and transforms can be measured independently.
5. If font pinning closes most of the gap, move toward a backend-neutral Canvas template contract; if it does not, investigate SVG/image rasterization and Canvas compositing next.

# Visual cost classes — recovered E07/E08 style evidence

This consolidates the archived style-class and real RIS TV profiling branches into one product-facing conclusion. It is not a replacement for the Node Canvas E08/E09 production benchmark; the style experiments used the pinned Chromium/WebCodecs lab path so their strongest value is **relative style cost** and bottleneck location.

## Same-workload style matrix

Archived PR #11, canonical run `35087749686`.

Host: 4 logical CPUs, AMD EPYC 7763, ~15.6 GiB RAM. Workload: Book Ad v0, 1080x1920, 12 s / 360 frames, warm Chromium, concurrency 2, H.264 WebCodecs at 1.2 Mbps for throughput.

| class | implementation | warm c2 videos/hour | p50 | p95 | peak RSS | key bottleneck |
|---|---|---:|---:|---:|---:|---|
| cheap | base editorial layout | 1638.6 | 4.46 s | 4.64 s | 1.32 GiB | normal render + VideoFrame/encode |
| medium | cached 128x128 paper texture + multiply pattern + sparse horizontal ink lines | 526.4 | 13.53 s | 14.00 s | 1.28 GiB | deferred canvas raster/snapshot at `VideoFrame` creation |
| heavy | full-frame `getImageData` JS loop for vignette/scanline/noise/RGB bias | 502.9 | 14.27 s | 14.40 s | 5.08 GiB | eager full-frame JS pixel post |

Relative to the same cheap path, medium is about **3.11x slower by throughput** and heavy about **3.26x slower**. Heavy also uses roughly **3.8x the peak RSS** of cheap.

### Why medium looks deceptively cheap in the scene timer

The medium style reports only ~0.88 s of explicit scene/style render work per video, but ~12.18 s is recorded in `VideoFrame` creation/snapshot work. Canvas compositing can therefore defer rasterization until the frame is materialized for the encoder. A profiler that only times the JavaScript style function can substantially understate real style cost.

Heavy is the opposite: ~12.74 s/video is spent directly in the measured full-frame JS pixel loop, while `VideoFrame` creation is relatively cheap (~0.75 s/video).

## Compression penalty of noisy styles

Quality probes against PNG reference frames:

| class | 1.2 Mbps SSIM | 1.8 Mbps SSIM | 1.2 Mbps PSNR | 1.8 Mbps PSNR | 1.2M output | 1.8M output |
|---|---:|---:|---:|---:|---:|---:|
| cheap | 0.997518 | 0.998368 | 46.82 dB | 49.82 dB | 0.98 MiB | 1.29 MiB |
| medium | 0.975625 | 0.973335 | 43.62 dB | 44.09 dB | 1.68 MiB | 2.40 MiB |
| heavy | 0.696045 | 0.705512 | 28.07 dB | 28.20 dB | 2.45 MiB | 3.03 MiB |

The exact SSIM behavior is not perfectly monotonic for medium and should not be overinterpreted, but the heavy class is unambiguous: high-frequency per-pixel noise is expensive to encode and remains far from the lossless rendered reference even after increasing bitrate from 1.2 to 1.8 Mbps. A HERO style should not add unconstrained random high-frequency noise merely because it is visually available.

## Real RIS TV CRT profile

Archived PR #12, canonical run `35087532224`.

Host: 4 logical CPUs, Intel Xeon Platinum 8573C, ~15.6 GiB RAM. Output width 1920, 1200 frames / 40 s. The profiler warmed the resolution-dependent CRT map and sampled five deterministic frames per plate.

Warm representative frame:

- total scene + CRT render mean: **279.9 ms/frame**;
- p95: **312.0 ms/frame**;
- scene mean: **14.6 ms/frame**;
- CRT mean: **265.3 ms/frame**.

Weighted full-video compute estimate:

- **336.3 s** for the 40-second / 1200-frame video;
- **3.57 compute fps**;
- about **10.7 such 40-second videos/hour** on that sampled CPU if run serially;
- estimate explicitly excludes PNG transport/encode.

The real upstream CRT therefore spends roughly **95% of measured warm render time inside `crt()`**. Its ~280 ms/frame scene+post cost is about **7.9x heavier per frame** than the synthetic E07 heavy post (~35.4 ms/frame) even before transport/encode differences.

## Product tiers

### FAST / STANDARD

Use browserless Node Canvas, pinned fonts and raster assets. Prefer geometry, typography, simple transforms, cached small textures and effects that do not require a full-frame CPU pixel pass. This is the mass-production default.

### RICH

Allow moderate paper/riso/compositing effects, but benchmark the **materialized frame path**, not only the JS function. Deferred Canvas rasterization can make a seemingly cheap effect 3x slower in real encoding throughput.

### HERO

Reserve CRT/complex full-frame post for a minority of creatives. The current CPU implementation is orders of magnitude less suitable for mass generation. If this aesthetic materially improves ad performance, implement it as GPU shader/native/FFmpeg-style post or precomputed reusable layers rather than a JavaScript per-pixel loop.

## Decision

Do not build one universal renderer cost target. Treat visual systems as separate product/compute tiers.

For the core book-ad factory, optimize STANDARD until compute is operationally negligible. For HERO styles, optimize only after an ad-performance test shows they are worth their additional compute/bitrate complexity. The measured bottleneck is the post-processing backend, not the JS/TS scene DSL, so a full-language rewrite remains the wrong first move.

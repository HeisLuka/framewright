# E08 results — real RIS TV in the pinned worker

Canonical successful CI run: `35087158874`

Commit under test: `f1c9d8c63afca000e71fc1de0260303d8f4d1f1e`

Environment: the pinned E06 worker image. Workload: the actual upstream `examples/ris-tv/index.html`, 1920×1080, 30 fps, 1200 frames / 40 s, seed 7. 1920×1080 has the same pixel count as the 1080×1920 Book Ad workload.

The profiler renders one cold frame to initialize resolution-dependent CRT caches, then five deterministic sample frames from every plate. It instruments scene work, the real `crt()` pass and PNG encoding separately. Production compute estimates below deliberately exclude PNG encode/transport because the production direction is WebCodecs.

## Cold frame

- Browser frame total: `414.8 ms`
- Scene work: `3.1 ms`
- `crt()`: `280.7 ms`
- PNG encode: `131.0 ms`

The first frame includes `crtMap(1920,1080,...)` allocation/build. The map is cached afterwards.

## Warm representative profile

40 sampled frames across all eight plates:

- renderer (`scene + crt`) mean: **241.093 ms/frame**
- renderer p95: **268.5 ms/frame**
- scene mean: **12.388 ms/frame**
- CRT mean: **228.705 ms/frame**
- PNG encode mean, measured only as a lab reference: `188.570 ms/frame`

So the real CRT pass is about **94.9% of warm renderer compute**. Scene composition is only about **5.1%**.

Weighted by plate lengths, the sampled profile estimates the complete 1200-frame / 40-second video at:

- **~290.0 s of renderer compute**
- **~4.14 compute fps**
- about **7.25× slower than realtime** before video encoding

This is a sampled estimate, not a full 1200-frame wall-time benchmark, but it is plate-weighted and uses the actual CRT implementation.

## Per-plate profile

| plate | frames | render mean ms | scene mean ms | CRT mean ms | weighted compute s |
|---|---:|---:|---:|---:|---:|
| on | 120 | 228.5 | 6.2 | 222.3 | 27.42 |
| card | 120 | 232.1 | 8.5 | 223.6 | 27.85 |
| count | 120 | 229.0 | 6.2 | 222.8 | 27.48 |
| ask | 240 | 238.5 | 2.4 | 236.1 | 57.24 |
| ask2 | 180 | 242.0 | 2.4 | 239.5 | 43.56 |
| clip | 120 | 225.2 | 4.4 | 220.8 | 27.03 |
| ris | 240 | 263.5 | 34.6 | 228.9 | 63.25 |
| off | 60 | 269.9 | 34.4 | 235.5 | 16.19 |

The `ris` and `off` plates add meaningful scene cost, but even there CRT remains the dominant stage.

## Decision

1. The expensive part of RIS TV is now localized: the full-frame JavaScript CRT loop, not the JS scene DSL.
2. A full Rust/C++ rewrite of scene authoring is still the wrong optimization target.
3. If CRT / noisy retro-TV looks are commercially useful for book ads, the next performance experiment should preserve the JS/TS scene layer and move only the CRT/post stage to a shader, GPU path, native SIMD backend or another image-processing primitive.
4. Do not use RIS TV cost to price ordinary editorial book ads. It belongs to a distinct heavy visual class.
5. The upstream rough note that CRT is expensive at 1080p is directionally confirmed by the pinned-worker measurement.
6. Before implementing a new backend, E07 style-class results should be used to decide whether the product actually needs this heavy class often enough to justify engineering it.
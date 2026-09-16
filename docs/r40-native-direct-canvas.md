# R40 — Direct-canvas Native WebCodecs final software scout

## Question

Does removing the explicit JavaScript `getImageData -> Uint8Array` copy from the native Node path create a real throughput or capacity-per-GiB frontier, or is native software H.264 still structurally dominated by Chromium on the same deterministic scene?

This is the final bounded software-native experiment after R38 native-copy remained dominated.

## Fixed workload

- Same C18 fixture as R38: `river-station / hook-first / vertical`.
- 1080x1920 scene, same deterministic renderer, duration/fps/seed/assets.
- H.264 target 3 Mbps, software preference for native encoders.
- Warm scene-raster -> H.264 encode scope only.
- Audio, mux, artifact validation and storage are excluded from every backend.
- Concurrency sweep c1, c2, c3, c4; 8 jobs per scenario.

## Compared backends

1. `chromium`: Canvas -> browser `VideoFrame(canvas)` -> browser WebCodecs.
2. `native-copy`: `@napi-rs/canvas` -> `getImageData` -> `Uint8Array` -> `@napi-rs/webcodecs VideoFrame(buffer)`; exact R38 native path.
3. `native-direct`: `@napi-rs/canvas` -> `@napi-rs/webcodecs VideoFrame(canvas)`.

The direct-canvas path is not assumed zero-copy. Upstream documents Canvas input as copied RGBA/sRGB. R40 only tests whether removing the explicit JS extraction/copy changes the machine-level frontier enough to matter.

## Measurements

Per scenario:

- videos/hour;
- p50/p95 job wall;
- cgroup CPU/video;
- peak process-tree RSS and cgroup memory;
- videos/hour/GiB;
- mean encoded bytes;
- mean encode wall;
- mean frame-build wall, so the eliminated JS conversion cost is visible separately;
- failures.

## Decision gate

`native-direct` earns more native software integration work only if all direct scenarios are failure-free and either:

- best direct throughput >= 90% of best Chromium throughput, or
- best direct videos/hour/GiB >= 125% of best Chromium videos/hour/GiB.

Otherwise close the native software optimization branch until real hardware/provider evidence changes the economics.

If direct-canvas unexpectedly clears this gate, its emitted H.264 must then pass the R39 color oracle before any STANDARD integration. R40 intentionally keeps the color/quality suite outside the hot capacity benchmark.

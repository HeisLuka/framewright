# R38 — native WebCodecs capacity-per-GiB scout

## Question

The I02 native Node WebCodecs packet-copy path lost the single-job latency comparison to Chromium, but used much less RSS. R38 asks whether that memory advantage becomes a real machine-capacity advantage at bounded concurrency.

## Fair boundary

Do not compare old end-to-end commands: they have different audio and validation costs. R38 holds the comparison at the shared runtime boundary:

`same C18 semantic scene → warm raster backend → H.264 encode`

Both use the same `river-station / paper / hook-first / vertical` semantic fixture, 1080x1920, same seed, 30 fps scene duration, H.264 Baseline/realtime and the R31 3 Mbps target. Audio, mux and artifact validation are excluded from both sides.

Compared implementations:

- Chromium Canvas → `VideoFrame(canvas)` → browser WebCodecs H.264
- `@napi-rs/canvas` → RGBA `getImageData` → native `VideoFrame(buffer)` → `@napi-rs/webcodecs`

The native path deliberately includes its current RGBA extraction/copy boundary. Removing that cost is a separate hypothesis.

## Canonical CI

Run `35148600388`, artifact `10467823062`, Ubuntu 24.04 GitHub hosted runner, 8 warm jobs/scenario.

| backend | concurrency | videos/hour | p50 job | peak RSS | CPU/video | videos/hour/GiB |
|---|---:|---:|---:|---:|---:|---:|
| Chromium | 1 | 1470.4 | 2.384 s | 1.22 GiB | 7.772 s | **1209.8** |
| Chromium | 2 | 1953.7 | 3.610 s | 1.69 GiB | 7.071 s | 1154.9 |
| Chromium | 3 | **1990.1** | 5.401 s | 1.86 GiB | 7.249 s | 1070.8 |
| Chromium | 4 | 1955.4 | 7.178 s | 2.14 GiB | 7.491 s | 912.8 |
| native copy | 1 | 559.6 | 6.410 s | 0.79 GiB | 10.066 s | **712.8** |
| native copy | 2 | 790.4 | 9.080 s | 1.27 GiB | 11.337 s | 622.9 |
| native copy | 3 | **795.1** | 13.434 s | 1.70 GiB | 11.312 s | 467.2 |
| native copy | 4 | 790.1 | 18.078 s | 2.14 GiB | 11.446 s | 369.7 |

No scenario failed.

## Decision

Current native packet-copy implementation is **dominated**, not merely slower at single-job latency:

- best native throughput is only **40.0%** of best Chromium throughput;
- its best memory-normalized capacity is only **58.9%** of Chromium's best `videos/hour/GiB` frontier;
- CPU/video is materially worse and scales poorly beyond c1.

Therefore do not integrate the current `getImageData → Uint8Array → VideoFrame(buffer)` native path as STANDARD or capacity path.

One final bounded native experiment is justified before closing the family: current `@napi-rs/webcodecs` supports constructing `VideoFrame` directly from `@napi-rs/canvas`. That removes the explicit JS `getImageData`/buffer materialization while preserving the same native stack. If direct-canvas still fails to close most of this gap, leave native WebCodecs as fallback/reference and stop spending runtime attention on it until hardware/provider evidence changes the economics.

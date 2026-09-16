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

The native path deliberately includes its current RGBA extraction/copy boundary. Removing that cost is a different hypothesis and must earn its own experiment.

## Matrix

For each backend: concurrency 1, 2, 3, 4; eight warm jobs per scenario on the same GitHub runner.

Measure scenario videos/hour, p50/p95 job wall, cgroup CPU/video, peak process-tree RSS, peak cgroup memory, mean encoded bytes, and videos/hour/GiB.

## Decision gate

Native earns deeper production integration only if it establishes a useful Pareto point rather than merely consuming less memory:

- at least 90% of the best Chromium throughput, **or**
- at least 25% better best videos/hour/GiB,

with zero failures and plausible encoded output. This is a relative same-machine capacity scout, not provider `$ / 100k` proof.

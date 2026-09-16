# R44 — dedicated Worker WebCodecs encoder scout

## Question

Can the current warm Chromium c2 production path gain meaningful end-to-end throughput or efficiency by moving only `VideoEncoder` off the document main thread, while leaving the proven Canvas renderer and full-navigation lifecycle unchanged?

This is intentionally narrower than a full OffscreenCanvas renderer port.

## Isolated axis

Control:

`renderFrame(Canvas) -> VideoFrame(canvas) -> VideoEncoder` in the document main thread.

Candidate:

`renderFrame(Canvas) -> createImageBitmap(canvas) -> transferable ImageBitmap -> dedicated Worker -> VideoFrame(bitmap) -> VideoEncoder`.

Everything else stays fixed:

- exact C18 vertical heterogeneous fixtures: river-station / city-seven / long-title;
- persistent Chromium process per scenario;
- two reusable pages (`c2`), because R42 reconfirmed c2 for the current software path;
- full document navigation for every job;
- H.264 Baseline / realtime / 3 Mbps / Annex-B;
- cached canonical AAC;
- FFmpeg stream-copy mux;
- synchronous frame-count/audio validation and artifact hashing;
- same lossless Canvas renderer and seeds.

The Worker is created after each document navigation. That cost is intentionally included because navigation destroys document-owned workers in the current lifecycle. A future persistent encoder host would be a different architecture and does not get credited here for free.

## Benchmark shape

ABBA order: `main -> worker -> worker -> main`.

Each occurrence runs 18 heterogeneous jobs at c2. Browser launch, heterogeneous sampled-Canvas parity preflight, and page warm-up happen outside timed steady-state work. Timed job work is:

`navigation -> render/encode/upload -> cached-AAC mux -> validation/hash -> cleanup`.

Metrics include realized videos/hour, p50/p95 job wall, CPU/video, process-tree RSS peak, draw time, ImageBitmap construction time, Worker initialization time, upload/mux/validation wall and H.264 bytes.

## Independent quality gate

A separate representative `river-station / paper / hook-first / vertical` probe renders lossless Canvas references at semantic R31 checkpoints. Main-thread and Worker output are decoded and scored on the same semantic ROIs.

Worker quality must satisfy, for every ROI:

- SSIM >= main-thread SSIM - 0.005;
- PSNR >= main-thread PSNR - 1 dB;
- emitted range/matrix/transfer/primaries exactly match the main-thread software reference.

This catches an ImageBitmap transfer/color interpretation regression that frame-count validation alone would miss.

## Predeclared promotion gates

Correctness is mandatory:

- zero job failures;
- sampled Canvas parity true in every occurrence;
- exact frame count and audio stream validation for every timed artifact;
- representative semantic/color gate passes.

Then the Worker path must satisfy either:

1. **throughput gate**: >=10% realized videos/hour gain, p95 regression <=15%, RSS regression <=25%; or
2. **efficiency gate**: throughput >=98% of control, CPU/video <=90% of control, p95 regression <=10%, RSS regression <=25%.

Anything smaller is not worth adding a second execution context and transferable-frame lifecycle to STANDARD.

## Evidence boundary

A failure kills this specific encoder-Worker/ImageBitmap-transfer path.

It does **not** by itself prove that a full renderer port to OffscreenCanvas is useless. That larger port is only justified later if profiling shows enough renderer/main-thread work remains to overcome its implementation and compatibility cost. R44 does not silently award that hypothetical benefit to the Worker candidate.

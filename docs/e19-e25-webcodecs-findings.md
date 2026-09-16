# E19-E25: transport root cause and WebCodecs fast path

Product question: after raw RGBA removed PNG/base64/disk overhead, what actually limits mass deterministic book-ad throughput, and can the frame boundary be avoided entirely?

Canonical workload for end-to-end checks: `examples/book-ad-v0`, 15 seconds, 30 fps, 450 frames. GitHub Actions results characterize the tested 4-logical-CPU runner only; provider capacity requires a production-SKU rerun.

## E19 — deeper HTTP in-flight concurrency

Hypothesis: one-request/one-ACK serialization is the main Browser -> Node raw transport bottleneck. Gate: upload depth 4 must improve transport throughput by at least 50% over depth 1.

Result: rejected.

At 720x1280, depth 1 was about 6.55 frames/s and the best tested depth was only about 7.11 frames/s (+8.6%). At 1080x1920, depth 1 was about 3.43 frames/s and depth 4 about 3.60 frames/s (+5.0%). Throughput stayed in the same ~23-28 MiB/s range.

Decision: do not optimize the raw path by merely increasing the number of outstanding POSTs.

## E20 — transport byte volume

Hypothesis: raw transport is primarily byte-volume limited. Gate: an NV12-sized payload (37.5% of RGBA bytes) must be at least 1.5x faster at the same concurrency depth.

Result: strongly confirmed.

- 720x1280: NV12-sized payload proxy was 2.48x faster than RGBA.
- 1080x1920: NV12-sized payload proxy was 2.81x faster than RGBA.

The benchmark changes payload size only; it does not perform RGB -> NV12 conversion. It establishes that moving fewer bytes matters, not that a particular conversion implementation is free.

## E21 — `VideoFrame.copyTo(I420/NV12)`

Hypothesis: Chromium can convert a Canvas-backed `VideoFrame` to I420/NV12 and therefore shrink the process-boundary payload without a JavaScript pixel loop.

Result: rejected on the tested headless Chromium runner.

`VideoFrame` and `VideoEncoder` exist, but both `I420` and `NV12` `allocationSize/copyTo` attempts fail with `NotSupportedError` for the Canvas-backed frame.

Decision: do not build the production plan around `VideoFrame.copyTo(NV12)` on this environment.

## E22 — direct Canvas -> WebCodecs H.264 microbenchmark

Hypothesis: browser-native H.264 encoding can bypass raw frame transport. Gate: AVC support and at least 15 encoded frames/s.

Result: confirmed by a very large margin.

- 720x1280: ~196 encoded frames/s.
- 1080x1920: ~112 encoded frames/s.

This prompted an end-to-end test rather than treating the microbenchmark as a production result.

## E23 — full WebCodecs -> MP4 path

Path under test:

```text
Canvas
  -> VideoFrame(canvas)
  -> WebCodecs VideoEncoder (H.264 Annex B)
  -> compressed H.264 upload to Node
  -> ffmpeg stream-copy mux
  -> MP4
```

Reference:

```text
Canvas
  -> getImageData RGBA
  -> localhost raw frame transport
  -> ordered sink
  -> libx264 slow / CRF 22
  -> MP4
```

Gate: exact 450-frame output, at least 3x end-to-end speedup, PSNR >= 35 dB and SSIM >= 0.95 against the decoded raw/x264 reference.

### 720x1280

- WebCodecs end-to-end: 2.320 s, 194.0 effective frames/s.
- raw + x264 reference: 70.833 s, 6.42 frames/s.
- speedup: **30.54x**.
- frame count: 450/450.
- decoded comparison: PSNR 48.26 dB, SSIM 0.994849.
- WebCodecs MP4: ~1.99 MB at requested 4 Mbps variable bitrate.
- x264 CRF22 reference MP4: ~0.43 MB.

### 1080x1920

- WebCodecs end-to-end: 3.409 s, 132.0 effective frames/s.
- raw + x264 reference: 145.501 s, 3.11 frames/s.
- speedup: **42.68x**.
- frame count: 450/450.
- decoded comparison: PSNR 49.60 dB, SSIM 0.997144.
- WebCodecs MP4: ~3.32 MB at requested 8 Mbps variable bitrate.
- x264 CRF22 reference MP4: ~0.61 MB.

The gate is fully satisfied at both resolutions.

Important limitation: WebCodecs uses fixed target bitrate while the reference uses x264 CRF, so size/quality rate control is not directly equivalent. The experiment proves architecture viability, not final encoder settings or hardware acceleration.

## E24 — WebCodecs bitrate matrix

The E23 high-bitrate files were unnecessarily large, so E24 searched for lower-rate candidates while comparing decoded output to the highest-rate WebCodecs result.

### 720

- 4 Mbps baseline: ~2.00 MB.
- 2 Mbps: ~1.64 MB, PSNR 52.01, SSIM 0.99756.
- 1 Mbps: **~1.10 MB (55%)**, PSNR 47.82, SSIM 0.995942.
- 0.5 Mbps: ~0.71 MB, SSIM 0.990116 but PSNR 38.42.

The predeclared gate (`<=60%` size, PSNR >= 40, SSIM >= 0.99) is satisfied at **1 Mbps**. This is the first automatic visual-QA candidate, not yet a production default.

### 1080

- 8 Mbps baseline: ~3.32 MB.
- 4 Mbps: ~2.82 MB, PSNR 53.57, SSIM 0.998287.
- 2 Mbps: ~2.03 MB (61.2%), PSNR 50.25, SSIM 0.996808.
- 1 Mbps: ~1.34 MB (40.3%), PSNR 39.22, SSIM 0.992945.

The strict gate misses at 2 Mbps only because size is 61.2% rather than <=60%; the next useful sweep is roughly 1.25-2 Mbps plus human visual QA.

## E25 — batch throughput after raw transport is gone

One persistent Chromium process is kept alive. Each job opens a new page, loads the template, renders/encodes 450 frames with WebCodecs, counts compressed chunks, then closes the page. MP4 mux/audio are excluded; E23 measured mux at roughly one tenth of a second.

### 720 @ 1 Mbps

- 1 concurrent job: 2318 videos/hour.
- 2 jobs: 2659/hour (1.147x).
- 4 jobs: **2711/hour (1.169x)**.
- browser launch: ~296 ms.
- estimated persistent-process speedup for a single job: **1.194x**.

Concurrency does not meet the +50% gate; warm-process reuse does meet the +15% gate.

### 1080 @ 2 Mbps

- 1 job: 1354 videos/hour.
- 2 jobs: 1652/hour (1.220x).
- 4 jobs: **1727/hour (1.275x)**.
- browser launch: ~343 ms.
- estimated persistent-process speedup: 1.131x.

Concurrency again misses the +50% gate. The warm-process result is useful but below the predeclared +15% threshold.

## Architecture decision

For normal browser-native book-ad visual systems, the leading candidate is now:

```text
BookRenderPayload
  -> compiled typography/layout/assets
  -> deterministic Canvas frame
  -> VideoFrame(canvas)
  -> WebCodecs H.264
  -> compressed H.264 transfer
  -> MP4/audio mux
```

The raw FramePacket path remains valuable as:

1. a visual/reference renderer;
2. the boundary for external native/GPU post-processing;
3. a parity/debugging path.

This is not a universal replacement for expensive RIS TV-style post. If a scene performs a 100+ ms JavaScript CRT loop before WebCodecs sees the Canvas, WebCodecs cannot remove that cost. The fast path is strongest for specialized book-ad systems whose visuals remain inside cheap Canvas/browser primitives.

## Product implication

On this GitHub runner, the no-mux E25 batch test corresponds to roughly 65k 720p videos/day or 41k 1080p videos/day at continuous utilization. These are not provider capacity claims. Before infrastructure planning, repeat the final workload on the real VM/SKU including assets, final bitrate, audio mux, process recycling and failure handling.

The earlier idea that ~50k simple 720p book ads/day on one small machine might be possible is therefore no longer physically implausible, but it is still unverified until the provider-specific benchmark.

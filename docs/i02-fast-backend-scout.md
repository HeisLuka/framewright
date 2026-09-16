# I02 FAST backend scout

This is the pre-C19 scout for the final apples-to-apples FAST backend verdict.

It exists to answer one narrow question early: when the **same semantic scene code** is executed through the current STANDARD candidates, is any runtime clearly dominated before we spend more time optimizing it?

## Same-scene contract

The scout prepares the current C18 responsive structural-variant template and selects one fixture from that generated manifest.

All paths consume the same:

- book payload;
- cover asset;
- visual system;
- structural variant;
- delivery profile;
- seed;
- scene code and frame timeline;
- output dimensions;
- fps/duration;
- audio fixture.

The Node paths are not second creative implementations: they execute the exact inline scene script with `vm` + `@napi-rs/canvas`, matching the existing C18 browserless renderer.

The Chromium path loads that exact generated HTML, injects the same payload before the page script runs, calls the same `renderFrame(frame, width, seed, canvas)` function, and feeds that canvas into WebCodecs.

## Compared paths

A:

```text
Chromium Canvas
  -> WebCodecs H.264
  -> H.264 upload to Node
  -> FFmpeg stream-copy video + AAC audio mux
  -> MP4
```

B:

```text
@napi-rs/canvas
  -> raw RGBA stdin
  -> x264 veryfast
  -> AAC audio + MP4 mux in the same FFmpeg process
  -> MP4
```

C — bounded third candidate added after the complementary-ecosystem scout:

```text
@napi-rs/canvas
  -> @napi-rs/webcodecs VideoFrame(canvas)
  -> H.264 + AAC in process
  -> @napi-rs/webcodecs Mp4Muxer
  -> MP4
```

The C path is deliberately pinned to `@napi-rs/webcodecs@1.3.0` because the lab runtime is pinned to Node `20.20.2`; current `1.4.0` requires Node 22+. The package documents that `VideoFrame(canvas)` copies Canvas pixels as RGBA, so this path is **not** assumed to be zero-copy. The benchmark records frame-copy/encode time, CPU and RSS explicitly.

Both a fixed 2 Mbps x264 comparison and an `x264 veryfast CRF 22` reference are retained because nominal bitrate equality is not the same thing as quality equality.

## Measurements

For repeated runs on the same runner:

- end-to-end wall;
- derived videos/hour;
- process-tree peak RSS;
- cgroup CPU time when available;
- MP4 bytes;
- WebCodecs launch/page/encode/upload/mux stages;
- Node scene init/frame render/write-wait stages;
- native Node WebCodecs render/copy+encode/AAC/mux-finalize stages;
- ffprobe stream/frame metadata;
- decoded A-vs-B SSIM/PSNR;
- sampled **pre-encode raster parity** between browser Canvas and `@napi-rs/canvas`;
- codec loss against each backend's own pre-encode raster.

Raster parity is important: a codec comparison is not valid if the two Canvas implementations are already drawing materially different pictures.

## Scout result — compute before candidate C

Canonical scout evidence before the native Node WebCodecs pass: GitHub Actions run `35133551686`, fixture `river-station-paper-hook-first-vertical`, 1080x1920, seed 10.

| backend | mean wall | videos/hour | mean MP4 | peak RSS | cgroup CPU |
|---|---:|---:|---:|---:|---:|
| Chromium Canvas -> WebCodecs -> FFmpeg mux | 4.415 s | 815.32 | 1.23 MiB | 1237.49 MiB | 10.871 s |
| @napi-rs/canvas -> x264 fixed 2 Mbps | 7.199 s | 500.09 | 1.58 MiB | 726.62 MiB | 21.550 s |
| @napi-rs/canvas -> x264 CRF 22 reference | 6.516 s | 552.47 | 0.79 MiB | 728.37 MiB | 17.674 s |

On this scene, the fixed-target Node path takes **1.63x** the wall time and about **1.98x** the CPU time of WebCodecs. WebCodecs therefore has a strong compute/capacity lead, but its Chromium process tree uses about **1.70x** the peak RSS of the Node path. Memory/concurrency economics remains a real gate.

Candidate C is intended to test whether the current tradeoff can be improved: keep the browserless Node Canvas memory profile while replacing the raw-RGBA-to-FFmpeg process boundary with in-process H.264/AAC/MP4. It is only useful if the mandatory RGBA Canvas copy and native codec path do not erase that advantage.

## WebCodecs stage budget

Mean 4.415 s full job:

| stage | mean | share |
|---|---:|---:|
| browser launch | 268.5 ms | 6.1% |
| page load / ready | 88.2 ms | 2.0% |
| draw + encode | 3019.3 ms | 68.4% |
| compressed upload | 60.9 ms | 1.4% |
| audio encode + mux | 761.4 ms | 17.2% |
| residual | 217.1 ms | 4.9% |

This changes the optimization order. Cold browser lifecycle alone is no longer the largest residual. Audio/mux clearly clears the Runtime Gold Rush 10-15% scout gate, while draw+encode remains the dominant stage.

## Raster parity

The browser and `@napi-rs/canvas` execute the same semantic scene but are not pixel-identical. Across four sampled pre-encode frames, worst SSIM was `0.994756` and worst PSNR was `34.382579 dB`.

That is close enough to continue backend economics research, but final visual QA should not use pixel equality as the cross-Canvas gate. Differences can come from font rasterization, SVG/image decode and Canvas compositing.

## Scout result — rate/distortion before candidate C

Each encoder was also compared against the lossless sampled frames produced by **its own** Canvas implementation:

| backend | mean SSIM | worst SSIM | mean PSNR | worst PSNR |
|---|---:|---:|---:|---:|
| WebCodecs 2 Mbps | 0.990488 | 0.979158 | 39.728 dB | 36.2603 dB |
| x264 fixed 2 Mbps | 0.995896 | 0.994371 | 41.4521 dB | 41.1023 dB |
| x264 CRF 22 | 0.992524 | 0.991187 | 39.9923 dB | 39.7686 dB |

So the scout result is deliberately split:

- **compute throughput / CPU:** Chromium WebCodecs leads strongly;
- **peak memory:** Node Canvas leads;
- **current rate-distortion:** x264 leads;
- **current Chromium WebCodecs bitrate policy is not quality-matched.**

The interesting detail is x264 CRF 22: it produced about 0.79 MiB while slightly beating WebCodecs 2 Mbps on sampled average quality and materially beating its worst sampled frame. That is direct evidence that encoder policy, scene keyframes and eventually ROI-aware quality are worth investigating before freezing the STANDARD backend.

## Native Node WebCodecs gate

The added pass runs `@napi-rs/webcodecs@1.3.0` at the same 2 Mbps video target and 192 kbps AAC, with the same Node Canvas scene and deterministic WAV fixture. It reports:

- full wall / videos-hour;
- cgroup CPU and process-tree RSS;
- Node scene render time;
- `VideoFrame(canvas)` copy + encode enqueue time;
- encoder queue wait;
- AAC encode time;
- MP4 mux-finalize time;
- final MP4 bytes and ffprobe validation;
- own-raster sampled SSIM/PSNR;
- decoded-output difference from the x264 CRF22 reference when that artifact is present.

The candidate is interesting only if it materially improves capacity/cost/reliability. Removing Chromium and FFmpeg CLI is not by itself a win.

## Current quality-match pass

The Chromium WebCodecs pass also sweeps `1.5 / 2 / 2.5 / 3 / 4 Mbps` with:

- the existing fixed two-second keyframe policy;
- scene-boundary keyframes in addition to the two-second safety GOP.

The target is the sampled own-raster x264 CRF 22 quality above. The smallest WebCodecs point that meets the target becomes the next economics candidate. If none meets it, the next codec scout moves to quantizer/ROI policy instead of blindly raising bitrate.

## What this scout does not prove

This is explicitly **not the final backend selection** because C19 has not yet produced the canonical campaign delivery package.

It may reject a clearly inferior backend or expose a parity problem. The final backend freeze must still repeat the selected policies against the C19/I01 `RenderSpec` production workload and include semantic ROI gates for hook/title/CTA/cover.

Decoded cross-backend SSIM/PSNR is only a difference metric between two lossy outputs; it must not be presented as an independent quality score.

## Decision gate

Treat this run as strong scouting evidence when one candidate shows one or more of:

- roughly >=15% wall / videos-hour advantage across repeats;
- materially lower CPU or RSS at similar output quality;
- severe pre-encode raster mismatch;
- repeated runtime failure/compatibility problems;
- meaningful simplification of process boundaries **without** a cost/capacity regression.

Current evidence clears the compute gate in favor of Chromium WebCodecs, but does **not** yet clear the quality-matched backend gate. The native Node WebCodecs pass, quality matrix, warm/concurrency memory economics and final C19 workload remain before a STANDARD freeze.

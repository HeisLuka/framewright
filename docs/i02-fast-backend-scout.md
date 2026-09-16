# I02 FAST backend scout

This is the pre-C19 scout for the final apples-to-apples FAST backend verdict.

It exists to answer one narrow question early: when the **same semantic scene code** is executed through the two current STANDARD candidates, is either runtime clearly dominated before we spend more time optimizing it?

## Same-scene contract

The scout prepares the current C18 responsive structural-variant template and selects one fixture from that generated manifest.

Both paths consume the same:

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

The Node path is not a second creative implementation: it executes the exact inline scene script with `vm` + `@napi-rs/canvas`, matching the existing C18 browserless renderer.

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

Both a fixed 2 Mbps x264 comparison and an `x264 veryfast CRF 22` reference are retained because nominal bitrate equality is not the same thing as quality equality.

## Measurements

For three A/B repeats on the same runner:

- end-to-end wall;
- derived videos/hour;
- process-tree peak RSS;
- cgroup CPU time when available;
- MP4 bytes;
- WebCodecs launch/page/encode/upload/mux stages;
- Node scene init/frame render/write-wait stages;
- ffprobe stream/frame metadata;
- decoded A-vs-B SSIM/PSNR;
- sampled **pre-encode raster parity** between browser Canvas and `@napi-rs/canvas`;
- codec loss against each backend's own pre-encode raster.

Raster parity is important: a codec comparison is not valid if the two Canvas implementations are already drawing materially different pictures.

## Scout result — compute

Canonical scout evidence before the quality matrix: GitHub Actions run `35133551686`, fixture `river-station-paper-hook-first-vertical`, 1080x1920, seed 10.

| backend | mean wall | videos/hour | mean MP4 | peak RSS | cgroup CPU |
|---|---:|---:|---:|---:|---:|
| Chromium Canvas -> WebCodecs -> FFmpeg mux | 4.415 s | 815.32 | 1.23 MiB | 1237.49 MiB | 10.871 s |
| @napi-rs/canvas -> x264 fixed 2 Mbps | 7.199 s | 500.09 | 1.58 MiB | 726.62 MiB | 21.550 s |
| @napi-rs/canvas -> x264 CRF 22 reference | 6.516 s | 552.47 | 0.79 MiB | 728.37 MiB | 17.674 s |

On this scene, the fixed-target Node path takes **1.63x** the wall time and about **1.98x** the CPU time of WebCodecs. WebCodecs therefore has a strong compute/capacity lead, but its Chromium process tree uses about **1.70x** the peak RSS of the Node path. Memory/concurrency economics remains a real gate.

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

## Scout result — rate/distortion

Each encoder was also compared against the lossless sampled frames produced by **its own** Canvas implementation:

| backend | mean SSIM | worst SSIM | mean PSNR | worst PSNR |
|---|---:|---:|---:|---:|
| WebCodecs 2 Mbps | 0.990488 | 0.979158 | 39.728 dB | 36.2603 dB |
| x264 fixed 2 Mbps | 0.995896 | 0.994371 | 41.4521 dB | 41.1023 dB |
| x264 CRF 22 | 0.992524 | 0.991187 | 39.9923 dB | 39.7686 dB |

So the scout result is deliberately split:

- **compute throughput / CPU:** WebCodecs leads strongly;
- **peak memory:** Node Canvas leads;
- **current rate-distortion:** x264 leads;
- **current WebCodecs bitrate policy is not quality-matched.**

The interesting detail is x264 CRF 22: it produced about 0.79 MiB while slightly beating WebCodecs 2 Mbps on sampled average quality and materially beating its worst sampled frame. That is direct evidence that encoder policy, scene keyframes and eventually ROI-aware quality are worth investigating before freezing the STANDARD backend.

## Current quality-match pass

The next bounded pass sweeps WebCodecs at `1.5 / 2 / 2.5 / 3 / 4 Mbps` with:

- the existing fixed two-second keyframe policy;
- scene-boundary keyframes in addition to the two-second safety GOP.

The target is the sampled own-raster x264 CRF 22 quality above. The smallest WebCodecs point that meets the target becomes the next economics candidate. If none meets it, the next codec scout moves to quantizer/ROI policy instead of blindly raising bitrate.

## What this scout does not prove

This is explicitly **not the final backend selection** because C19 has not yet produced the canonical campaign delivery package.

It may reject a clearly inferior backend or expose a parity problem. The final backend freeze must still repeat the selected policies against the C19/I01 `RenderSpec` production workload and include semantic ROI gates for hook/title/CTA/cover.

Decoded A-vs-B SSIM/PSNR is only a difference metric between two lossy outputs; it must not be presented as an independent quality score.

## Decision gate

Treat this run as strong scouting evidence when one candidate shows one or more of:

- roughly >=15% wall / videos-hour advantage across repeats;
- materially lower CPU or RSS at similar output quality;
- severe pre-encode raster mismatch;
- repeated runtime failure/compatibility problems.

Current evidence clears the compute gate in favor of WebCodecs, but does **not** yet clear the quality-matched backend gate. The quality matrix, warm/concurrency memory economics and final C19 workload remain before a STANDARD freeze.

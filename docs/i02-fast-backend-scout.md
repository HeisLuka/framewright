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
  -> WebCodecs H.264 (2 Mbps target)
  -> H.264 upload to Node
  -> FFmpeg stream-copy video + AAC audio mux
  -> MP4
```

B:

```text
@napi-rs/canvas
  -> raw RGBA stdin
  -> x264 veryfast (2 Mbps target)
  -> AAC audio + MP4 mux in the same FFmpeg process
  -> MP4
```

A historical `x264 veryfast CRF 22` run is also recorded as a reference because earlier browserless results used CRF rather than a bitrate target.

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
- sampled **pre-encode raster parity** between browser Canvas and `@napi-rs/canvas`.

Raster parity is important: a codec comparison is not valid if the two Canvas implementations are already drawing materially different pictures.

## What this scout does not prove

This is explicitly **not the final backend selection** because C19 has not yet produced the canonical campaign delivery package.

It may reject a clearly inferior backend or expose a parity problem. A close result must be repeated against the final C19/I01 `RenderSpec` production workload with quality-matched encoder policy.

In particular, decoded A-vs-B SSIM/PSNR is a difference metric between encodes, not yet a common-reference perceptual quality score. The later codec-quality wave adds ROI gates for hook/title/CTA/cover.

## Decision gate

Treat this run as strong scouting evidence when one candidate shows one or more of:

- roughly >=15% wall / videos-hour advantage across repeats;
- materially lower CPU or RSS at similar output quality;
- severe pre-encode raster mismatch;
- repeated runtime failure/compatibility problems.

If the candidates remain close, do not overfit to GitHub Actions noise. Carry both into the final C19 production workload comparison.

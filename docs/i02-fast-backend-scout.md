# I02 FAST backend scout

This is the pre-C19 scout for the final apples-to-apples FAST backend verdict.

It asks one bounded question: when the **same semantic scene code** is executed through plausible STANDARD runtimes, which paths deserve production-workload follow-up and which are already dominated?

## Same-scene contract

All paths consume the same C18 fixture inputs:

- book payload and cover asset;
- visual system and structural variant;
- delivery profile and seed;
- exact scene code and frame timeline;
- 1080x1920 output, fps and duration;
- deterministic 12 s WAV fixture.

The Node paths execute the exact inline scene script through `vm` + `@napi-rs/canvas`. The Chromium path loads the same generated HTML and calls the same `renderFrame(frame, width, seed, canvas)` function.

Canonical scout fixture: `river-station-paper-hook-first-vertical`, seed `10`, 360 frames / 12 s.

## Candidate paths

A — current compute leader:

```text
Chromium Canvas
  -> browser WebCodecs H.264
  -> compressed H.264 upload to Node
  -> FFmpeg AAC + stream-copy mux
  -> MP4
```

B — browserless reference/fallback:

```text
@napi-rs/canvas
  -> RGBA stdin
  -> x264 veryfast
  -> AAC + MP4 in FFmpeg
  -> MP4
```

C — third candidate discovered during the complementary-ecosystem scout:

```text
@napi-rs/canvas
  -> getImageData RGBA
  -> Uint8Array
  -> @napi-rs/webcodecs VideoFrame(buffer)
  -> H.264
  -> immediately copy compressed chunk bytes to plain Uint8Array
  -> release native Encoded*Chunk wrappers
  -> @napi-rs/webcodecs AAC
  -> reconstruct encoded chunks
  -> native Mp4Muxer
  -> MP4
```

Candidate C is pinned to `@napi-rs/webcodecs@1.3.0` for the lab's Node `20.20.2`. Its v1.3.0 `fastStart` mode is deliberately disabled: upstream issue #108 corrupts later tracks in multi-track MP4. Video and audio codec descriptions are captured before mux header creation, and both streams must independently decode with FFmpeg before a run is accepted.

## Latest same-run compute result

GitHub Actions run `35140422055`, artifact `10464678026`:

| backend | mean wall | videos/hour | cgroup CPU | peak RSS | mean MP4 |
|---|---:|---:|---:|---:|---:|
| Chromium Canvas -> WebCodecs | **4.354 s** | **826.87** | **10.385 s** | 1264.86 MiB | 1.23 MiB |
| Node Canvas -> x264 CRF 22 | 6.411 s | 561.55 | 17.399 s | 720.04 MiB | **0.79 MiB** |
| Node Canvas -> native WebCodecs packet-copy | 5.950 s | 605.02 | 11.792 s | **524.09 MiB** | 2.94 MiB |

Candidate C versus Chromium:

- ~36.7% slower end-to-end wall time;
- ~26.8% lower single-job videos/hour;
- ~13.5% more CPU;
- ~58.6% less peak RSS.

Candidate C versus x264 CRF 22:

- ~7.2% faster wall time;
- ~32% less CPU;
- ~27% less peak RSS;
- materially larger output and weaker current rate/distortion.

A rough single-job memory-efficiency signal is therefore interesting, but it is **not** a concurrency or dollar-cost result. Peak RSS from isolated jobs cannot be directly converted into `$ / 100k videos` without concurrency, CPU saturation and soak evidence.

## Candidate C: what failed before the final path

The useful result is not just the final number; several plausible implementations were rejected.

### Direct `VideoFrame(canvas)` is unsafe in a tight Node loop

On Node 20 / `@napi-rs/webcodecs@1.3.0`, `new VideoFrame(canvas) -> close()` without an encoder showed roughly 16 MiB/frame RSS growth. On Node 22 / `1.4.0`, the same direct Canvas path improved to roughly 8 MiB/frame but still reached about 3 GiB by frame 360.

This is not evidence of a semantic scene leak: `render-only` stayed around 0.1-0.15 GiB.

### RGBA external-buffer lifetime needs an event-loop boundary

`getImageData()` in a tight synchronous loop also appeared to retain roughly one 1080x1920 RGBA allocation per frame. Adding one event-loop yield (`setImmediate`) per frame changed the behavior dramatically:

- `getImageData + yield`: peak around 230 MiB;
- `getImageData -> VideoFrame(buffer) -> close + yield`: peak around 366 MiB;
- forced GC every frame reduced RSS further but was slower and is rejected as a production strategy.

The practical rule for this N-API path is therefore: **bounded backpressure must also give V8/N-API external-buffer finalizers a chance to run.**

### Yield batching was not a throughput win

A video-only cadence matrix rejected the assumption that yielding every frame was the source of the latency gap:

| yield cadence | wall | videos/hour | CPU | peak RSS |
|---|---:|---:|---:|---:|
| every 1 frame | **3.753 s** | **959.13** | 8.833 s | 469.8 MiB |
| every 2 | 4.441 s | 810.57 | 8.364 s | 474 MiB |
| every 4 | 4.817 s | 747.35 | 7.869 s | 588 MiB |
| every 8 | 5.015 s | 717.92 | 7.609 s | 629 MiB |
| every 16 | 5.068 s | 710.37 | 7.784 s | 611 MiB |

Yield-every-frame was the fastest tested cadence. Batching increased extraction/backpressure stalls.

### Retaining native encoded chunk wrappers was the second hidden lifetime cost

The first memory-safe full-video implementation still kept native `EncodedVideoChunk` objects alive until mux. It measured roughly 7.67 s wall and 601 MiB RSS.

The final path copies compressed bytes immediately with `chunk.copyTo(Uint8Array)`, releases the native wrapper, and reconstructs lightweight encoded chunks only for mux. That improved the same architecture to **5.95 s wall / 524 MiB RSS**.

## Quality / rate-distortion

Cross-backend decoded SSIM is not a common-reference quality score. Each encoder is evaluated against its own lossless Canvas raster, and final policy must use semantic ROIs for hook/title/CTA/cover.

Corrected x264 CRF22 reference from the identical-frame quality pass:

- mean/worst SSIM: about `0.992828 / 0.990483`.

Chromium WebCodecs 4 Mbps fixed reached roughly `0.99415` mean SSIM but only about `0.98925` on the worst sampled frame. Scene-boundary keyframes did not materially solve that worst-frame problem.

Final candidate C at 2 Mbps:

- mean/worst SSIM: `0.993710 / 0.988215`;
- mean/worst PSNR: `40.4442 / 38.7154 dB`;
- mean MP4: `2.94 MiB`.

So candidate C is **not quality/bytes matched to x264 CRF22**. Do not interpret its lower RSS as permission to freeze it as STANDARD primary.

## Audio / mux implication

The native MP4 mux itself is effectively negligible after compressed packets exist: about **5 ms** in the final candidate. AAC encoding still costs about **0.65 s**.

That independently reinforces the R29/R32 conclusion: repeated AAC encode is the meaningful audio residual, not MP4 container construction. Canonical encoded AAC remains useful regardless of which FAST video backend wins.

## Verdict

### Keep Chromium/WebCodecs as the current primary FAST candidate

On the controlled single-job workload it remains materially faster than the native Node alternative. The current quality policy still needs R31 semantic ROI work, but candidate C does not displace Chromium on latency evidence.

### Keep packet-copy native WebCodecs as a capacity candidate, not a latency winner

The final native path is valid, browserless, low-memory and close to Chromium in CPU. Its ~0.52 GiB peak RSS is materially lower than Chromium's ~1.26 GiB on the same runner. That is enough to preserve the hypothesis for a **separate concurrency / videos-hour-per-GiB / dollar-economics scout**.

A rough isolated-job ratio is about 1180 videos/hour/GiB for candidate C versus about 670 for Chromium and about 800 for x264 CRF22, but that ratio is only a prioritization signal. It is not a capacity result until concurrent jobs are measured on the same machine.

R30 is already complete and found warm Chromium page reuse at concurrency 2 to be the best tested Chromium operating point. R33 is now actively testing heterogeneous warm-page reset safety. Do not reopen or mutate either scope just to accommodate candidate C. If memory/cost remains material after R33, create a new bounded capacity task comparing the packet-copy native path against the then-current Chromium operating point. If it does not produce a material capacity/$ win, kill the native branch. Only if it earns that gate should we spend time quality-matching its encoder policy or moving the scout to Node 22+ / `@napi-rs/webcodecs` 1.4+.

## What remains before STANDARD freeze

This PR is still scout evidence, not the final backend selection. The final I02 freeze waits for:

1. the canonical C19 + I01 `CreativeSpec` / `RenderSpec` production workload;
2. R31 semantic ROI quality gates for hook/title/CTA/cover;
3. R33 safe heterogeneous warm-page/reset evidence for the leading Chromium path;
4. capacity economics for candidate C only if lower RSS remains economically relevant after the above.

Do not optimize STANDARD compositor languages, custom codecs, or native-path micro-latency before these gates are resolved.

# E03 results — browser-side WebCodecs stream

Benchmark commit: `f8d491bf8f12e8d34ff6015586711e00152350a9`

GitHub Actions run: `35045658379`

## Capability result

The first probe on a `data:` URL incorrectly reported `VideoEncoder=false`. WebCodecs is a secure-context API, so that result was not accepted.

The corrected localhost probe (`http://127.0.0.1`, `isSecureContext=true`) reports:

- `VideoEncoder=true`
- `VideoFrame=true`
- H.264 baseline supported
- H.264 main supported
- VP9 supported
- AV1 supported

A 30-frame 320×568 H.264 smoke encode completed successfully.

This is an important lab lesson: capability probes must use the same trust/origin conditions as the intended production path.

## E03 path

E03 keeps the existing `book-ad-v0` template and its `RISO.frame()` semantics.

During the browser-side loop only, `HTMLCanvasElement.prototype.toDataURL()` is replaced by a no-op. `RISO.frame()` therefore draws the same canvas without performing PNG encoding. The drawn canvas is wrapped directly in a `VideoFrame` and fed to `VideoEncoder`.

Pipeline:

```text
BookAdPayload
→ existing Canvas scene code
→ Canvas
→ VideoFrame(Canvas)
→ Chromium WebCodecs H.264
→ one encoded elementary stream transfer to Node
→ FFmpeg stream-copy mux
→ MP4
```

No per-frame PNG, no per-frame base64, no per-frame CDP transfer, no temporary frame directory.

## Same-run comparison

The E02 baseline and E03 path were run in the same GitHub Actions job to reduce hardware/noise bias.

### E02 baseline

1080×1920, 360 frames, 5 tabs, PNG/dataURL transport, existing libx264 slow/CRF22:

- render: `4.913 s`
- build: `6.702 s`
- total: `11.671 s`
- final MP4: `515,644 bytes`
- temporary PNG frames: `51,071,439 bytes` (~48.71 MiB)

### E03 WebCodecs

Three complete repetitions at 1080×1920, H.264 Main (`avc1.4d002a`), target bitrate 2.5 Mbit/s:

| run | total | browser encode loop | H.264 bytes | MP4 bytes | final CDP approx. | mux |
|---|---:|---:|---:|---:|---:|---:|
| 1 | 3.670 s | 3.044 s | 1,694,575 | 1,696,898 | 52.9 ms | 69.4 ms |
| 2 | 3.691 s | 3.063 s | 1,691,564 | 1,693,887 | 51.4 ms | 69.0 ms |
| 3 | 3.667 s | 3.037 s | 1,697,441 | 1,699,764 | 50.6 ms | 68.6 ms |

Median E03 total: **3.670 s**.

Same-run end-to-end speedup vs E02 baseline: **3.18×**.

The three E03 repetitions differ by less than 1%, which is much more stable than comparing unrelated CI jobs.

## Where the time moved

Representative browser-side run:

- draw all 360 frames with existing scene code and PNG disabled: `~1.024 s`
- construct `VideoFrame` objects from the Canvas: `~1.567 s`
- enqueue calls themselves: `~3.7 ms`
- total browser encode loop including asynchronous encoder work/backpressure: `~3.044 s`
- convert final ~1.69 MB H.264 stream to base64 once: `~58 ms`
- final CDP transfer approximation: `~53 ms`
- Node base64 decode: `~2 ms`
- FFmpeg stream-copy mux: `~69 ms`

So after removing PNG transport, the next obvious renderer-local cost is **Canvas → VideoFrame materialization/copy**, not JavaScript scene composition.

## Quality

The WebCodecs output and the existing x264 CRF22 baseline were decoded and compared frame-for-frame:

- SSIM All: `0.998606`
- PSNR average: `50.249 dB`

The sampled contact sheets are visually indistinguishable at normal review scale.

Caveat: this quality metric compares two lossy encodes of the same source, not each encode independently against the original PNG sequence. E04 should use the original rendered frames as the quality reference.

## Remaining problems

### Output size

At 2.5 Mbit/s target, E03 produces ~`1.70 MB`, about 3.3× the E02 libx264 CRF22 file (~`0.52 MB`). This is still small for a 12-second ad, but it is not an optimized bitrate/quality point.

### MP4 timing

The current raw-H.264 stream-copy mux produces:

- 360 frames (correct)
- ~30 fps (correct enough for playback)
- duration `12.006641 s` instead of exactly `12.000000 s`

This is not acceptable as the final deterministic contract. The H.264 stream is valid; the remaining issue is timestamp/timebase normalization during muxing.

## E03 decision

E03 strongly changes the architecture picture:

1. **We do not need to remove Chromium just to make the cheap book-ad path fast.**
2. Browser-side WebCodecs removes the dominant PNG/CDP/disk bottleneck with a small architecture change.
3. The scene/template DSL can remain JavaScript/Canvas for now.
4. A native/Rust rewrite is even less justified for the cheap style after this result.
5. The next renderer bottleneck is Canvas → `VideoFrame`, while the next product-level work is encoder bitrate/quality tuning and exact MP4 timestamping.

Next experiment: encoder/mux matrix using the original rendered frames as reference, comparing x264 presets/CRF against WebCodecs bitrate/latency settings. Select a production output profile by wall time + size + SSIM/PSNR + visual QA rather than encoder ideology.

# R40 — Explicit Canvas RGB → YUV color conversion scout

## Why this exists

R39 rejected a tempting but wrong fix: rewriting already encoded H.264 VUI/container tags from the current Chromium/WebCodecs output to BT.709 changes decoder interpretation without changing the encoded YUV samples and worsens synthetic RGB fidelity.

R40 moves the experiment one boundary earlier. The question is whether the **actual RGB → YUV conversion before H.264 encode** can be made explicit and portable without damaging the FAST path.

## Canonical run

Latest successful GitHub Actions run: `35151477072`.
Artifact: `10469202404`.

The synthetic workload is 1080×1920, 30 fps, 3 Mbps H.264 Baseline, using the same R39 patch gates.

## Findings

### 1. The Canvas source is explicit RGB/sRGB-like

A `VideoFrame(canvas)` reports:

- format: `BGRA`
- full range: `true`
- matrix: `rgb`
- primaries: `bt709`
- transfer: `iec61966-2-1`

So the Canvas-side representation itself is not an unknown YUV surface.

### 2. `VideoFrameInit.colorSpace` does not control Canvas → YUV conversion here

Requesting `new VideoFrame(canvas, { colorSpace: { primaries:'bt709', transfer:'bt709', matrix:'bt709', fullRange:false }})` is syntactically accepted, but the observed frame/output does not become BT.709 YUV.

Both default and requested-BT.709 Canvas paths still encode as TV-range SMPTE 170M on this Chromium build:

| path | emitted range/matrix | mean abs RGB error | max RGB error |
|---|---|---:|---:|
| Canvas default | tv / smpte170m | 0.903 | 3 |
| Canvas + requested BT.709 | tv / smpte170m | 0.902 | 3 |

The small encode-wall difference between those two single synthetic runs is treated as noise, not an optimization result.

### 3. Chromium still cannot `copyTo()` Canvas frames as I420/NV12

The current browser capability probe reconfirms historical E21:

- `copyTo({format:'I420'})` / `allocationSize({format:'I420'})` → `NotSupportedError: pixel format conversion is not supported`
- `copyTo({format:'NV12'})` → same error
- `RGBA` and `RGBX` copies are supported

Therefore there is no cheap browser-native RGB → I420/NV12 extraction path in this tested build.

### 4. Explicit raw I420 BT.709 is correctly honored by WebCodecs

The first raw-I420 control in the stage-1 harness accidentally used BT.601-family RGB→YUV coefficients while tagging the frame BT.709. That control is intentionally left in history as invalid evidence and must not be used for the decision.

A separate corrected control used BT.709 limited-range coefficients before constructing an I420 `VideoFrame` with BT.709 metadata. It produced:

- observed frame: limited-range BT.709
- `ffprobe`: `yuv420p`, `color_range=tv`, `color_space=bt709`, `color_transfer=bt709`, `color_primaries=bt709`
- mean absolute RGB channel error: **2.63**
- max absolute RGB channel error: **6**
- neutral max cast: **0**
- black mean: **0**
- white mean: **251**
- grayscale monotonic: **true**
- synthetic gate: **PASS**

This isolates the boundary: the encoder can preserve an explicit raw BT.709 YUV contract. The uncontrolled part is the Canvas RGB → encoder-YUV conversion.

## Decision

Do **not** add an RGB→YUV preconversion stage to the current FAST path merely to obtain conventional BT.709 metadata.

The current Canvas→WebCodecs path already has better measured RGB round-trip error on this synthetic chart than the corrected explicit BT.709 control, and browser-native I420/NV12 conversion is unavailable. A software/WASM/native/GPU preconversion stage would therefore add complexity, memory traffic and likely CPU cost for portability rather than visible quality improvement.

For provider/hardware experiments, use the current Chromium output as the initial reference contract:

1. compare emitted color metadata;
2. compare decoded RGB behavior on the R39/R40 synthetic chart;
3. compare representative-book quality/semantic ROIs;
4. reject hardware/provider candidates that introduce a material color shift even if their nominal metadata says BT.709.

An explicit BT.709 preconversion backend earns a production experiment only if a real provider/hardware mismatch makes it necessary. If that happens, it must preserve the R31 semantic quality gates and add no more than ~5% workload cost before it can replace the simpler Canvas path.

## Scope boundary

R40 does not change creative semantics, the 3 Mbps R31 bitrate policy, warm-page concurrency, audio/mux policy, artifact validation, or provider selection.

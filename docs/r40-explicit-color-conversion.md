# R40 — Explicit Canvas RGB → YUV color conversion scout

## Why this exists

R39 rejected a tempting but wrong fix: rewriting already encoded H.264 VUI/container tags from the current Chromium/WebCodecs output to BT.709 changes decoder interpretation without changing the encoded YUV samples and worsens synthetic RGB fidelity.

R40 moves the experiment one boundary earlier. The question is whether the **actual RGB → YUV conversion before H.264 encode** can be made explicit and portable.

## Stage 1: cheapest API boundary probe

The same deterministic 1080×1920 synthetic color chart is encoded at the existing R31 policy: H.264 Baseline, 3 Mbps target, 30 fps, realtime latency.

Three input contracts are compared:

1. `canvas-default` — current production behavior: `new VideoFrame(canvas, {timestamp})`.
2. `canvas-bt709-tv` — same Canvas source but with an explicit `VideoFrameInit.colorSpace = {primaries:'bt709', transfer:'bt709', matrix:'bt709', fullRange:false}` request.
3. `raw-i420-bt709-tv` — control/proof path. Canvas RGBA is explicitly converted to limited-range BT.709 I420 before constructing a raw `VideoFrame` carrying the same BT.709 color-space metadata.

For each supported path the scout records:

- `VideoFrame.colorSpace` observed before encode;
- raw H.264 and MP4 color metadata from `ffprobe`;
- decoded RGB patch error using the R39 correctness gates;
- encode wall and output bytes.

## Stage-1 decision gates

A direct Canvas BT.709 path earns the representative-book deep pass only if all are true:

- the requested BT.709 limited color space is actually observable on the `VideoFrame`;
- emitted H.264/MP4 metadata is TV-range BT.709;
- the synthetic RGB gate passes;
- encode overhead versus the current Canvas path is no more than 5%.

The manual raw-I420 path is **not** a production candidate by itself. It is a diagnostic control. If it emits correct BT.709 metadata and passes RGB fidelity while the direct Canvas override fails, then Chromium can encode an explicit BT.709 YUV frame correctly but the Canvas→VideoFrame conversion is not sufficiently controlled. Only then does an efficient preconversion path earn another benchmark.

If neither explicit path establishes correct BT.709 behavior, keep the R39 measured current Chromium output as the reference and require future hardware/provider candidates to match its decoded RGB behavior plus metadata rather than guessing a color contract.

## Scope boundary

Stage 1 intentionally does not change creative semantics, bitrate target, warm-page concurrency, audio/mux policy, or provider selection. Representative C18 book-ad quality and full workload throughput are run only if Stage 1 produces a viable explicit conversion path.

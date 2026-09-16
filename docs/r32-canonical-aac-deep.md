# R32 — Canonical AAC artifact deep integration

R29 isolated a large FAST-path cost: encoding the same source audio to AAC for every video. On its validated 12-second mux fixture, `WAV -> AAC + MP4` cost about 500 ms p50 while `canonical AAC -> stream-copy MP4` cost about 54 ms. R32 asks whether that win survives a **full production-shaped WebCodecs job** and whether the identity/cache semantics are safe enough to promote.

## Workload

The deep pass uses the same C18 semantic workload as the I02 backend scout:

- `river-station`
- visual system `paper`
- structural variant `hook-first`
- vertical `1080x1920`
- seed 10
- explicit RenderSpec duration 12 seconds / 360 frames / 30 fps
- WebCodecs H.264 at 2 Mbps
- one deterministic 48 kHz PCM source track

Creative semantics are unchanged. The only variable is the audio boundary.

## Three modes

For three repeated full jobs per steady-state mode:

```text
baseline
Canvas -> WebCodecs H264 -> WAV -> AAC encode -> FFmpeg MP4

cached miss
encode canonical AAC once -> Canvas -> WebCodecs H264 -> AAC copy -> FFmpeg MP4

cached hit
reuse canonical AAC -> Canvas -> WebCodecs H264 -> AAC copy -> FFmpeg MP4
```

The cache-miss path is measured separately so the optimization does not hide its first-use cost.

## Audio identity

The scout uses a provisional runtime identity only; it is not a factory-contract change yet.

```text
audio_spec_id = sha256(
  source audio sha256
  + exact trim/timing/duration policy
  + gain/fade/mix policy
  + AAC codec/container/bitrate policy version
)

canonical_audio_artifact =
  audio_spec_id
  + encoded M4A bytes
  + artifact sha256
  + provenance
```

A cached artifact is accepted only when both `audio_spec_id` and the stored artifact SHA-256 match the actual file.

The runtime row also records a render-spec-like ID that includes explicit duration and the canonical encoded-audio hash when cached audio is used. This avoids silently treating different audio timing or encoding policies as the same concrete render specification.

## Duration contract discovered during R32

The first full-job attempt reproduced the timestamp failure seen in the rejected first R29 run: using `-shortest` with Annex-B H.264 whose input timestamps are reconstructed by FFmpeg produced a 12-second video container with only about 1.94 seconds of audio.

R32 therefore changed the runtime contract for the experiment:

```text
RenderSpec.duration_seconds = total_frames / fps
canonical audio is pre-trimmed to that exact duration
final mux uses explicit duration
FAST mux does not infer canonical duration via -shortest
```

The second attempt then exposed a separate harness bug: the atomic AAC temporary file ended in `.tmp-PID` rather than `.m4a`, so FFmpeg could not infer the output format. The corrected implementation preserves the `.m4a` extension and atomically renames the finished canonical artifact.

Both failed attempts are retained as negative evidence; neither is part of the canonical performance result.

## Canonical result

GitHub Actions run `35137510744`, artifact `10463827470`.

Fixture: `river-station-paper-hook-first-vertical`, 1080x1920, seed 10, 2 Mbps H.264, exact 12-second RenderSpec duration.

Provisional audio identity:

```text
fwa1_d060f325334fa5874a26a99c5d82cf9183b773c072b5c9f525432b04f1ce7839
```

| mode | p50 full wall | p95 full wall | p50 mux | p50 CPU | p50 peak RSS | mean MP4 |
|---|---:|---:|---:|---:|---:|---:|
| baseline per-job AAC | 5.156 s | 5.354 s | 807.0 ms | 13.442 s | 1138.05 MiB | 1.41 MiB |
| canonical AAC cache miss | 4.981 s | 4.981 s | 78.9 ms | 12.252 s | 1139.20 MiB | 1.41 MiB |
| canonical AAC cache hit | 4.046 s | 4.057 s | 78.3 ms | 9.709 s | 1138.23 MiB | 1.42 MiB |

Steady-state cache hit saves:

- **1109.4 ms p50 full-job wall**;
- **21.5% of p50 full-job wall**;
- **728.7 ms p50 mux wall**;
- about **3.73 CPU-seconds p50** relative to baseline;
- with no material peak-RSS increase.

The explicit cache-miss audio preparation took 747.6 ms in that miss job. This is the correct first-use cost to account for; later jobs pay about 0.64 ms to verify and reuse the cached artifact before mux.

All result MP4s passed:

- exact 360 decoded video frames;
- AAC stream present;
- format/audio duration within 100 ms of the explicit 12-second RenderSpec duration;
- source-audio hash recorded;
- canonical audio artifact hash recorded for cached mode;
- explicit first cache miss and subsequent cache hits.

## Decision

**Promotion gate: PASS.** Canonical encoded audio survives full-job integration and materially improves both wall time and CPU, with no memory penalty in this workload.

The runtime recommendation is:

1. keep FFmpeg as the final stream-copy MP4 muxer;
2. stop AAC-encoding reusable source audio inside every video job;
3. make duration an explicit RenderSpec input rather than relying on `-shortest`;
4. represent canonical encoded audio by deterministic `audio_spec_id` plus artifact hash/provenance;
5. verify cached bytes before reuse.

R32 itself does **not** silently edit the I01 factory contract. This measured result earns a separate Integration decision/task to add explicit duration and canonical encoded-audio identity to the shared `RenderSpec` / Artifact contract.

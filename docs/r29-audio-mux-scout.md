# R29 — Audio/mux boundary scout

I02 measured the current WebCodecs `audio encode + MP4 mux` stage at roughly 0.67 seconds, about 16% of full job wall on the corrected same-scene 1080x1920 scout. R29 isolates that boundary before adding another mux implementation.

## Scout design

One 12-second 1080x1920 H.264 elementary stream is generated once outside the timed loop. One exact 12-second PCM WAV is also generated once. A canonical AAC/M4A artifact is encoded once before measurement.

The timed comparison is interleaved over 25 repetitions after warmup:

```text
A current_wav_aac_mux
H264 + WAV -> FFmpeg video copy + AAC encode + MP4

B cached_aac_copy_mux
H264 + canonical AAC/M4A -> FFmpeg video/audio stream copy + MP4

C video_only_mux
H264 -> FFmpeg video stream copy + MP4
```

Metrics: p50/p95 wall, child CPU, peak RSS, output bytes, ffprobe A/V duration, exact frame count and elementary video hash.

## Canonical result

Corrected GitHub Actions run: `35135924702`, artifact `10462919748`.

| path | p50 wall | p95 wall | p50 CPU | p50 peak RSS | MP4 | A/V delta |
|---|---:|---:|---:|---:|---:|---:|
| WAV -> AAC encode + mux | 500.3 ms | 562.5 ms | 500 ms | 61.77 MiB | 2.01 MiB | 0 ms |
| canonical AAC -> stream-copy mux | 53.8 ms | 63.4 ms | 50 ms | 61.79 MiB | 2.01 MiB | 0 ms |
| video-only stream-copy mux | 51.4 ms | 60.4 ms | 40 ms | 61.58 MiB | 1.79 MiB | n/a |

All validated video outputs contain 360 frames. Audio and video are exactly 12.000 seconds in the two A/V modes. The elementary video SHA-256 is identical across all three outputs.

## Finding

Canonical AAC removes **446.5 ms p50**, or **89.3%** of the current FFmpeg audio/mux boundary on this runner.

The crucial comparison is B vs C: adding an already encoded AAC track costs only about **2.4 ms p50** beyond video-only FFmpeg stream-copy mux. Therefore the expensive operation is AAC encoding, not the MP4 container mux.

Applying the same A->B ratio to I02's measured 666.9 ms audio/mux stage suggests roughly 595 ms of possible full-job reduction, but this is only a prioritization estimate. The real WebCodecs FAST path must be modified and re-measured end to end before using that number for production capacity or `$ / 100k` claims.

## Decision

**Keep FFmpeg as the STANDARD final muxer for now.** Its stream-copy residual is only about 54 ms and is below the 200 ms / 5%-of-full-wall scout gate.

**Do not add Mediabunny/in-process mux yet.** The scout does not justify another mux implementation.

**Promote canonical encoded audio to a deep-pass candidate.** The natural identity is conceptually:

```text
audio_spec_id
  = source audio identity
  + exact trim/timing
  + gain/fades/mix policy
  + sample rate/channels
  + AAC codec/bitrate/encoder policy

canonical_audio_artifact
  = encoded AAC/M4A bytes + hash/provenance
```

A `RenderSpec` can then refer to the canonical encoded audio artifact rather than paying AAC encoding cost per video. If audio timing or mix differs per creative, that produces a different `audio_spec_id`; caching must not silently reuse incompatible audio.

## Rejected first run

The first scout run used `-shortest` with timestamp-less synthetic Annex-B H.264. FFmpeg stopped audio muxing around 1.9 seconds while the final video track still represented 12 seconds. That run was rejected even though its timing looked attractive.

The corrected scout removes `-shortest` because both source fixtures are already exact 12-second assets and adds hard validation for A/V duration, frame count and elementary video hash. The result above is from that corrected run.

## Next pass

Integrate `audio_spec_id` / canonical AAC reuse into the real WebCodecs FAST path and compare current vs cached-audio end to end on the same production-shaped RenderSpec. Only after that deep pass should the factory contract or production cost model change.

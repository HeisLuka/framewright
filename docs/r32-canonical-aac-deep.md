# R32 — Canonical AAC artifact deep integration

R29 isolated a large FAST-path cost: encoding the same source audio to AAC for every video. On its validated 12-second mux fixture, `WAV -> AAC + MP4` cost about 500 ms p50 while `canonical AAC -> stream-copy MP4` cost about 54 ms. R32 asks whether that win survives a **full production-shaped WebCodecs job** and whether the identity/cache semantics are safe enough to promote.

## Workload

The deep pass uses the same C18 semantic workload as the I02 backend scout:

- `river-station`
- visual system `paper`
- structural variant `hook-first`
- vertical `1080x1920`
- seed 10
- 12 seconds / 360 frames / 30 fps
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
  + exact trim/timing policy
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

The runtime row also records a render-spec-like ID that includes the canonical encoded-audio hash when cached audio is used. This avoids silently treating different audio encoding policies as the same concrete render specification.

## Validation

Every output must pass:

- exact 360 decoded video frames;
- AAC stream present;
- format and audio duration within 100 ms of 12.000 seconds;
- output hash and bytes recorded;
- source-audio SHA-256 recorded;
- canonical audio artifact hash recorded for cached mode;
- cache miss is explicit on first canonical encode;
- subsequent cached jobs are explicit hits.

Metrics include full-job wall, browser launch/page-ready, WebCodecs encode, compressed upload, mux, cgroup CPU and process-tree peak RSS.

## Promotion gate

Canonical encoded audio clears this runtime deep pass if the steady-state cache hit saves at least 250 ms **or** 5% of full-job wall, while all media and identity checks pass.

Passing R32 does not silently edit the shared I01 factory contract. It earns a follow-up Integration decision to add canonical encoded-audio identity to `RenderSpec`/artifact semantics.

If the full-job saving collapses after integration, R29 remains a useful microbenchmark but no factory contract change is warranted.

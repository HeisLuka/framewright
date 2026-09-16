# R36 — artifact validation latency / pipeline overlap scout

## Why this exists

R34 measured a healthy warm c2/full-navigation runtime, but its synchronous post-mux validation is unexpectedly expensive: full `ffprobe -count_frames` averaged about 474 ms/job, and upload + mux + probe together were about 626 ms, roughly 18.6% of mean production-equivalent wall.

The goal is **not** to remove artifact integrity checks. The goal is to define the cheapest synchronous proof that the final MP4 contains the intended compressed media payloads, while moving expensive decode-oriented QA off the renderer critical path when evidence permits.

## Existing gate

The R34 gate runs `ffprobe -count_frames`, requires the expected video frame count, audio presence and duration tolerance.

Two caveats motivated this pass:

1. full frame counting is CPU-expensive on the hosted runner;
2. the existing acceptance logic does not fail on decoder errors written to stderr when `ffprobe` still exits 0 and reports the expected frame count. A corrupted payload can therefore preserve `nb_read_frames` and still pass the current policy.

## Candidate synchronous gate

R36 v2 tests a compressed-media identity chain with an explicit mux normalization boundary:

1. Chromium WebCodecs produces Annex-B H.264.
2. The browser SHA-256 hashes the exact raw compressed body **before localhost upload**.
3. Node hashes the received raw body and requires browser→Node equality.
4. Node also computes a normalized H.264 NAL-payload digest over the source stream.
5. FFmpeg stream-copies H.264 + canonical AAC into MP4.
6. Final MP4 validation runs in parallel:
   - metadata-only `ffprobe`: H.264 + AAC streams, dimensions, duration and container `nb_frames`;
   - stream-copy video extraction with `h264_mp4toannexb`, then the same normalized H.264 NAL-payload digest;
   - stream-copy audio extraction as ADTS, SHA-256 compared with the canonical AAC normalized hash;
   - final MP4 SHA-256 for Artifact identity.

### H.264 normalization boundary

The first CI attempt deliberately compared the complete source Annex-B SHA-256 with the MP4→Annex-B SHA-256. A valid reference failed. That is now recorded as a useful negative result, not hidden.

The reason is structural: MP4/AVC stores parameter sets in `avcC`, and mux/demux may legally relocate or reinsert SPS/PPS/AUD units. Complete raw Annex-B bytes therefore are not a stable identity across the MP4 container boundary even when the actual coded picture payload is preserved.

R36 v2 parses Annex-B NAL units and hashes the ordered NAL payload sequence while excluding only:

- SPS, type 7;
- PPS, type 8;
- AUD, type 9.

All VCL NALs and other coded payloads, including SEI, remain in the digest with type and length. A mutation inside a coded video packet therefore still changes the digest. Browser→Node transport continues to use the **full raw H.264 SHA-256** with no exclusions.

If v2 still fails on a good reference, the next action is to inspect the saved source/final NAL histograms and payload digests. Do not broaden the exclusion set merely to make the test pass; in particular VCL types 1–5 must never be excluded.

AAC remains simpler: the canonical M4A and final MP4 are normalized to ADTS and compared by exact SHA-256 because stream-copy preserves the AAC payload under the pinned path.

This compressed-byte gate does **not** prove that the encoder itself can never emit a semantically invalid but self-consistent bitstream. That is a different trust boundary. Decoder correctness remains part of periodic/deferred deep QA, renderer-version qualification, and final freeze/soak evidence rather than a silently removed requirement.

## Preflight evidence

Before CI, one real R35 MP4 showed:

- metadata-only probe: roughly 65–70 ms;
- `-count_packets`: roughly 60–75 ms;
- `-count_frames`: roughly 450 ms;
- canonical M4A→ADTS and final MP4→ADTS AAC SHA-256: byte-identical;
- metadata + video extraction/hash + audio extraction/hash executed in parallel: roughly 87 ms locally.

Corruption preflight also showed why packet count alone is insufficient: truncation is caught, but a payload mutation inside otherwise valid sample framing can keep all 360 packets. Exact coded-payload identity still catches it.

### First CI negative result

Run `35145971447`, artifact `10466961960`:

- syntax, fixture preparation and AAC staging passed;
- the produced reference MP4 was structurally healthy: 360 H.264 frames, AAC present, expected duration;
- AAC normalized identity passed;
- the reference failed the first fast validator because complete raw source Annex-B equality across MP4 mux was an invalid invariant.

This run is superseded by v2 but preserved as evidence for the container-normalization boundary.

## Canonical CI design

### Corruption matrix

Generate one real C18 WebCodecs + cached-AAC artifact, then inject:

- truncated MP4 tail;
- mutation inside a video packet payload;
- mutation inside an audio packet payload;
- missing audio stream.

Compare:

- current R34-style `count_frames` acceptance;
- normalized compressed-hash gate;
- strict decode with stderr as failure;
- packet-count process signal as observational evidence.

A good reference must pass every intended validator. The candidate fast gate must reject every injected corruption before adoption is considered.

### Realized throughput

Microbench wall savings are not enough because validator CPU can contend with Chromium/OpenH264. Run an ABBA comparison:

1. legacy validator, one complete 36-fixture C18 catalog cycle;
2. fast validator, one complete cycle;
3. fast validator, one complete cycle;
4. legacy validator, one complete cycle.

Every scenario uses:

- persistent Chromium within that run;
- c2 page workers;
- full document navigation per job;
- 3 Mbps WebCodecs target;
- canonical pre-encoded AAC;
- identical 36-fixture catalog composition.

Aggregate the two balanced runs per validator and compare videos/hour, p50/p95 job wall, p50/p95 validation wall, CPU/video, mux and encode timing.

## Decision gate

Adopt the fast synchronous gate only if all are true:

1. full raw browser→Node H.264 identity passes;
2. normalized coded H.264 payload and exact normalized AAC identity pass after mux on good artifacts;
3. every injected post-mux corruption is rejected;
4. good-artifact false rejects are zero in the 72-job fast sample;
5. realized c2 throughput improves by at least 10% versus the legacy gate.

If the gate passes, full decode/count becomes periodic/deferred deep QA rather than per-renderer-worker critical-path work. If corruption coverage or realized throughput misses the gate, keep the current synchronous policy and record the negative result.

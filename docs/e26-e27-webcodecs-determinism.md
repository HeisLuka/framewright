# E26-E27: WebCodecs determinism boundary

Product question: does the direct WebCodecs fast path preserve the renderer's deterministic contract all the way down to byte-identical H.264 output?

Short answer: no. The deterministic contract should apply to the render job, scene semantics and visual frames. The lossy WebCodecs H.264 bitstream is not byte-repeatable in the tested Chromium runtime.

## E26 — repeated encode with identical input

Canonical workload: `book-ad-v0`, 450 frames, identical template/runtime, frame numbers, seed and encoder configuration. Each profile was encoded three times in the same Chromium process.

### 720x1280 @ 1 Mbps

The three H.264 outputs had different SHA-256 hashes and different byte counts:

- 1,104,327 bytes;
- 1,097,871 bytes;
- 1,101,437 bytes.

Chunk layouts differed too.

### 1080x1920 @ 2 Mbps

Again all hashes differed, with output sizes:

- 2,027,126 bytes;
- 2,029,434 bytes;
- 2,026,625 bytes.

Hypothesis rejected: identical visual input does not produce a byte-identical WebCodecs H.264 bitstream, even within the same pinned runtime.

## E27 — bitrate mode and software preference

Four supported modes were tested at both resolutions, three repeats per mode:

- variable bitrate + `no-preference`;
- constant bitrate + `no-preference`;
- variable bitrate + `prefer-software`;
- constant bitrate + `prefer-software`.

None produced identical hashes, identical total bytes, or identical chunk shapes across repeated encodes.

At 1080, all mode timings remained in roughly the same 2.96-3.09 second range for 450 frames. At 720, the software-preference modes were sometimes slower. There is therefore no determinism justification for forcing `prefer-software`, and no obvious throughput reason from this experiment either.

## Contract decision

Split determinism into two levels.

### 1. Creative/frame determinism — required

The canonical identity is the immutable render input:

```text
render job
+ template/runtime version
+ asset identities
+ seed
+ frame number
```

That contract must continue to produce the same scene decisions and pre-codec visual frames.

### 2. Codec-byte determinism — not required for the mass-ad fast path

The generated H.264/MP4 bytes may vary between encodes even when the visual input is the same. Therefore:

- cache keys must not depend on reproducing the encoder's byte stream;
- once a successful final MP4 is produced, store and reuse that artifact;
- provenance should record the renderer/codec runtime version and encoding configuration;
- re-rendering is visual regeneration, not byte-level artifact reconstruction.

If a future legal/archive workflow requires byte-identical media reconstruction, build a separate pinned deterministic-encoding path and test it explicitly. Do not impose that requirement on the high-throughput advertising renderer unless the product actually needs it.

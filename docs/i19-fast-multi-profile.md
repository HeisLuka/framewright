# I19 — Canonical FAST executor multi-profile support

## Scope

I19 closes the physical format asymmetry in the existing FAST path. It does not add another renderer.

The canonical path remains:

```text
RenderSpec / DeliveryProfile
  -> run-video-factory
  -> render-factory-fast
  -> Chromium Canvas
  -> WebCodecs H.264
  -> canonical AAC stream-copy mux
  -> artifact + QA receipt
```

## Supported physical geometries

The first bounded production set is intentionally explicit:

- `1080x1920` -> `vertical`
- `1080x1080` -> `square`
- `1920x1080` -> `landscape`

Any other geometry fails closed in `render-factory-fast`. This is a capability boundary, not a general-purpose arbitrary-canvas promise.

## Ownership

I18 removed delivery selection from creative authorship. I19 therefore materializes delivery only at the physical factory boundary.

For each RenderSpec, the factory derives the bounded shape from exact `delivery.width` / `delivery.height` and writes a per-render scene payload containing:

- `delivery_profile`: `vertical | square | landscape`
- `delivery_width`
- `delivery_height`
- `platform_profile` when the DeliveryProfile declares platform UI provenance

The source creative payload and its `payload_sha256` remain unchanged. The per-render scene payload is execution materialization and gets its own observed SHA in the artifact receipt.

## No crop/stretch

Both WebCodecs execution paths encode the actual scene Canvas:

- the warm c2 pool already renders frame 0 before encoder configuration and configures H.264 from the actual Canvas dimensions;
- the one-shot fallback now follows the same rule and checks expected height from the RenderSpec instead of deriving `height = width * 16/9`.

The outer factory independently checks runtime dimensions and final ffprobe dimensions against the RenderSpec. Any mismatch fails the render.

## QA

Every successful receipt includes:

- `output-dimensions` with expected/actual width + height and bounded delivery shape;
- `delivery-scene-binding` with physical delivery fields and bound scene-payload SHA;
- existing frame-count, audio-stream, codec, platform-profile and factory-identity checks.

## Acceptance

`.github/workflows/i19-fast-multi-profile.yml` builds the current C27/C26 responsive template and one semantic creative, then expands it to three DeliveryProfiles. It reuses the I10 canonical runtime harness to execute:

1. one-shot physical renders;
2. warm c2 physical renders;
3. immediate cache replay;
4. a second physical warm run;
5. decoded one-shot vs warm visual parity at fixed checkpoints.

Additional I19 checks require:

- one creative identity across all three profiles;
- three distinct RenderSpec identities;
- exact 1080x1920, 1080x1080, and 1920x1080 MP4 dimensions;
- exact 270 frames / ~9000 ms;
- canonical AAC present;
- three distinct physical scene-payload hashes;
- first render cache miss, replay cache hit with exact artifact SHA;
- unsupported `1000x1000` geometry fails closed.

## Non-goals

No bitrate policy change, no codec selection change, no concurrency tuning, no recycle-policy change, no SPECIAL path, and no arbitrary aspect-ratio support. Full queue/package parity is I20.

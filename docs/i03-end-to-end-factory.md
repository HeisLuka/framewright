# I03 end-to-end video factory deep pass

## Why this pass exists

The first I03 proof established the basic factory spine on one silent generic vertical fixture:

`campaign request -> C19 package -> CreativeSpec/RenderSpec -> physical binding -> FAST executor -> MP4 receipt -> campaign manifest -> render_spec_id cache replay`.

That proof was necessary but not sufficient to close the current integration risk. Two contract fields could still exist only as metadata:

1. `delivery.platform_ui_profile` could change `render_spec_id` without changing the actual scene payload.
2. canonical audio identity had been validated contractually, while the physical I04 smoke used a silent RenderSpec.

The deep pass closes those two gaps on the current canonical C27/C26 creative stack.

## Bounded campaign

The fixture intentionally stays small:

- one verified C27 creative (`winter-map`, verified premise angle, early reveal);
- one selected creative and one reserve;
- one 9 second / 270 frame semantic timeline;
- two requested vertical delivery profiles: YouTube Shorts and Instagram Reels;
- one canonical AAC artifact shared by both RenderSpecs;
- current FAST runtime: Chromium Canvas -> WebCodecs H.264 `avc1.420028` at 3 Mbps -> FFmpeg stream-copy mux.

This is still vertical-only because the shared executor explicitly rejects non-9:16 geometry. Unsupported geometry must fail rather than silently render the wrong contract.

## Physical creative binding

The campaign fixture packages the exact C27 scene payload and generated cover used by the renderer. The cover is copied inside the template HTTP root because the browser renderer deliberately does not serve arbitrary parent paths.

Before execution, the factory verifies the base scene payload against `CreativeSpec.payload_sha256`. Template and cover identities are also content-addressed in the CreativeSpec.

Delivery semantics are applied *after* creative identity. The executor materializes `RenderSpec.delivery.platform_ui_profile` into a derived runtime scene payload. That preserves one creative identity across delivery profiles while ensuring Shorts/Reels do not merely receive different RenderSpec IDs for the same generic pixels.

The runtime receipt records a `delivery-platform-profile` QA check plus the SHA-256 of the bound scene payload. When multiple platform profiles are requested, the I03 manifest requires distinct bound scene-payload hashes and distinct final MP4 hashes.

## Canonical audio boundary

The fixture creates a deterministic source WAV, derives `audio_spec_id` from the exact source hash + 9s timing + mix policy + AAC policy, encodes one canonical AAC artifact, records its byte hash/provenance, and attaches that same canonical audio identity to both RenderSpecs.

The shared FAST executor verifies the AAC file hash before rendering, stream-copies the canonical audio into the final MP4 with the explicit RenderSpec duration, and records the `audio_spec_id` in QA. The end-to-end check requires an AAC stream, exact shared audio identity, 270 video frames and final duration within 40 ms of 9 seconds.

## Cache and artifact contract

For each RenderSpec the deep pass executes twice against the same artifact directory:

- first invocation must physically render (`cache_hit=false`);
- second invocation must hit the `render_spec_id` cache (`cache_hit=true`);
- cached replay must return the same MP4 SHA-256;
- receipt `invocation` remains schema-clean: only `cache_hit` and `attempts`.

The campaign manifest then exposes a deterministic artifact lookup keyed by `render_spec_id`, selected/reserve counts, physical delivery binding, audio identity and runtime QA/provenance.

## Acceptance

Pass only if all of the following hold:

- C19 emits exactly 1 selected creative, 2 RenderSpecs and 1 reserve;
- both RenderSpecs share the creative identity but have distinct `render_spec_id` values;
- Shorts and Reels produce distinct bound scene-payload SHA-256 values;
- Shorts and Reels produce distinct final MP4 SHA-256 values;
- both outputs contain 270 H.264 frames plus canonical AAC and are ~9.000s;
- both first executions pass runtime QA and miss cache;
- both immediate replays hit cache with identical artifact hashes;
- no reserve is rendered;
- no AI call exists in the per-video render path.

If platform-specific RenderSpecs produce identical bound payloads or identical artifacts, treat that as a real delivery-binding failure; do not weaken the gate. If canonical audio produces duration drift beyond the declared tolerance, inspect AAC timing/edit-list semantics rather than silently restoring `-shortest`.

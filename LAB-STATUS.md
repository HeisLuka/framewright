# Framewright Lab status

`main` stays the clean upstream baseline. `lab/framewright-research` is the persistent integration branch for confirmed lab work. Keep at most one active experiment PR; one-off branches are evidence, not merge queues.

Coordination source of truth: **Video Factory HQ** in Notion. New work uses track namespaces:

- `Cxx` — Creative / Product
- `Rxx` — Renderer / Runtime
- `Ixx` — Integration / Factory

Historical `Exx` numbers remain valid aliases and are not renumbered. The current GitHub E18 experiment is recorded operationally as **C18**.

## Canonical creative/product chain

1. E01 stage profiler
2. E02 payload-driven Book Ad workload
3. E03 browser-side WebCodecs probe
4. E04 encoder matrix
5. E05 warm worker / concurrency economics
6. E06 reproducible worker image / golden checks
7. E07 Node Canvas pinned-font parity
8. E08 browserless batch + raster-cover/layout QA
9. E09 pinned worker + 100-video soak
10. E10 4-vCPU concurrency matrix
11. E11 Swiss / Newspaper / Paper visual systems
12. E12 cheap element-level motion grammar
13. E13 deterministic creative router
14. E14 deterministic structural variant factory
15. E15 campaign identity / provenance / dedupe / bounded selection
16. E16 raster-only multi-format delivery rejection
17. E17 responsive semantic layout profiles
18. C18 / historical E18 responsive coverage for all structural variants

## Product results that matter

- E11: Swiss / Newspaper / Paper are materially distinct while staying in the cheap STANDARD visual class.
- E12: useful element-level motion costs only ~1–3% render throughput; bitrate grows more than CPU cost.
- E13: deterministic routing creates genuinely different system candidates per book; route scores are auditable priors, not CTR/CPA predictions.
- E14: same-style/same-seed structural remixing creates useful `hook-first / cover-first / title-first / hook-title` variants; a fake v1 variant was rejected by the diversity gate rather than lowering the gate.
- E15: 40 candidates -> 30 selected campaign creatives (3/book) + 10 reserves; stable semantic identity/provenance and deterministic package rebuild from an existing rendered pool.
- E16: post-raster `contain` / `cover` is not a production multi-format solution.
- E17: semantic reflow passes across Paper / Swiss / Newspaper and `vertical / square / landscape`: `9/9`, zero layout warnings, correct dimensions, long-title stress case readable. Result: `LAB-E17-RESPONSIVE-LAYOUT-RESULTS.md`.
- C18 / E18: all four structural variants now work across all three delivery profiles: `36/36`, zero layout warnings, canonical run `35127861148`, aggregate sequential `774.25/h`, peak Node+FFmpeg RSS `756.5 MiB`. The first run also exposed and fixed a useful provenance bug: `variant` was rendered correctly but dropped from `batch.json`. Result: `LAB-C18-RESPONSIVE-VARIANTS-RESULTS.md`.

## Runtime direction

Do **not** treat the old browserless result as the only STANDARD production backend anymore.

Two FAST candidates are live:

- **A — Chromium Canvas -> WebCodecs H.264 -> audio/mux.** R23-R27 found a major speedup relative to the old Chromium raw-RGBA/HTTP/x264 path and established that lossy WebCodecs H.264 is not byte-deterministic. This is the leading runtime candidate to productionize in R28.
- **B — pinned `@napi-rs/canvas` -> FFmpeg.** This remains the strong browserless reference/fallback: E09 100-video soak `651.74/h`, p95 `7.004 s`, peak RSS `726.3 MiB`; E10 c4 `771.15/h` on a constrained 4-vCPU worker.

Do not declare a final FAST backend winner from cross-experiment numbers. I02 must compare A vs B on the **same real BookPayload / assets / CreativeSpec / delivery profile / duration / audio / machine**.

SPECIAL remains separate: Canvas -> FramePacket -> native/GPU full-frame post -> encoder for CRT/heavy effects. Native/GPU work should target measured heavy post bottlenecks, not rewrite the scene DSL by default.

## Identity / determinism boundary

Use layered identity:

```text
creative_id
  semantic advertising idea

delivery_profile
  vertical | square | landscape

render_spec_id
  creative + delivery + renderer/encoder configuration

artifact / output_sha256
  one exact produced MP4
```

Semantic inputs, scene/layout decisions and Canvas frames should be reproducible. A lossy H.264 encoder is not required to reproduce the same bytes. If a canonical artifact already exists for a `render_spec_id`, return the stored MP4 rather than re-encoding in order to chase the same SHA.

## Current experiment

PR #29 / **C18** (historical alias E18, `lab/e18-responsive-variants`) completed canonical run `35127861148` and is ready to merge into `lab/framewright-research`.

C18 closes the last known vertical-only structural-layout hole: the custom title plate used by `title-first` / `hook-title` is profile-aware for vertical, square and landscape. Review sheets confirm native square/landscape title compositions and readable long-title Newspaper output.

## Next coordinated work

- **R28 — Renderer/Runtime:** productionize WebCodecs FAST command with real assets, audio/mux, bitrate policy, retries and stored canonical artifact.
- **I01 — Integration:** freeze the small machine-readable `CreativeSpec / DeliveryProfile / RenderSpec / Artifact` v1 contract. Do not invent a giant platform schema.
- **C19 — Creative/Product:** after C18 + I01, expand only the bounded selected campaign creatives into requested delivery profiles, preserving parent `creative_id`, QA and provenance. Do not render every reserve × every format.
- **I02 — Integration:** after R28 + C19, run the apples-to-apples FAST backend comparison.
- **I03 — Integration:** then prove one end-to-end video-factory request -> creative package -> requested profiles -> encoded/stored artifacts -> QA/provenance manifest.

A provider-specific cloud benchmark is not a prerequisite for I03. First prove the factory contract end-to-end.

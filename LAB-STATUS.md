# Framewright Lab status

`main` stays the clean upstream baseline. `lab/framewright-research` is the persistent integration branch for confirmed lab work. Operational coordination source of truth is **Video Factory HQ** in Notion.

Track namespaces:

- `Cxx` — Creative / Product
- `Rxx` — Renderer / Runtime
- `Ixx` — Integration / Factory

Historical `Exx` names remain valid aliases and are not renumbered. Independent tracks may work in parallel; keep at most one active PR per track and never claim the same question twice.

## Confirmed creative/product chain

1. E01–E10 — profiler, payload workload, encoder/runtime experiments, pinned worker, soak and concurrency
2. E11 — Swiss / Newspaper / Paper visual systems
3. E12 — cheap element-level motion grammar
4. E13 — deterministic creative router
5. E14 — structural variant factory
6. E15 — bounded campaign identity / provenance / dedupe / selection
7. E16 — reject raster-only multi-format adaptation
8. E17 — responsive semantic delivery profiles
9. C18 / historical E18 — responsive coverage across all structural variants
10. C20 — deterministic cover-adaptive art direction
11. **C21 — deterministic opening grammar / causal isolation**

## Product results that matter

- E11: Swiss / Newspaper / Paper are materially distinct while staying in the cheap STANDARD class.
- E12: useful element-level motion costs only ~1–3% render throughput; bitrate grows more than CPU cost.
- E13: routing produces genuinely different system candidates; route scores are auditable priors, not CTR/CPA predictions.
- E14: `hook-first / cover-first / title-first / hook-title` are useful structural variants; fake diversity was rejected rather than lowering the gate.
- E15: 40 candidates -> 30 selected campaign creatives + 10 reserves; stable identity/provenance and deterministic package rebuild from an existing rendered pool.
- E16: post-raster `contain` / `cover` is not a production multi-format solution.
- E17: semantic reflow works for `vertical / square / landscape`, including long-title stress cases.
- C18: all four structural variants work across all three profiles: `36/36`, zero layout warnings. It also exposed and fixed a provenance bug where `variant` was rendered but omitted from the batch report.
- C20: cover palette + luminance + entropy + edge evidence can drive contrast-safe, visual-system-specific art direction without AI. Final verification run `35133994670`: `72/72`, zero layout warnings, 36/36 unique palette signatures, no extraction failures, mean adaptive/generic cost ratio `1.0131`, p95 `1.0391`, peak RSS `779.9 MiB`. Manual review led to a Newspaper-specific refinement rather than globally forcing more colour. Result: `LAB-C20-COVER-ADAPTIVE-ART-DIRECTION-RESULTS.md`.
- **C21:** four no-AI opening grammars (`hook-led / cover-led / title-led / progressive-hook`) materially diverge during the first ~2 seconds and then exactly reconverge at 2.4s. Final canonical run `35136282583`: `40/40`, zero layout warnings, mean opening distance `0.092093`, minimum `0.037693`, convergence difference `0`, mean alternate-grammar cost ratio `1.0288`, p95 `1.0725`, peak RSS `778.2 MiB`. Exploratory background-RNG contamination was rejected. Alpha crossfade was rejected for ghosting; spatial wipe was rejected for sliced mixed-copy frames. Canonical transition is a one-frame editorial cut at ~1.8s. Result: `LAB-C21-OPENING-GRAMMAR-RESULTS.md`.

## Runtime direction

R28 productionized the leading FAST runtime candidate:

```text
BookRenderPayload / RenderSpec
  -> Chromium Canvas
  -> WebCodecs H.264
  -> audio + MP4 mux
  -> render_spec_id keyed canonical artifact cache
```

Canonical R28 evidence includes real cover/assets, audio/AAC mux, retries, exact frame-count validation and cache reuse. WebCodecs remains the leading candidate, not the final backend winner.

Pinned `@napi-rs/canvas -> FFmpeg` remains the browserless reference/fallback and parity oracle. I02 must compare the two FAST backends on one identical production workload before declaring a winner.

SPECIAL stays separate: Canvas -> FramePacket -> native/GPU post -> encoder for CRT/heavy effects. Do not rewrite the STANDARD scene DSL into Rust/Zig/C++ without a new measured bottleneck.

## Shared factory contract

I01 is complete. Machine-readable v1 boundary:

```text
CreativeSpec
  -> DeliveryProfile
  -> RenderSpec
  -> Artifact + QA/provenance
```

Identity layers:

```text
creative_id      = semantic advertising idea
render_spec_id   = creative + delivery + pinned renderer/encoder policy
output_sha256    = exact stored MP4 bytes
```

Lossy H.264 does not need byte-for-byte repeatability. If a canonical artifact already exists for a `render_spec_id`, reuse it rather than re-encoding to chase the same SHA.

Creative semantics such as `art_direction`, verified hook/opening provenance and motion profile belong in `CreativeSpec`; Runtime must not re-route or reinterpret them.

## Current priority

**C22 — motion quality v2** is the next Creative/Product experiment.

Goal: improve perceived motion quality without heavy full-frame effects or indiscriminate movement. Isolate choreography from layout/copy/art direction: coherent easing, stagger/reveal timing, one focal motion event at a time, deliberate settle windows, scene continuity and CTA emphasis.

Beat/onset synchronization, if tested, stays a separate controlled axis so its contribution is attributable rather than mixed into every motion change.

Then:

- C19 — bounded selected campaign -> requested delivery profiles (P2; packaging, not the current quality bottleneck).
- I02 — apples-to-apples FAST backend comparison once the stable production workload is ready.
- I03 — one end-to-end factory request -> campaign package -> requested renders -> stored artifacts -> QA/provenance.

Provider-specific cloud benchmarking is not the immediate bottleneck. Creative quality and measurable campaign learning are higher-value next work.

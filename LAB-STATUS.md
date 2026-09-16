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
11. C21 — deterministic opening grammar / causal isolation
12. C22 — finite motion choreography v2
13. C23 — deterministic cover-composition heuristics
14. C24 — adaptive organic duration + pacing
15. C25 — typography as a first-class deterministic axis
16. **C26 — platform-safe semantic layouts for organic vertical video**

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
- C21: four no-AI opening grammars (`hook-led / cover-led / title-led / progressive-hook`) materially diverge during the first ~2 seconds and then exactly reconverge at 2.4s. Final canonical run `35136282583`: `40/40`, zero layout warnings, mean opening distance `0.092093`, minimum `0.037693`, convergence difference `0`, mean alternate-grammar cost ratio `1.0288`, p95 `1.0725`, peak RSS `778.2 MiB`. Exploratory background-RNG contamination was rejected. Alpha crossfade was rejected for ghosting; spatial wipe was rejected for sliced mixed-copy frames. Canonical transition is a one-frame editorial cut at ~1.8s. Result: `LAB-C21-OPENING-GRAMMAR-RESULTS.md`.
- C22: finite semantic choreography replaces continuous E12 ambient drift with `entrance → settle → focal emphasis → settle`. Canonical run `35137597265`: `20/20`, zero layout warnings, settle-energy ratio `0.012684`, settle active-fraction ratio `0`, hook/CTA entrance ratios `1.174× / 1.151×`, mean wall ratio `1.0084`, p95 `1.0511`, mean MP4-byte ratio `0.9923`, peak RSS `733.6 MiB`. All 10 paired review sheets show calmer holds without dead entrances/focus/CTA. Result: `LAB-C22-MOTION-QUALITY-RESULTS.md`.
- C23: low-resolution luminance/variance/edge/entropy evidence can provide a conservative no-AI focal prior for cover crop and cover/text side. Canonical run `35140548685`: `36/36` covers analyzed, `72/72` paired videos, zero layout warnings, side decisions `5 left / 31 right`, zoom capped at `1.06×` with minimum source-area retention `0.89`. Mean adaptive/fixed wall ratio `0.9992`, p95 `1.0285`; mean byte ratio `0.9937`. Manual review of all swap cases and high-zoom stress fixtures passed. Result: `LAB-C23-COVER-COMPOSITION-RESULTS.md`.
- C24: the lab's old fixed `12s` duration is no longer a product assumption. Organic duration policy v1 chooses among `3 / 5 / 7 / 9 / 12 / 15s`, then allocates semantic plate dwell. Canonical run `35144806802`: `36/36`, zero layout warnings, zero audit errors, exactly 3 adaptive renders in each duration bucket. Mean adaptive duration `8.5s`, p50 `7s`; normalized render-ms-per-second ratio vs fixed-12 control mean `1.0151×`, p95 `1.0916×`; peak RSS ~`748 MiB`. Manual boundary review passed: `3s` is an intentional hook-only teaser with soft loop, `5s` is coherent hook→book without CTA, `15s` uses added time for heavy copy rather than dead hold. Result: `LAB-C24-ORGANIC-DURATION-RESULTS.md`.
- C25: typography is now a bounded CreativeSpec axis (`baseline / display-led / editorial / compact-dense`) rather than an implicit style accident. Canonical run `35144165706`: `40/40`, zero layout warnings, 4/4 distinct fitted typography signatures per book, text-ROI divergence mean `0.157755`, worst-book minimum `0.076324`. A first strict run exposed repeated `fitBlock` cost; a deterministic fitted-layout cache removed it with **40/40 MP4 files byte-identical** before/after the optimization. Final cost ratio mean `0.9942`, p95 `1.0095`; throughput `724.24 videos/hour`. Result: `LAB-C25-TYPOGRAPHY-RESULTS.md`.
- **C26:** organic YouTube Shorts / Instagram Reels / TikTok UI safety is now a versioned semantic delivery policy rather than a post-raster crop or a magic permanent pixel claim. Policy `c26-ui-safe-v1-2026-09-17` keeps source/date provenance and explicitly labels numeric rectangles as conservative Framewright policy. First audit found **66 genuine violations** (Swiss full-canvas CTA centering and historical Paper width/motion leakage); the gate was not weakened. Semantic fixes moved vertical centering to safe-rect center and clamped text measure to actual safe width. Canonical run `35147014543`: `24/24`, zero layout warnings, zero audit errors, zero critical text/cover-box violations. Platform p95 wall ratios vs generic: YouTube `0.9983×`, Instagram `0.9969×`, TikTok `0.9934×`; peak RSS `745.3 MiB`. Manual overlay review across short/long Swiss/Newspaper/Paper passed without collapsing the composition into a tiny center box. Result: `LAB-C26-PLATFORM-SAFE-RESULTS.md`.

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

Creative semantics such as `art_direction`, cover-composition evidence, verified hook/opening provenance, motion profile, typography system and duration/pacing plan belong in `CreativeSpec`.

Delivery semantics such as aspect ratio and **versioned platform UI profile** belong in `DeliveryProfile / RenderSpec` provenance because they can change output pixels without changing the creative idea. Runtime must not re-route, reinterpret or independently choose them.

## Current priority

The highest-value remaining C work is creative quality/catalog robustness rather than shaving renderer milliseconds. Strong next candidates are:

- catalog fatigue / repetition scoring across many books;
- deterministic beat/onset alignment as a separate controlled test with C22 choreography fixed;
- stronger non-AI hook source/provenance coverage across real catalog metadata;
- campaign-level diversity selection once enough real books are available.

Then:

- C19 — bounded selected campaign -> requested delivery profiles (P2; packaging, not the current quality bottleneck).
- I02 — apples-to-apples FAST backend comparison once the stable production workload is ready.
- I03 — one end-to-end factory request -> campaign package -> requested renders -> stored artifacts -> QA/provenance.

Provider-specific cloud benchmarking is not the immediate bottleneck. Creative quality and measurable campaign learning are higher-value next work.

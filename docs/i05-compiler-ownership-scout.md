# I05 Compiler Ownership Scout

## Question

Can the current creative stack compose the new C27 `NarrativePlan` with delivery-independent visual mechanisms, then bind platform/runtime realization later, without rewriting the renderer?

This is an ownership and identity experiment, not a renderer migration and not a performance claim.

## Why this exists

C26 carries `platform_profile` in `FRAMEWRIGHT_PAYLOAD`, while I01 already has `DeliveryProfile.safe_area_profile`. If the full runtime wrapper becomes `payload_sha256`, the same semantic creative is duplicated across platform deliveries.

C24 also invalidated the old assumption that a delivery aspect profile owns a fixed 12-second duration. I04 added top-level `RenderSpec.duration_ms`, but the long-term model should avoid duplicate duration ownership.

C27 now owns narrative semantics explicitly through `framewright-c27-narrative-plan-v1`: verified copy provenance, semantic roles, exact frame spans and reveal/CTA checkpoints. I05 therefore does **not** introduce another narrative planner.

## Probe model

```text
CanonicalBookPayload -> C27 NarrativePlan
          |                 |
          + visual mechanisms
                    |
                    v
        CreativeRealizationPlan
                    |
        + delivery/runtime/audio
                    v
              CompiledScene
```

`CreativeRealizationPlan` is deliberately narrow: canonical content identity + `narrative_plan_id` + proven visual mechanism versions. `CompiledScene` binds C26 safe-area policy and runtime identity. Experimental IDs (`fwcr0_` / `fwsc0_`) are not proposed public I01 IDs.

Until C27 lands, the scout uses a tiny C27-shaped fixture boundary with 5s/15s exact timelines. It does not duplicate C27 planning logic.

## Matrix

- 3 visual systems: Swiss / Newspaper / Paper
- 2 narrative fixtures: short 5s / long 15s
- 4 platform profiles: generic / YouTube Shorts / Instagram Reels / TikTok

Total mixed runtime wrappers: 24.

## Acceptance invariants

1. Mixed wrapper hashing produces 24 distinct hashes, demonstrating identity-leakage risk.
2. Canonical content hashing strips creative/delivery selectors and produces 6 content hashes.
3. The matrix produces 6 C27-shaped narrative identities, 6 creative realizations and 24 delivery-bound scenes.
4. Platform changes scene identity but not creative identity.
5. Runtime/encoder changes scene identity but not creative identity.
6. A proven visual mechanism change (typography system) changes creative identity.
7. Delivery owns geometry/fps/safe-area, not duration.
8. Creative duration/frame count comes from the narrative boundary and remains exact.
9. With a 12s source-audio assumption and no extension policy, exactly 12 long 15s realizations are blocked before render.

## Evidence boundary

Passing I05 does **not** prove pixel parity with the current HTML source-transform stack, and it does not validate C27 narrative quality. It proves only that the ownership split composes cleanly with C27 instead of competing with it.

The next deep pass is parity against current C26 semantic boxes/control frames using a real C27 `NarrativePlan` after C27 lands. Only after parity should string-based transforms be replaced gradually by typed compiler passes.

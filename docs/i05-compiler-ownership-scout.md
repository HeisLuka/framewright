# I05 Compiler Ownership Scout

## Question

Can the current C20-C26 creative stack be split into a delivery-independent creative identity and a delivery/runtime-bound realization without rewriting the renderer?

This is an ownership and identity experiment, not a renderer migration and not a performance claim.

## Why this exists

C26 currently carries `platform_profile` in `FRAMEWRIGHT_PAYLOAD`, while the I01 contract already has `DeliveryProfile.safe_area_profile`. If the full runtime wrapper becomes `payload_sha256`, the same semantic creative is duplicated across platform deliveries.

C24 also invalidated the old assumption that a delivery aspect profile owns a fixed 12-second duration. I04 is moving duration toward `RenderSpec.duration_ms`, but the long-term ownership should avoid two independent duration sources.

## Probe model

The scout keeps only two internal compiler levels:

```text
canonical content + creative mechanisms
                |
                v
          CreativePlan
                |
        + delivery/runtime
                v
        CompiledScene
```

`CreativePlan` contains content hash, explicit mechanism versions and the C24 semantic timeline. `CompiledScene` binds the C26 platform safe-area profile plus runtime identity. The IDs in this scout are experimental (`fwcp0_` / `fwsc0_`) and are not proposed public I01 IDs.

## Matrix

The fixture mirrors the C26 shape:

- 3 visual systems: Swiss / Newspaper / Paper
- 2 copy loads: short / long
- 4 platform profiles: generic / YouTube Shorts / Instagram Reels / TikTok

Total runtime wrappers: 24.

## Acceptance invariants

The scout must prove all of the following:

1. Hashing the mixed runtime wrapper produces 24 distinct hashes, demonstrating the identity-leakage risk.
2. Canonical content hashing strips creative/delivery selectors and produces 6 content hashes.
3. The matrix produces exactly 6 `CreativePlan` IDs and 24 delivery-bound `CompiledScene` IDs.
4. Platform changes do not change `CreativePlan` identity but do change `CompiledScene` identity.
5. Runtime/encoder changes do not change creative identity but do change scene identity.
6. A proven creative mechanism change (typography system) changes creative identity.
7. Delivery does not own `duration_ms` in the scout model.
8. The copied C24 policy resolves the short fixture to 5s (`74 + 76` frames) and the long fixture to 15s (`150 + 197 + 103` frames).
9. With a 12s source-audio assumption and no extension policy, exactly the 12 long 15s platform realizations are blocked before render.

## Evidence boundary

Passing I05 does **not** prove pixel parity with the current 11-pass HTML source-transform stack. It only proves that the ownership split is internally coherent and that known C24/C26 semantics can be represented without platform identity leaking into creative identity.

The next deep pass, if this scout stays green, is parity against current C26 semantic boxes/control frames. Only after parity should source-to-source transforms be replaced gradually by typed compiler passes.

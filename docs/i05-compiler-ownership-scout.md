# I05 Compiler Ownership Scout

## Question

Can the current creative stack be split around the real C27 `NarrativePlan v1` boundary into a delivery-independent creative realization and a delivery/runtime-bound scene without rewriting the renderer?

This is an ownership and translation-validation experiment, not a renderer migration and not a performance claim.

## Why this exists

C26 currently carries `platform_profile` in `FRAMEWRIGHT_PAYLOAD`, while the I01 contract already has `DeliveryProfile.safe_area_profile`. If the full runtime wrapper becomes `payload_sha256`, the same semantic creative is duplicated across platform deliveries.

C24 also invalidated the old assumption that a delivery aspect profile owns a fixed 12-second duration. I04 moved duration toward `RenderSpec.duration_ms`; the long-term ownership should avoid two independent duration sources.

C27 now provides the narrative boundary itself: verified copy provenance, semantic roles, exact frame spans and a stable `narrative_plan_id`. I05 therefore does **not** define a competing narrative planner.

## Probe model

```text
BookPayload
    |
    v
C27 NarrativePlan
    |
    + proven visual mechanisms
    v
Creative realization identity
    |
    + DeliveryProfile + runtime/encoder
    v
Compiled / delivery-bound scene
```

The IDs in this scout remain experimental and are not proposed public I01 IDs.

## Ownership scout

The synthetic ownership matrix mirrors the C26 delivery shape:

- 3 visual systems: Swiss / Newspaper / Paper
- 2 copy loads: short / long
- 4 platform profiles: generic / YouTube Shorts / Instagram Reels / TikTok

The gate proves:

1. 24 mixed runtime wrappers reduce to 6 canonical content identities and 6 creative realizations.
2. The same 6 creative realizations expand to 24 delivery/runtime scenes.
3. Platform safe-area choice changes scene identity, not creative identity.
4. Runtime/encoder choice changes scene identity, not creative identity.
5. A proven creative mechanism change such as typography changes creative identity.
6. Delivery owns geometry/fps/safe-area, not duration.
7. Exact duration/frame count is inherited from the narrative boundary.
8. With a 12s source-audio assumption and no extension policy, 15s realizations are rejected before render.

## Real C27 -> C26 translation validation

Canonical I05 CI run: `35150147829`. C27 source is pinned to commit `853a3c30a6c31afd5ef6f84e2ae20eda76fcef07` so the evidence does not move while C27 continues development. Canonical artifact: `10468154415`, ZIP digest `sha256:8adef5ea46292746afa24b55df0016a6627d860f2ca9ba18f258f1ac11531631`.

I05 independently rebuilds the current C26 stack, applies the real pinned C27 adapter, generates real C27 `NarrativePlan` objects, and compares semantic checkpoints.

### 5s short-form translation

Matrix: 3 visual systems x 4 platform profiles = 12 scenes. Hook and book-reveal roles are sampled at 18%, 50% and 82% = 72 checkpoints.

Result:

- translation gate: PASS
- safe-zone violations: 0
- unexpected candidate semantic events: 0
- settled cover/title geometry preserved: 24/24 checks
- strict pixel equality: 0/72 checkpoints, intentionally **not** the contract
- C27 book reveal starts 14 frames / 466.7 ms earlier than the current C24/C26 5s short schedule

The zero pixel-equality result is expected. C27 intentionally suppresses the legacy `/03` page counter and removes undeclared generic hook copy from the book-reveal plate. The useful invariant is preservation of shared semantic geometry and delivery safety, not preservation of obsolete pixels.

This also corrects the wording around “C24 compatibility”: C27 is compatible with the 3s/5s/7s+ **role grammar**, but its 5s pacing is not identical to C24. C24 short currently resolves to 74 hook + 76 book frames; pinned C27 uses 60 + 90.

### Full narrative delivery matrix

A real verified 9s five-role C27 plan (`winter-map / map-premise / early`) was then crossed with all three visual systems and four platform profiles.

Plan schedule:

- hook: 59 frames
- book_reveal: 68
- tension: 47
- desire_payoff: 47
- cta: 49
- total: 270 frames / 9s

Matrix result:

- scenes: 12
- sampled frames: 180
- captured semantic events: 876
- Swiss: 4/4 platform profiles pass
- Newspaper: 4/4 pass
- Paper: 4/4 pass
- generic / YouTube Shorts / Instagram Reels / TikTok: 3/3 systems each pass
- safe-zone violations: 0
- NarrativePlan mutation: 0
- role schedule drift: 0
- style/platform identity drift: 0

This closes a gap in C27's own renderer audit, which currently holds visual implementation to Swiss + generic while C27 develops the narrative mechanism.

## Observability debt exposed by translation validation

C25 text instrumentation currently records a bounding box even when C27 deliberately calls `textBlock('')` to remove undeclared body copy from book reveal. Geometry-only QA can therefore make an empty semantic node look present.

Future semantic capture should include at least:

- `semantic_node_id`
- role
- visibility / rendered-character count
- text hash or source/provenance ID
- bbox only when the node is materially rendered

This is a QA/provenance handoff, not a reason for I05 to modify C25 silently.

## Evidence boundary

I05 does **not** prove that C27 is pixel-equivalent to C26, and it should not be: C27 changes narrative timing and declared copy semantics. It proves a narrower and more useful property: the new narrative layer can be bound to existing visual systems and delivery policies while preserving shared semantic geometry, exact role scheduling, identity ownership and safe-area invariants.

Only after that boundary is stable should the 11-pass HTML source-transform stack be replaced gradually by typed compiler passes.

# I05 ownership / translation evidence v2

## Decision boundary

I05 proves that the canonical C27 `NarrativePlan` can remain delivery-independent while platform/runtime binding happens later, without breaking existing C26 semantic geometry and safe-area behavior. It is an ownership and translation contract, not a renderer migration.

The fresh v2 branch starts from the current `lab/framewright-research` tree and consumes the canonical C27 implementation already merged there. It does not fetch the historical C27 PR as a hidden dependency.

## Ownership contract

The scout keeps these invariants:

- canonical book content identity excludes delivery/renderer selectors;
- `narrative_plan_id` and creative mechanisms define the creative realization;
- platform safe-area choice changes compiled scene identity, not creative identity;
- renderer/encoder choice changes compiled scene identity, not creative identity;
- typography/mechanism changes creative identity;
- delivery owns geometry/fps/safe-area, not duration;
- exact duration/frame count come from the narrative boundary;
- invalid audio duration is rejected before render when no extension policy exists.

The synthetic matrix remains 3 visual systems × 2 copy loads × 4 platform profiles = 24 wrappers, expected to collapse to 6 canonical content identities / 6 creative realizations and expand to 24 delivery-bound scenes.

## Translation oracle

The current C26 stack is rebuilt, then the current canonical C27 adapter is applied. For the short translation matrix the contract is semantic, not obsolete-pixel preservation: safe zones, shared cover/title geometry, event ownership, exact total duration and declared C27 pacing differences are checked.

A full verified five-role C27 plan is then crossed through Swiss / Newspaper / Paper × generic / YouTube Shorts / Instagram Reels / TikTok. The matrix must preserve the NarrativePlan, role schedule, style/platform identity and sampled safe-area invariants.

## Static text compiler scout: preserved negative promotion evidence

The typed static-text lowering is intentionally kept as a subordinate experiment with its original promotion gate unchanged: `measureText` calls must fall by at least 25% in **every** visual system while maintaining exact sampled raster/semantic parity and order-independent plan generation.

Historical current-head run `35153485843` produced exact sampled correctness (`180/180` first-pass pixels, `180/180` replay pixels, `180/180` semantic captures) and deterministic plans, but failed promotion only for Newspaper:

- Swiss: 1135 → 636 `measureText` calls, −43.96%; wall 6108 → 6021 ms
- Newspaper: 4321 → 3668, −15.11%; wall 6144 → 6097 ms — **FAIL vs ≥25% gate**
- Paper: 1074 → 643, −40.13%; wall 6345 → 6325 ms

Artifact `10470550744`, ZIP SHA256 `5041513ec024f277fd69d17ab061ba2bc41ebc6d32d23e5fe308ef787df387a3`.

The v2 workflow does not weaken that gate. The static step may exit non-zero for a performance-only miss so downstream ownership/delivery evidence can still be collected, but a classifier then requires exact pixel parity, exact semantic parity, order independence and zero non-performance errors. A performance miss is recorded as `promotionPassed=false`; it is not silently converted into a pass.

## Promotion consequence

I05 ownership/translation can be accepted independently of the static-text optimization. Unless a current-base rerun clears the unchanged per-system 25% gate, do not productionize the static compiler path. Even a call-count pass is only permission for a later production-shaped runtime benchmark; it is not itself a throughput claim.

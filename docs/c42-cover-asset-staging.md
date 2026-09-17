# C42 — Cover and asset staging families v2

C42 adds six deterministic ways to stage the book cover while preserving the core trust boundary: every visible book image must come from the same server-owned `cover` asset identified by exact SHA-256.

## Families

- `stage_hero_cover_v2` — one dominant cover inside the C39 cover slot.
- `stage_partial_crop_detail_v2` — one clipped, enlarged view of the trusted cover.
- `stage_depth_stack_v2` — up to three layered instances of the same cover.
- `stage_edge_peek_v2` — one clipped edge-weighted cover treatment.
- `stage_repeated_card_motif_v2` — up to three repeated cards using the same cover bytes.
- `stage_floating_tilt_v2` — one inset cover with bounded deterministic tilt.

The repeated families do not create new imagery. They reuse the same `asset_id + sha256` several times.

## Trusted asset boundary

The resolver accepts only:

- `asset_id`;
- `kind = cover`;
- exact `sha256`;
- intrinsic width/height.

It rejects URLs, filesystem paths, prompts, generated-image asset kinds and unknown fields. No staging family is allowed to request a person, environment, background image or synthetic book art.

Every family is explicitly `single_asset_safe`. The only required asset kind is `cover`.

## Responsive staging

C39 owns the responsive `cover` slot. C42 only materializes one to three bounded placements inside that slot. A placement may contain:

- frame;
- bounded rotation;
- bounded content scale;
- opacity;
- deterministic z-order;
- a bounded crop descriptor for clipping families.

The staging family declares maximum instance count, rotation, scale and clipping policy. Final validation requires every placement frame to remain inside the C39 cover slot.

Cover intrinsic geometry is classified deterministically as `portrait`, `squareish` or `wide`; staging may adapt crop/focus to that class without changing the selected staging-family identity.

## C38 composition

C42 appends six cross-compatible `asset_staging` options to the C38 registry after C39, C40 and C41. Each option requires the trusted asset kind `cover` and supports all existing duration/aspect classes.

The acceptance checks both physical staging-state geometry and the higher-level C38 compatibility surface.

## Acceptance

The C42 gate covers:

- 6 staging families;
- 6 C39 structural layouts;
- 3 delivery aspect classes;
- 3 intrinsic cover-shape classes;
- deterministic state replay and content-addressed staging receipts;
- every placement inside the selected cover slot;
- family instance/rotation/scale/clip limits;
- deterministic seeded direction where used;
- one-cover fallback for every family;
- rejection of URL/path/prompt/non-cover inputs;
- cross-axis composition through the C38/C39/C40/C41 registry chain.

## Ownership and non-goals

C42 owns only the presentation of trusted cover bytes. C20/C23 cover analysis may inform future server-side selection policy, but C42 does not invent visual facts or synthesize missing assets. It does not own structural layout, typography, motion, narrative timing, delivery geometry or renderer implementation. Physical output diversity is proven later by C45.

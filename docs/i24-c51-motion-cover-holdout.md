# I24 — C51 seeded-direction symmetry + cover/content holdout

I24 tests whether the merged I23 pixel-to-affine C40 recovery generalizes beyond the single `winter-map` cover used to earn the first `6/6` top-1 gate.

The tested seam is:

`MP4 pixels -> I23 asset affine track -> C51 C40 registry fit -> hidden-ground-truth score`

No production compiler or renderer semantics change.

## Holdout matrix

The physical corpus is a balanced `6 x 6 = 36` matrix:

- six current C27 fixture books/covers: `city-seven`, `letters`, `long-title`, `observatory`, `winter-map`, `zero-hour`;
- all six current C40 motion families.

For every clip the following remain fixed:

- 9 s C27 intent narrative with early reveal and canonical CTA boundary;
- vertical 1080x1920 at 30 fps;
- `swiss` visual system;
- `layout_split_editorial_v2`;
- `type_editorial_hierarchy_v2`;
- `stage_hero_cover_v2`;
- `device_rule_pair_v2`;
- canonical FAST physical renderer.

Book identity, cover raster content/colors, title/author/copy, palette and per-book seed vary as nuisance factors. `motion_grammar` is the hidden target.

The experiment intentionally bypasses C49 production diversity selection because the matrix is a controlled scientific holdout. It still enters through a valid experiment-only C19 campaign request and renders through the canonical FAST path.

## Sealed boundary

I24 reuses the merged I23 observer unchanged. The observer sees only each MP4. It receives no source cover, payload, book ID, SceneProgram, TemplateVariant, seed or C40 label.

All 36 Phase A observation/inference attempts complete before the benchmark opens any source payload. Phase B then scores persisted results against hidden `template_scene_program.motion_recipe.family_id`.

Phase A errors are persisted per clip instead of aborting the matrix at the first failure, so a failed robustness hypothesis still leaves an interpretable by-book/by-family residual map.

## What the first holdout exposed

The first 36-video run was intentionally diagnostic and did not generalize perfectly: generic C51 produced `30/36` hidden top-1 before the root cause was modeled.

The failure was not arbitrary cover noise. Inspection of the real forward runtime showed a missing inverse equivalence: `restrained_parallax` and `rhythmic_cards` multiply horizontal translation and rotation by a deterministic seed-derived direction sign. C51 originally compared observations only against the `+1` realization, so valid `-1` renderings could be ranked as a different family.

This is a forward-model mismatch, not a reason to tune per-cover answer thresholds.

## C51 symmetry fix

C51 now treats direction sign as a latent variable only for the two renderer signatures that actually own this symmetry:

- `restrained_parallax`;
- `rhythmic_cards`.

For those families the fitter evaluates both `directionSign = +1` and `directionSign = -1`, keeps the lower-residual realization, and exposes the chosen sign as evidence. Other C40 families remain single-sign. Multi-channel observations must still agree on both family and seeded direction; disagreement remains an explicit abstention.

Contract acceptance adds synthetic positive/negative seeded realizations and an opposite-channel-sign disagreement case. The generic C51 residual and runner-up thresholds are unchanged.

## Physical result after the model fix

Re-running the same sealed 36-video corpus after the seeded-direction fix yields:

- Phase A completed: `36/36`;
- exact source identity: `36/36`;
- usable asset tracks: `36/36`;
- generic C51 accepted: `36/36`;
- hidden C40 top-1: `36/36`;
- top-3: `36/36`;
- MRR: `1.0`;
- mean motion coverage: `1.0`;
- forward identity/recipe leakage: `0`.

No observer-specific residual/margin calibration is promoted. The temporary `residual <= 0.08` / `margin >= 0.09` rule from the intermediate investigation is deliberately removed: after the correct symmetry model it rejects valid results without adding correctness.

## Interpretation boundary

I24 establishes content/cover robustness for the current pixel-affine observer under one fixed layout, staging family, aspect, duration profile and semantic timing shape. It does **not** establish arbitrary-video inversion.

The next useful nuisance tests are structural rather than cosmetic:

1. vary C39 layout while holding C40 family measurable;
2. vary delivery aspect/profile;
3. vary cover staging, especially repeated/depth-stack families where one connected component is no longer a sufficient asset model;
4. then perform reconstruction re-render and compare the recovered SceneProgram observationally rather than requiring source JSON identity.

The design rule remains: when the forward renderer has a real observational equivalence, model that equivalence explicitly; when evidence is insufficient, abstain rather than inventing a recipe.

# I24 — C51 motion cover/content holdout

I24 tests whether the merged I23 pixel-to-affine C40 recovery generalizes beyond the single `winter-map` cover used to earn the first `6/6` top-1 gate.

The tested seam remains:

`MP4 pixels -> I23 asset affine track -> C51 C40 registry fit -> physical-observer admission -> hidden-ground-truth score`

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

I24 reuses the merged I23 observer unchanged. The observer sees only each MP4. It receives no source cover, payload, book ID, SceneProgram, TemplateVariant or C40 label.

All 36 Phase A observation/inference attempts complete before the benchmark opens any source payload. Phase B then scores the persisted results against hidden `template_scene_program.motion_recipe.family_id`.

Phase A errors are persisted per clip instead of aborting the matrix at the first failure, so a failed robustness hypothesis still leaves an interpretable by-book/by-family residual map.

## First physical holdout result

Actions run `35251816034` completed all 36 sealed attempts and produced a valid asset track for every clip. Source identity and anti-leakage gates were `36/36` and `0` violations.

The important result is **not** perfect generalization:

- generic C51 state accepted `33/36`;
- hidden top-1/correct `30/36 = 83.3%`;
- top-3 `33/36 = 91.7%`;
- MRR `0.875`;
- mean motion coverage `1.0`.

Failure structure is specific rather than random:

- `scale_depth`, `editorial_cuts`, `staggered_type`, `directional_slide`: `6/6` top-1 each;
- `restrained_parallax`: `3/6` top-1; three difficult covers drift toward `editorial_cuts`;
- `rhythmic_cards`: `3/6` top-1; three difficult covers already abstain because residual is too high.

The three **incorrect accepted** parallax rows have fit residual about `0.152..0.155` and runner-up margin about `0.044..0.047`. In contrast, every one of the 30 correct accepted rows has residual `<= 0.077644` and runner-up margin `>= 0.095495`.

This creates an evidence-backed no-force calibration for the physical I23 cover observer:

- require C51 `state = accepted`;
- additionally require `fit_residual <= 0.08`;
- additionally require `runner_up_margin >= 0.09`.

On this calibration holdout the stricter physical admission yields:

- `30` admitted;
- `30/30` admitted correct;
- `0` false accepts;
- `6` abstentions.

This does **not** replace or loosen the generic C51 registry fitter. The physical thresholds belong to this observer and are explicitly marked `calibrated_on_this_holdout_requires_independent_validation`. They must survive a separate nuisance corpus before promotion beyond the I23/I24 experiment boundary.

## Interpretation boundary

The original I23 `6/6` single-cover result was real but too narrow. I24 shows that cover/content appearance can distort the component geometry enough to collapse parallax/rhythmic observations toward simpler families even when track coverage is 100%.

The correct response is abstention, not answer-key tuning and not a broader arbitrary-video claim. Next motion work should validate the calibrated physical admission on new books/covers and then vary layout/staging/profile. Reconstruction round-trip can proceed in parallel on clips that pass both C39 and calibrated C40 admission, while carrying low-confidence clips as unresolved rather than fabricating a recipe.

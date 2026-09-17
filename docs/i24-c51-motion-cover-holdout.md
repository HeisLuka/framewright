# I24 — C51 motion cover/content holdout

I24 tests whether the merged I23 pixel-to-affine C40 recovery generalizes beyond the single `winter-map` cover used to earn the first `6/6` top-1 gate.

The tested seam remains:

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

I24 reuses the merged I23 observer unchanged. The observer sees only each MP4. It receives no source cover, payload, book ID, SceneProgram, TemplateVariant or C40 label.

All 36 Phase A observation/inference attempts complete before the benchmark opens any source payload. Phase B then scores the persisted results against hidden `template_scene_program.motion_recipe.family_id`.

Phase A errors are persisted per clip instead of aborting the matrix at the first failure, so a failed robustness hypothesis still leaves an interpretable by-book/by-family residual map.

## First-run policy

This is a nuisance holdout, so the first run does **not** assume the I23 `6/6` single-cover accuracy automatically generalizes. Initial hard gates cover only experimental integrity:

- all 36 sealed Phase A attempts complete;
- physical source hashes match canonical FAST artifacts;
- every clip yields a measured asset track with at least five samples;
- zero forward identity/recipe leakage.

C51 accepted/correct/top-1/top-3/MRR are diagnostic on the first run and are broken down by book and motion family.

If the matrix is clean, promote the observed recovery level to a hard gate without changing C51 residual/margin thresholds. If it is not clean, improve only the pixel measurement or narrow the observable scope; do not tune the registry matcher to the answers.

## Interpretation boundary

Even a perfect 36/36 result would establish robustness to these six synthetic cover/content nuisance fixtures, not arbitrary external video. Later arms should vary layout/staging and delivery profile before using I23/I24 as evidence for generic reference-video motion extraction.

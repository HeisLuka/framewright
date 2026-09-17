# I23 — Physical pixel-to-C51 motion roundtrip

I23 closes the next physical seam after the merged I22 layout arm:

`MP4 pixels -> measured asset affine track -> C51 C40 registry fit -> hidden-ground-truth score`

It is an Integration experiment. It does not change C35/C27/C49/C19/I07/I03/FAST production semantics.

## Controlled source corpus

The source corpus is deliberately OFAT rather than production-diverse:

- one canonical 9 s C27 narrative/book/cover;
- vertical 1080x1920 at 30 fps;
- fixed `swiss` visual system;
- fixed `layout_split_editorial_v2`;
- fixed `type_editorial_hierarchy_v2`;
- fixed `stage_hero_cover_v2`;
- fixed `device_rule_pair_v2`;
- exactly one varied axis: all six current C40 `motion_grammar` families.

The corpus bypasses C49 diversity selection because C49 correctly rejects macro-identical batches. It still enters through a valid experiment-only C19 request and renders through the canonical FAST factory.

## Sealed pixel observer

`i23-observe-motion.mjs` accepts only an MP4 path. It receives no payload, cover PNG, SceneProgram, TemplateVariant, motion-family ID, or other forward metadata.

The observer uses the canonical C27 CTA boundary (82% of the 9 s timeline) as a declared public prior. The controlled early-reveal narrative guarantees the frame immediately before CTA has no cover, so that frame becomes a self-contained background reference. The final CTA frame provides the settled cover reference.

All frames are deterministically decoded to 270x480 RGB. The observer subtracts the no-cover reference, forms connected components, selects the tall cover-like component, and measures its geometry across the CTA role. From component center, covariance, principal extents, and orientation it derives a generic asset affine track:

- `dx`, `dy` in full-resolution renderer pixels;
- `scale` relative to the settled cover;
- `rotation_deg` relative to the settled cover.

Translation is solved against the same center-based affine ordering used by the C45 runtime. The observer emits only a `newboo-semantic-video-observation-v1` asset track plus coverage/residual notes. It never emits or reads a C40 label.

## Scoring boundary

`i23-motion-benchmark.mjs` preserves the sealed two-phase boundary:

1. Phase A persists every MP4-derived observation and C51 inference result before hidden truth is opened.
2. Phase B opens source payloads only to score the persisted results against `template_scene_program.motion_recipe.family_id`.

Forward SceneProgram/TemplateVariant identities and forward recipe fields are checked for leakage in the persisted inference output.

## First physical evidence

The first GitHub Actions physical run (`35251117114`) rendered six canonical FAST MP4s and recovered all six C40 motion families from pixels alone:

- source hashes exact: `6/6`;
- asset tracks observed: `6/6`, with `9/9` requested samples on every clip;
- C51 state accepted: `6/6`;
- correct hidden C40 family: `6/6`;
- top-1 correct: `6/6`;
- top-3 correct: `6/6`;
- mean reciprocal rank: `1.0`;
- mean motion coverage: `1.0`;
- forward identity/recipe leakage: `0`.

Representative top-1 fit residuals were `0.000000` for editorial cuts, `0.010404` for restrained parallax, `0.013110` for staggered type, `0.015620` for directional slide, `0.021448` for scale-depth reveal, and `0.050243` for rhythmic cards. The smallest observed runner-up margin was still `0.095495`, well above the unchanged C51 minimum margin of `0.025`.

This is a qualitative improvement over the earlier C50 scalar frame-energy probe: the controlled C50 motion OFAT reached only `2/6` top-1 and `4/6` top-3, whereas semantic affine measurement reaches `6/6` top-1 without changing the C51 matcher thresholds.

## Promoted acceptance gate

The controlled I23 benchmark now hard-gates all of the following:

- exact physical source identity;
- a measured asset track with at least five samples for every clip;
- zero forward identity/recipe leakage;
- `6/6` C51 acceptance;
- `6/6` correct hidden C40 family;
- `6/6` top-1 recovery.

Do not weaken C51 residual/margin thresholds to preserve this gate. Future failures should improve pixel-to-affine measurement or honestly expose a scope boundary.

## Scope boundary

I23 does **not** establish generic motion decompilation for arbitrary video. The promoted claim is deliberately narrower: controlled canonical 9 s vertical C27 output, `stage_hero_cover_v2`, split-editorial layout, one fixed cover/book, and the six currently registered C40 families.

The next useful experiment is robustness under nuisance variation while keeping the C40 family hidden: multiple covers/books first, then layout and delivery-profile variation. Only after those holdouts should the pixel observer be treated as a reusable external-reference motion extractor.

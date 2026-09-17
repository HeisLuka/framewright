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

The first physical run hard-gates only source-byte identity, minimum measured track coverage, and zero forward identity/recipe leakage. C40 accepted/correct/top-1/top-3/MRR metrics are diagnostic until the pixel estimator earns a promotion threshold. This prevents tuning CI to a desired label accuracy before observing real residuals.

## Promotion rule

Do not weaken C51 residual/margin thresholds to make I23 pass. If C40 recovery is weak, improve pixel-to-affine measurement while keeping the observer family-agnostic. Once controlled OFAT evidence is stable, promote the achieved recovery threshold to a hard gate, then attack less controlled production-shaped clips.

# I27 — C42 staging observability scout

I27 starts the next inverse boundary after layout and motion: cover staging.

The forward C42 vocabulary contains six materially different staging modes: hero cover, partial crop/detail, depth stack, edge peek, repeated card motif and floating tilt. Unlike C40 motion, this axis cannot be reduced to one affine track: some families contain one visible instance, some up to three, and some clip or crop the source asset.

The purpose of I27 is therefore **not** to declare a staging classifier. It tests whether a small content-independent geometric observation vector is stable enough across unrelated cover rasters to justify a typed staging ObservationIR.

## Physical matrix

The fixture renders `6 books/covers x 6 C42 staging families = 36` canonical FAST MP4s.

Held fixed:

- 9 s early-reveal C27 intent narrative per book;
- vertical 1080x1920 at 30 fps;
- Swiss visual system;
- split-editorial C39 layout;
- editorial typography;
- `motion_editorial_cuts_v2`;
- rule-pair graphic device.

Only book/cover content and C42 staging vary. Selection IDs use opaque book/stage indices. The controlled matrix is a valid experiment-only C19 request and intentionally bypasses C49 production diversity selection.

## MP4-only observation

Phase A receives only MP4 bytes.

Because motion is fixed to editorial cuts, the first CTA frame is a useful physical background plate: at local progress zero the asset and CTA are still at opacity zero, while the previous narrative role has already disappeared. The observer compares that frame with the settled final frame, avoiding the disappearing-text contamination encountered by earlier pre-CTA background subtraction.

At `0.25x` scale the observer computes a thresholded change mask and connected-component geometry. A wide lower component is treated only as an observable CTA-like nuisance and removed from the asset mask. No C42 family, SceneProgram, source cover or layout/staging metadata is available.

The descriptor contains only measured geometry/topology:

- asset/all connected-component counts;
- normalized union box and aspect;
- foreground fraction and union fill;
- largest/second/third component area fractions;
- centroid spread;
- normalized silhouette perimeter;
- x/y projection entropy;
- x/y projection peak counts.

These features are intentionally simple. If they do not separate the C42 families across different covers, the failure is evidence that the staging ObservationIR needs richer measurements such as repeated-instance correspondence, clipping evidence or image self-similarity.

## Hidden-truth evaluation

All 36 Phase A observations or errors are persisted before Phase B opens any payload.

The scorer verifies canonical source hashes and forward-identity leakage, then standardizes the unlabeled descriptor dimensions across the corpus. As a diagnostic separability test it performs leave-one-book-out nearest-neighbor evaluation: each target may choose only observations from other books, so matching the exact cover raster cannot solve the task.

The scorer reports:

- observation success count;
- leave-one-book-out 1-NN accuracy;
- per-book and per-staging accuracy;
- confusion matrix;
- nearest same-stage versus nearest other-stage distance and separation margin;
- feature means/standard deviations.

Classification accuracy is deliberately **not** a CI gate on the first run. Hard gates cover only experiment integrity: all 36 physical source hashes, all 36 Phase A attempts persisted, and zero hidden forward labels/identities in observations.

## Decision rule

A strong cross-book separation result earns a proper typed staging observation/fitter pass. A weak or structured confusion result should first change the measured representation, not tune an answer threshold against the six labels.

Likely ambiguous pairs to inspect physically include:

- hero cover vs floating tilt if rotation is lost in the silhouette;
- partial crop/detail vs edge peek if clipping evidence is not measured;
- depth stack vs repeated card motif if overlapping instances collapse into one connected component.

The larger inverse-compiler rule remains the same: observe first, infer second, and keep unexplained structure explicit rather than forcing a recipe.

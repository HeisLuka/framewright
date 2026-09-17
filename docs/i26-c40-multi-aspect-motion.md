# I26 — C40 multi-aspect physical motion holdout

I26 tests the next bounded nuisance axis after I25: delivery geometry.

`same book + same narrative + same layout/staging/style -> vary vertical|square|landscape x C40 motion -> MP4 pixels -> affine asset track -> C51 motion fit`

## Matrix

The fixture renders `3 x 6 = 18` canonical FAST MP4s:

- vertical `1080x1920`;
- square `1080x1080`;
- landscape `1920x1080`;
- all six current C40 motion families.

Held fixed: one early 9 s C27 book/cover, split-editorial layout, Swiss visual system, editorial typography, hero-cover staging and rule-pair device.

## Observer hypothesis

I23 was originally vertical-only. I26 keeps its connected-component/affine method but makes delivery measurement explicit:

- aspect is inferred from MP4 dimensions, not supplied by the fixture;
- every profile is decoded at exactly `0.25x` linear scale (`270x480`, `270x270`, `480x270`);
- translation is converted back to renderer logical pixels by the measured sample scale;
- transform origin remains the observed frame center;
- the I25 layout-neutral component rule is retained;
- no C39/C40 IDs, SceneProgram, payload or source cover enter Phase A.

The output remains a C51 semantic observation with the measured delivery aspect and an `asset` affine track.

## First-run policy

As with I25, first-run C40 accuracy is diagnostic. Hard gates only assert the experimental seam:

- 18/18 sealed Phase A completion;
- 18/18 source hash identity;
- 18/18 delivery-aspect recovery from MP4 dimensions;
- at least five affine samples for every clip;
- zero forward identity/recipe leakage.

Diagnostics report C51 accepted count, top-1/top-3/MRR and per-aspect/per-motion-family tables. A weak aspect remains visible rather than being repaired by threshold tuning.

If the scout is strong, the generalization belongs in the reusable I23 observer and should be promoted only with I23/I24/I25/I26 physical regressions. If it fails, the failure should be localized to pixel measurement versus C51 ranking before changing the matcher.

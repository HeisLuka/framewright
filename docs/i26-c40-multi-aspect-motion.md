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

I23 was originally vertical-only. The I26 scout kept its connected-component/affine method but made delivery measurement explicit:

- aspect is inferred from MP4 dimensions, not supplied by the fixture;
- every profile is decoded at exactly `0.25x` linear scale (`270x480`, `270x270`, `480x270`);
- translation is converted back to renderer logical pixels by the measured sample scale;
- transform origin remains the observed frame center;
- the I25 layout-neutral component rule is retained;
- no C39/C40 IDs, SceneProgram, payload or source cover enter Phase A.

The output remains a C51 semantic observation with the measured delivery aspect and an `asset` affine track.

## First physical run

Actions run `35262128155` rendered the full 18-video matrix through the canonical FAST path and then ran sealed MP4-only observation/inference.

Result:

- Phase A completed: `18/18`;
- canonical source identity: `18/18`;
- delivery aspect recovered from MP4 dimensions: `18/18`;
- usable asset tracks: `18/18`;
- hidden C40 top-1: `18/18`;
- top-3: `18/18`;
- MRR: `1.0`;
- forward identity/recipe leakage: `0`.

Per aspect:

- vertical: `6/6` top-1, `6/6` accepted;
- square: `6/6` top-1, `6/6` accepted;
- landscape: `6/6` top-1, `5/6` accepted.

The single abstention is landscape + `motion_rhythmic_cards_v2`: correct family rank 1, residual `0.173821`, runner-up margin `0.195246`, nine observed samples and full motion coverage. It remains an abstention; C51 thresholds are not widened.

## Promotion

The multi-aspect logic belongs in the reusable I23 observer, not an I26-specific duplicate. I26 therefore promotes the tested behavior into `i23-observe-motion.mjs`:

- canonical delivery aspect is inferred from MP4 dimensions;
- sample geometry is derived from a fixed `0.25` linear scale for all profiles;
- translation is restored to logical pixels from that sample scale;
- component tracking distance scales with observed frame geometry;
- layout-neutral asset-shape handling from I25 is preserved.

The temporary I26 observer is removed and the I26 benchmark switches back to the shared I23 observer.

Because this changes the shared measurement layer, promotion requires physical regression evidence from I23, I24, I25 and I26 on the same code before merge.

## Remaining boundary

After I26 the asset affine observation channel has physical evidence across:

- six current C40 motion families;
- six current C39 structural layouts;
- six different books/covers;
- vertical, square and landscape delivery.

The next meaningful structural nuisance is cover staging. Hero-cover is still the simplifying assumption. Depth-stack, repeated-card, edge-peek and other staging families can produce multiple/partial components, so a single largest connected component is not yet a sufficient generic asset model.

Other next steps remain:

1. cover-staging x motion physical inversion;
2. reconstruction re-render from recovered layout + motion and observational comparison;
3. C52 semantic-object observation using topology descriptors rather than per-family rendered exemplar retrieval.

The design rule remains unchanged: promote reusable measurements only after controlled physical evidence, model real renderer equivalences explicitly, and keep high-residual cases ambiguous rather than forcing a label.

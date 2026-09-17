# I25 — C39 x C40 physical joint holdout

I25 tests whether the MP4-only asset affine observer and C51 C40 fitter remain valid when structural layout changes.

The controlled hypothesis is:

`same book + same cover + same narrative + same staging/style -> vary C39 layout x C40 motion -> MP4 pixels -> asset affine track -> C51 motion fit`

This is an inverse-analysis experiment. It does not change production compiler or renderer semantics.

## Physical matrix

I25 renders all `6 x 6 = 36` current C39/C40 combinations:

- every current C39 structural layout family;
- every current C40 motion grammar family.

Held constant:

- one canonical 9 s early-reveal C27 book/narrative/cover;
- vertical 1080x1920 at 30 fps;
- Swiss visual system;
- editorial typography;
- hero-cover staging;
- rule-pair graphic device;
- canonical C19 -> FAST physical renderer.

Selection IDs use matrix indices rather than family names. The controlled matrix intentionally bypasses C49 production diversity selection; C49 is a production batch policy, while I25 is an experiment-only C19 request for identifiability evidence.

## Sealed boundary

Phase A enumerates rendered MP4 files by render-spec identity and invokes the pixel observer and I22/C51 inferer. It receives no source payload, C39 family, C40 family, SceneProgram or TemplateVariant.

Only after all 36 Phase A attempts have been persisted does Phase B open the payloads and score hidden `resolved_layout.family_id` and `motion_recipe.family_id`.

The scorer audits forward identity/recipe leakage exactly as the prior inverse arms do.

## First physical run: a real observer bug

The first run reused the merged I23 observer unchanged.

Result:

- physical render: `36/36`;
- Phase A completed: `18/36`;
- usable asset tracks: `18/36`;
- among the 18 measured clips, C51 motion top-1: `18/18`;
- forward identity/recipe leakage: `0`.

The split was exactly structural:

- `layout_split_editorial_v2`: `6/6` measured, `6/6` top-1;
- `layout_modular_card_stack_v2`: `6/6` measured, `6/6` top-1;
- `layout_centered_cinematic_v2`: `6/6` measured, `6/6` top-1;
- `layout_type_led_poster_v2`: `0/6` measured;
- `layout_cover_dominant_stage_v2`: `0/6` measured;
- `layout_quote_wall_v2`: `0/6` measured.

All 18 failures occurred before inference with the same error: `settled cover component not found`.

The cause was a false inverse assumption, not C51. I23 required a candidate connected component to satisfy a portrait aspect-ratio prior (`h / w >= 1.12`). But the renderer places the cover into C39 slots whose rendered geometry may be portrait, square or landscape. In particular, the three failing vertical layouts use wide cover slots.

The lesson is important for the inverse compiler: rendered slot geometry is an observation; it must not be confused with the intrinsic aspect ratio of the source cover asset.

## Layout-neutral measurement fix

The scout removed only the portrait-shape prior from component detection. It did not change:

- C40 registry semantics;
- C51 residual or margin thresholds;
- affine transform fitting;
- hidden-truth scoring;
- the physical fixture.

The observer now admits any substantial changed component with bounded minimum area/width/height and selects the largest settled component, then tracks later samples relative to that self-calibrated base.

## Second physical run

Actions run `35260984855` repeated the same 36-video matrix with the layout-neutral observer.

Result:

- Phase A completed: `36/36`;
- canonical source hash exact: `36/36`;
- usable asset tracks: `36/36`;
- hidden C40 top-1: `36/36`;
- top-3: `36/36`;
- MRR: `1.0`;
- mean motion coverage: `1.0`;
- forward identity/recipe leakage: `0`.

Per-layout top-1 is `6/6` for all six C39 families. Per-motion-family top-1 is also `6/6` for all six C40 families.

C51 accepts `33/36` and explicitly abstains on three clips even though the correct family remains rank 1:

- quote-wall + rhythmic-cards: residual `0.338656`;
- cover-dominant + rhythmic-cards: residual `0.229763`;
- quote-wall + scale-depth: residual `0.175060`.

Those abstentions are retained. I25 does **not** widen C51 thresholds to turn a perfect ranking result into a fake `36/36 accepted` result. High residual remains useful uncertainty evidence.

## Promotion

The proven fix belongs in the reusable I23 pixel observer, not in an I25-specific duplicate. The PR therefore promotes only the removal of the layout-specific portrait prior into `i23-observe-motion.mjs`, switches I25 back to that shared observer, and removes the temporary I25 observer copy.

Because the shared observer changes, promotion requires all three physical regression arms on the same PR head:

1. I23 six-family deconfounded motion roundtrip;
2. I24 36-video book/cover nuisance holdout;
3. I25 36-video C39 x C40 structural-nuisance holdout.

## Remaining boundary

I25 establishes strong evidence for one-cover hero staging in vertical delivery across all current C39 and C40 families. It does not establish arbitrary-video inversion.

The next structural nuisance tests should target:

1. delivery aspect/profile (square and landscape motion tracking);
2. cover staging, especially depth-stack/repeated-card families where a single connected component is no longer an adequate asset model;
3. reconstruction re-render using recovered layout + motion and observational comparison rather than source JSON equality;
4. C52 semantic-object observation using topology features rather than per-family rendered exemplar retrieval.

The design rule remains: remove false assumptions from the measurement layer, model real forward equivalences in the matcher, and abstain when residual evidence remains high.

# I25 — C39 x C40 physical joint holdout

I25 tests whether the merged I23 MP4-only asset affine observer and C51 C40 fitter remain valid when structural layout changes.

The hypothesis is deliberately narrow:

`same book + same cover + same narrative + same staging/style -> vary C39 layout x C40 motion -> MP4 pixels -> I23 asset track -> C51 motion fit`

This is not a new renderer capability and it does not change production compilation semantics.

## Why this test exists

I23 established `6/6` C40 top-1 in a deconfounded split-editorial fixture. I24 then tested content/cover nuisance and exposed a real forward-model equivalence: restrained-parallax and rhythmic-cards mirror horizontal translation and rotation by a seed-derived direction sign. After modeling that symmetry in C51, the same 36-video content/cover holdout reaches full generic recovery.

The next uncontrolled variable is geometry. The I23 observer is self-calibrated against the settled final cover rather than reading a C39 slot, but its foreground segmentation uses the frame immediately before CTA as background. Different layouts can change which disappeared/appeared components dominate that difference mask. I25 tests that assumption directly instead of declaring the observer layout-agnostic from code inspection.

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

Selection IDs use matrix indices rather than family names. The controlled matrix intentionally bypasses C49 production diversity selection; C49 is a production batch policy, while I25 is an experiment-only C19 request whose purpose is OFAT-style identifiability evidence.

## Sealed boundary

Phase A enumerates rendered MP4 files by render-spec identity and invokes the existing I23 observer and I22/C51 inferer. It receives no source payload, C39 family, C40 family, SceneProgram or TemplateVariant.

Only after all 36 Phase A attempts have been persisted does Phase B open the payloads and score hidden `resolved_layout.family_id` and `motion_recipe.family_id`.

The scorer audits forward identity/recipe leakage exactly as the prior inverse arms do.

## First-run policy

I25 is a hypothesis test, so motion accuracy is diagnostic on the first physical run. The hard gates are only integrity/observability gates:

- all 36 sealed Phase A attempts complete;
- all 36 source hashes match canonical artifacts;
- every clip yields at least five asset-track samples;
- zero forward identity/recipe leakage.

Reported diagnostics include:

- generic C51 accepted count;
- motion top-1/top-3 and MRR;
- mean motion coverage;
- per-layout and per-motion-family recovery tables.

A weak layout or a systematic confusion must remain visible in the artifact. The test must not tune C51 thresholds or hide failures merely to make CI green.

## Decision rule

If the existing observer remains strong across layouts, the affine track becomes a credible reusable pixel-to-semantic measurement channel and the next nuisance axis is delivery profile/aspect or non-hero cover staging.

If track extraction fails for specific layouts, the fix belongs in pixel observation: component segmentation/tracking must become layout-independent without receiving C39 truth.

If tracks are measured but C51 ranking degrades, inspect the forward transform model and observational equivalences before adding any empirical classifier or family-specific threshold.

The long-term target remains a shared semantic observation layer in which layout, motion and later C52 semantic objects are independently measured and then fused into an executable candidate SceneProgram with explicit ambiguity and residuals.

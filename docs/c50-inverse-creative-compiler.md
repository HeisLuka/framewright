# C50 — Inverse Creative Compiler v1

C50 adds the first constrained reverse path for the bounded template system.

Forward production remains unchanged:

`authoritative context -> C35 -> C27 -> C49 selection -> C19 -> I07/I03/FAST -> MP4`

C50 is an EXPERIMENT analyzer beside that path:

`MP4 -> ObservationIR -> bounded candidate inference -> benchmark scorer`

It does not recover author source code and does not claim that pixels uniquely identify a SceneProgram.

## Observed facts and inferred programs are separate

`newboo-video-observation-ir-v1` contains only facts extracted from the media file:

- source MP4 SHA-256;
- width, height, fps and duration;
- scene-change timestamps;
- sampled frame-difference energy;
- per-dimension observation coverage;
- explicit residuals.

It contains no TemplateVariant ID, SceneProgram ID, selector receipt, campaign provenance or trusted source metadata.

`newboo-inverse-creative-result-v1` is a second object. In v1 it recovers delivery facts, temporal cut observations and a ranked top-k over the finite C40 motion-family vocabulary. Unsupported axes remain `unresolved`; they are never silently guessed.

## Identifiability contract

A property is recoverable only when C50 has observable evidence for it. v1 deliberately does **not** infer:

- structural layout family;
- typography family;
- cover staging family;
- graphic device;
- visual system.

Those dimensions need additional spatial/appearance observers before they can become candidates.

Literal copy, original seed, internal semantic IDs, TemplateVariant identity and SceneProgram identity are not treated as recoverable from MP4 bytes.

## Motion inference

C50 imports the actual C40 registry. Every motion candidate must be one of those finite IDs.

For each C40 family, the matcher derives a deterministic normalized motion envelope from the family's `enter_fraction`, `settle_fraction` and text/asset/CTA transforms. It compares that model to sampled MP4 frame-difference energy. The output carries confidence, model error and method evidence.

This is intentionally a baseline, not a claim that global frame energy is sufficient to identify arbitrary motion. The physical round-trip benchmark measures where it collapses.

## Provenance sealing

The physical benchmark is split into two phases.

Phase A launches two child processes for each MP4:

1. `c50-observe-video.mjs --video ... -> ObservationIR`
2. `c50-infer-observation.mjs --observation ... -> InverseResult`

Neither process accepts a ground-truth path or SceneProgram argument.

Only after every inference result is persisted does Phase B open the physical payloads and canonical artifact manifest. The scorer can then compare the inferred result to hidden `template_scene_program` ground truth.

This separation prevents accidental receipt/provenance leakage from turning the benchmark into identity lookup.

## Physical benchmarks

C50 uses two complementary physical datasets. Both end in the normal `run-video-factory.mjs -> C19 -> FAST` execution path and therefore score real factory MP4s rather than output from a test-only renderer.

### Ecological production-selection batch

The ecological batch starts at C49. C49 selects physically renderable C43 variants under the real production diversity policy, materializes their ScenePrograms, and sends the selected rows through C19/FAST:

`C43 variants -> C49 selection -> C19 -> FAST MP4 -> C50 observer -> C50 inference -> hidden scorer`

This answers: how does the inverse baseline behave on a production-shaped batch where several template axes legitimately vary together?

### Controlled motion OFAT batch

The one-factor-at-a-time motion benchmark is intentionally **not** passed through the C49 selector. C49 correctly requires macro-axis distance and share caps, so asking it to select six variants with identical visual system, structural layout and asset staging would violate the production diversity contract.

Instead C50 creates six individually valid C43 ScenePrograms with the same narrative, book, cover, visual system, structural layout, typography, asset staging and graphic-device set. Exactly one axis changes: `motion_grammar`, once per current C40 family.

Those six rows are assembled as an experiment-only C19 campaign request with `selection_provenance` omitted rather than forged:

`fixed C43 base + six C40 motion families -> C19 experiment request -> FAST MP4 -> C50 observer -> C50 inference -> hidden scorer`

C19 explicitly permits campaign requests without selection provenance, so this keeps the physical compiler/renderer canonical without weakening or bypassing C49's production policy.

The controlled benchmark answers the narrower identifiability question: can the current pixel observations distinguish C40 motion when other template axes are held constant?

## Scoring

The scorer records per-video:

- observed MP4 hash vs canonical artifact hash;
- recovered delivery geometry/timing;
- true C40 motion family rank;
- top-1 and top-3 motion recovery;
- candidate confidence/model error;
- explicit unresolved axes;
- SceneProgram/TemplateVariant identity leakage.

Top-1/top-3 motion accuracy are diagnostic in v1, not promotion gates. Low accuracy is a useful result: it means the observation feature set is not expressive enough. Hard gates are source identity, delivery recovery, unresolved honesty and zero hidden-ID leakage.

## Why no second renderer

C50 does not implement a fixture renderer. Both benchmark paths use the canonical FAST renderer through C19. This matters because an inverse compiler that only understands a synthetic test renderer would not test the real system.

## Next capability layers

The next observation passes should be added only when benchmark evidence justifies them. Expected candidates are:

- foreground/background motion segmentation;
- coarse object/cover tracks and bounding boxes;
- transform fitting for translate/scale/rotation/opacity;
- text-block geometry and alignment;
- dominant palette/appearance observations;
- residual maps for unexplained frame area.

Each new observer should first improve recovery of a bounded existing axis. Unsupported visual behavior should stay residual and become evidence for future DSL expansion rather than being hallucinated into a recipe.

# C51 — Inverse observation fusion + registry fitting v1

C51 promotes the strongest I22 inverse scouts into a pure deterministic contract. It does **not** add pixel CV and it does not change the forward creative/factory path.

Boundary:

`measured semantic observations -> C39/C40 registry fit -> accepted | ambiguous | unsupported`

## Why this pass exists

C50 proved a sealed `MP4 -> ObservationIR -> inference` benchmark boundary, but global frame-difference energy is too weak to identify C40 motion reliably. The physical C50 artifact recorded motion top-1 `2/6` on controlled OFAT and `0/6` on the ecological production-shaped batch.

I22 then isolated a stronger representation: normalized semantic geometry and target-specific affine tracks. Its scouts show that the current typed forward DSL is separable once the pixel layer measures the same semantics the renderer owns. C51 makes that fitting rule explicit and reusable before further CV work.

## Semantic observation input

`newboo-semantic-video-observation-v1` accepts only measurements:

- delivery aspect;
- primary/secondary text anchors in normalized SAFE coordinates;
- cover and CTA boxes in the same coordinates;
- target-specific motion tracks (`asset`, `text`, `cta`) with normalized progress and observed translate/scale/rotation, plus optional opacity;
- observation coverage and residual notes.

The input rejects forward identities and inferred labels such as TemplateVariant, SceneProgram, CreativeSpec, RenderSpec, candidate/selection IDs, C39/C40 family IDs, visual-system IDs and other axis labels.

## C39 structural fit

Every current C39 family is resolved through the real C39 registry for the observed delivery aspect. The fitter compares measured channels to the renderer-owned slot semantics:

- text is an anchor, not a centered glyph bounding box;
- cover and CTA are regions;
- multiple channels are fused with a deterministic residual;
- a single text anchor is intentionally insufficient to force a family.

The result carries best residual, runner-up margin, evidence channels, candidates and an explicit state. High residual or a small margin produces `ambiguous` rather than a guessed layout.

## C40 motion fit

C51 imports the real C40 family registry and evaluates its typed transform trajectories directly. The primary intended physical channel is the cover/asset affine track; text/CTA tracks may corroborate it.

Per-family residual compares observed translate, scale and rotation against the typed trajectory at the same normalized progress. Optional opacity is accepted as evidence but is not required because encoded brightness is not a trustworthy direct source-alpha meter.

When multiple observed target channels prefer different families, the result is `ambiguous: channel_disagreement`; fusion never silently averages disagreement into a confident family.

## Deliberately unresolved axes

C51 does not promote:

- visual system;
- typography;
- asset staging;
- graphic devices;
- literal copy or original seed.

The I22 style scout still has profile confounding and asset-staging family inversion has not yet earned a promotion gate. Those axes stay unresolved until deconfounded physical evidence exists.

## Acceptance

The contract acceptance uses deterministic synthetic semantic observations with bounded noise, not hidden IDs:

- all six C39 families across vertical/square/landscape;
- all six C40 families using asset tracks;
- single-channel insufficient layout evidence abstains;
- midpoint layout blends can abstain on runner-up margin;
- conflicting asset/text motion channels abstain;
- unsupported motion residuals abstain;
- hidden forward identity injection is rejected;
- fused output is deterministic and keeps unpromoted axes unresolved;
- historical C50 contract acceptance reruns unchanged.

These tests validate the registry fitter, **not** pixel extraction. I22 remains the physical owner of `MP4 -> measured semantic observations -> C51 -> candidate recipe -> re-render` once the Integration lane is available.

# C43 — Template variant composer + compatibility compiler v1

C43 is the layer that turns the C38–C42 libraries into one usable finite design space.

## Two different identities

The composer deliberately keeps two stages separate:

1. `TemplateVariant` is profile-independent creative presentation intent.
2. `SceneProgram` is a concrete delivery-specific execution program derived after width/height/aspect/fps are known.

This follows the existing I17 ownership result: concrete scene geometry must not enter `creative_id` or profile-independent template identity. The same `template_variant_id` can therefore derive different SceneProgram IDs for vertical, square and landscape.

## Canonical registry

`buildCanonicalTemplateVariabilityRegistry()` installs the settled layers in order:

`C38 base -> C39 layouts -> C40 motion -> C41 typography/devices -> C42 cover staging`.

The result is one content-addressed registry snapshot. There is no second renderer or parallel template compiler.

## Explicit composition

`composeExplicitTemplateVariant()` accepts only the six C38 axes:

- structural layout;
- visual system;
- typography;
- motion grammar;
- asset staging;
- graphic devices.

C38 validates every option and compatibility requirement before a variant can exist. Unknown fields or incompatible legacy combinations fail closed.

This path is suitable for LLM-authored bounded JSON: the LLM chooses stable IDs, never code or raw style values.

## Automatic bounded composition

`composeAutomaticTemplateVariant()` is separate from explicit authorship. Its server-owned v1 policy contains finite candidate lists and exactly one selected graphic device.

The current lower-bound design space is:

`6 layouts × 3 visual systems × 6 typography × 6 motion × 6 staging × 9 devices = 34,992 variants`.

That is already far beyond the required useful bounded space, so v1 intentionally stays with one graphic device instead of inflating the combinatorics for a larger headline number.

Selection is a pure deterministic hash of:

- content-addressed policy ID;
- SHA-256 subject reference;
- integer seed;
- axis name.

The raw subject key is not emitted in the receipt. Same policy + subject + seed replays exactly. Outcomes, campaign evidence and performance metrics do not influence C43 selection; those belong to C30/C34 and later experiment policy.

## SceneProgram derivation

`deriveTemplateSceneProgram()` consumes an accepted TemplateVariant plus:

- immutable narrative projection and exact role/frame schedule;
- one delivery geometry;
- one trusted cover asset.

It resolves:

- C39 responsive slots;
- C41 deterministic typography fits;
- C40 motion family binding to the unchanged semantic schedule;
- C42 trusted-cover staging;
- C41 graphic-device geometry;
- visual-system ID.

The SceneProgram stores the exact semantic schedule and its SHA-256. Motion receives that same schedule fingerprint and cannot change interval boundaries.

The SceneProgram ID binds delivery geometry and trusted cover bytes. Changing delivery or asset bytes changes SceneProgram identity; neither changes `template_variant_id`.

## Acceptance

C43 requires:

- canonical registry replay;
- automatic policy validation and content-addressed policy ID;
- a large finite bounded design space; v1 proves 34,992 combinations;
- explicit key-order invariance;
- visible axis changes changing template identity;
- incompatible option rejection before render;
- broad deterministic automatic exploration over 1,000 subjects;
- raw subject key absent from receipts;
- same automatic input replaying byte-for-byte;
- one TemplateVariant deriving three distinct vertical/square/landscape ScenePrograms;
- exact semantic schedule preservation across all three;
- trusted cover SHA participating in SceneProgram identity;
- raw CSS/code injection rejected.

## Non-goals

C43 does not choose a “best” creative, optimize campaign traffic, create assets, change NarrativePlan semantics or implement anti-repeat batch policy. Batch-level diversity is C44. Physical 40-video proof is C45.

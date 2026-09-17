# C48 — Physical macro-aware 40-video batch acceptance

C47 added an explicit macro-separation constraint to batch selection. C48 verifies that the constraint reaches the canonical rendered pixels rather than existing only in selector metadata.

## Frozen corpus

The main corpus keeps content and delivery fixed:

- one canonical 9-second C27 NarrativePlan;
- one book and one trusted cover;
- one vertical DeliveryProfile;
- one creative seed;
- one bounded C43 candidate pool.

C47 v2 selects exactly 40 TemplateVariants. The same candidate pool and selector seed also produce a C44 v1 control receipt for descriptive policy comparison; only the v2 batch is rendered.

## Canonical physical path

Every selected v2 variant is materialized into its C43 TemplateSceneProgram and rendered through the existing path:

`C19 campaign → run-video-factory → FAST → WebCodecs → AAC mux → artifact + QA`

There is no C48 renderer fork.

## Role-aware checkpoints

C48 does not reuse C45's historical fixed wall-clock samples. It derives frames from the canonical semantic schedule and samples settled states for:

- hook;
- book reveal;
- CTA.

These checkpoints cover the moments where the initial macro axes are physically relevant. Asset staging, for example, is judged at book reveal / CTA rather than during tension where the cover may not be present.

## Pair acceptance

C47 default lookback is three. For every selected pair within that window, C48 requires:

- total categorical distance >= 3;
- macro distance >= 1 across `structural_layout`, `visual_system`, `asset_staging`;
- at least one role-aware checkpoint is physically non-identical.

Full-frame checkpoint SHA-256 provides the exact non-collapse gate. Downscaled 32×32 grayscale L1 and average-hash Hamming values are stored only as descriptive diagnostics; they are not combined into a score or ranking.

## Human review

The persisted review pack is ordered in exact batch sequence. Each card shows settled hook, reveal and CTA frames, the complete six-axis tuple and macro axes changed versus the previous item.

Reviewers may flag near-duplicates, weak macro expression, readability issues and weak composition. These flags remain separate observations rather than a universal creativity score.

## Replay and identity

C48 also requires:

- 40 physical artifacts with QA pass;
- 40 unique TemplateVariant, SceneProgram, payload, CreativeSpec and RenderSpec identities;
- invariant semantic schedule/copy;
- no visible debug/template identity watermark;
- exact second-run canonical cache replay (40/40 hits);
- reserve suppression.

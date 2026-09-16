# I10 — generalized experiment publication attribution

## Problem

I08 proved a safe publication/export round trip for C34 adaptive-selector arms. I09 then introduced a different experiment semantics: blocked publication opportunities from a C37 screening design.

Reusing I08 unchanged for I09 would be wrong. An I09 treatment is not a C34 `holdout / explore / exploit` arm, and attaching a fake lane merely to satisfy an existing schema would corrupt experiment provenance.

I10 introduces a shared attribution envelope that preserves the source experiment semantics instead of flattening them.

## Architecture

The pipeline is:

`source experiment plan -> I10 assignment set -> publication bindings -> C31 platform export ingestion -> unchanged C30 evidence + I10 attribution sidecar`

Two source adapters are implemented in v1:

- `C34 selector` — one assignment per non-zero selector arm;
- `I09 blocked` — one assignment per blocked publication opportunity.

Both adapters produce the same server-owned `framewright-i10-experiment-assignment-v1` shape, but their `assignment_kind`, unit and context remain distinct.

## C34 adapter

For a validated content-addressed C34 traffic plan, I10 emits one assignment per non-zero arm.

Preserved context includes:

- C34 arm ID as the source assignment reference;
- `lane`;
- requested planning basis points;
- the explicit boundary `planning_basis_points_not_observed_delivery`;
- prior snapshot / portfolio / primary-metric provenance;
- canonical creative and render identity.

The caller supplies the publication platform because the current C34 traffic plan is profile-specific but does not itself name a platform.

## I09 adapter

For a validated content-addressed I09 blocked publication plan, I10 emits one assignment per publication opportunity.

Preserved context includes:

- I09 assignment ID;
- C37/I09 treatment reference;
- block ID and replicate index;
- account and block context;
- slot ID / position / optional scheduled timestamp;
- platform-specific canonical render identity.

No `lane` is created. No C34 requested-share field is created. The source remains a blocked publication opportunity.

## Assignment set

`framewright-i10-experiment-assignment-set-v1` is content-addressed and contains:

- source kind;
- experiment / policy provenance;
- source plan ID;
- all normalized experiment assignments.

Every source assignment reference and generic assignment identity must be unique.

## Publication manifest

A publication binding may provide only:

- source assignment reference;
- platform campaign ID;
- placement ID;
- platform/source creative key;
- optional actual publication timestamp.

Experiment semantics, platform, canonical creative/render identity, treatment identity and assignment context are derived from the server-owned assignment set.

The caller cannot override those fields.

Unlike I08's all-arms fixture manifest, I10 supports **partial coverage**. This matters for blocked schedules: a 64-opportunity plan can begin returning attributed export data after the first publications instead of requiring every future slot to have executed.

The manifest records:

- planned assignment count;
- bound/executed assignment count;
- `complete | partial` coverage.

## C31 bridge

Platform exports remain platform-specific. I10 derives a C31 publication join for the requested export platform from the generic publication manifest.

C31 remains authoritative for:

- raw export SHA binding;
- adapter ID/version/source schema;
- row keys and windows;
- count metrics / denominator semantics;
- canonical C30 observation identities;
- fail-closed rejection of unbound rows.

I10 does not modify the C30 observation schema.

## Attribution sidecar

For every C31/C30 observation, I10 emits a content-addressed sidecar record carrying:

- source experiment kind and source plan ID;
- source assignment reference and generic experiment-assignment ID;
- experiment / policy identity;
- assignment kind and unit;
- treatment reference;
- original assignment context;
- canonical creative/render identity;
- platform/campaign/placement/source creative key;
- publication timestamp;
- source row key.

The output explicitly states:

`platform_export_counts_only_platform_controls_viewer_delivery`

This is observed platform count provenance, not proof of requested-share fidelity or viewer-level randomization.

## Backward compatibility audit

The synthetic C34 audit runs the same source-shaped export through both I08 and I10.

Required result:

- I10 emits the same canonical C30 evidence as I08;
- every I10 C34 assignment retains the same I08 lane and requested-bps semantics;
- hostile raw export columns cannot override canonical attribution.

I08 therefore remains valid historical/canonical C34 evidence while I10 becomes the shared envelope for later experiment types.

## I09 blocked-design audit

The I09 audit compiles the exact C37-derived treatment set into two complete publication blocks, one per fixture platform, then round-trips each platform export independently.

Required result:

- 16 generic blocked-opportunity assignments;
- 8 observations/attributions per platform export;
- canonical C30 evidence validates against the platform-specific creative/render portfolio;
- block / slot / treatment provenance survives;
- no fake C34 `lane` field appears;
- hostile export attribution fields are ignored;
- a partial 3-of-16 publication manifest is valid and explicitly marked partial.

## Interpretation boundary

A green I10 proves semantic-preserving attribution plumbing.

It does **not** prove:

- platform delivery fidelity;
- randomized viewers;
- equal or representative audiences;
- causal treatment effects;
- CTR/CPA/reading/purchase lift;
- optimal publication timing;
- that C34 adaptive routing and I09 blocked DOE should use the same analysis model.

Those questions begin only after actual publication and real platform exports exist.

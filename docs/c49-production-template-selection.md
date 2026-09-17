# C49 — Production template batch selection → C19 integration

## The missing boundary

C47 and C48 proved the macro-aware diversity selector and its physical behavior, but C19 begins *after* selection: callers already provide `request.selected` and `request.reserves`.

The older E15 campaign package does make a selection, but it belongs to the legacy E13/E14 lab path (`framewright-campaign-package-v1`, `hook-anchor-greedy-maximin-v1`). It is not the production owner for C43 TemplateVariants and must not be repurposed.

C49 therefore adds the canonical boundary immediately before C19:

`C43 semantic candidates → server-owned selector → ordered receipt → materialize selected only → C19 request`.

## Two-stage production flow

### 1. Semantic selection

`selectCurrentTemplateCampaignBatch(...)` accepts only bounded candidate IDs plus validated C43 `TemplateVariant` objects. It does not require payload files, ScenePrograms, MP4s or asset staging output.

Current generation defaults to the C47 macro-aware v2 policy. Policy is a server-owned function argument, not a field in candidate/LLM JSON. Candidate objects containing selector/policy override fields fail closed.

The result contains:

- content-addressed `selection_id`;
- complete v2 selection provenance and receipt;
- a stable sorted candidate-ID set;
- the ordered selected candidate IDs from the receipt.

### 2. Physical assembly

Only the selected candidates are materialized into normal C19 selected rows. `assembleC19TemplateCampaignRequest(...)` requires exactly one materialized row for every selected candidate and rejects missing, extra, duplicate or variant-mismatched rows.

It then:

- adds server-owned `selection_order` matching receipt order;
- derives every non-selected candidate as a reserve;
- attaches typed selection provenance;
- emits the existing `framewright-c19-campaign-request-v1` shape.

C19 remains the owner of CreativeSpec/RenderSpec compilation, not candidate choice.

## Legacy replay

C44 v1 is preserved through a separate API:

`replayLegacyTemplateCampaignV1(...)`

It requires a pre-existing valid C44 receipt and validates deterministic replay against the supplied candidate set. There is no `mode: legacy` flag on the current selection API and no silent v2→v1 fallback.

## Additive C19 metadata

C19 accepts two optional pieces of campaign-level selection metadata:

- `selection_order` on every selected row, when present;
- `selection_provenance` on the campaign request.

When selection order is present on the full selected set it must be unique and non-negative, and it controls package order. Requests without selection order retain the historical lexical `selection_id` ordering.

Requests without selection provenance produce the historical C19 package shape. Selection metadata is not part of CreativeSpec or RenderSpec identity, so adding/removing it does not change those IDs.

The canonical artifact manifest also surfaces optional selection provenance. Its delivery-package hash already binds the same provenance, while the explicit field makes the selector decision auditable without opening the package sidecar.

## Materialization economics

A production campaign may explore thousands of bounded C43 combinations. C49 intentionally selects semantically first and materializes only the chosen batch. The physical acceptance fixture generates over 1,000 semantic candidates but creates exactly six payload files for a six-item selected batch.

This prevents batch-diversity exploration from turning into unnecessary render/payload work.

## Security / trust boundary

The user-side LLM cannot select or weaken the diversity policy by putting any of the following into candidate JSON:

- policy IDs;
- selector mode;
- macro-axis definitions;
- thresholds;
- legacy fallback flags.

Those fields are not accepted by the semantic candidate schema. Current policy configuration is server-owned. Historical v1 replay is an explicit trusted operation over an existing receipt.

## Invariants

C49 changes no renderer, codec, C27 pacing or visual family. It preserves:

- C44 v1 historical replay;
- C47 v2 current macro-separation policy;
- C19 CreativeSpec/RenderSpec ownership;
- DeliveryProfile ownership downstream of creative identity;
- canonical FAST execution and cache semantics;
- reserve suppression.

# C30 — live campaign evidence and selector priors v1

## Question

C27/C29 can now produce truthful, controlled creative candidates and I03 can physically execute canonical RenderSpecs. The missing product loop is what happens after those variants receive real distribution.

C30 tests a deliberately narrow contract:

> Can live campaign observations update versioned selector priors without changing `CreativeSpec`, `RenderSpec`, renderer semantics, or artifact identity?

This is not a model for predicting virality. It is an auditable evidence layer between platform outcomes and future candidate selection.

## Boundary

The renderer remains deterministic and campaign-blind:

`Book/evidence -> creative policy -> CreativeSpec -> RenderSpec -> renderer -> artifact`

Live outcomes enter only after publication:

`artifact/placement -> platform export -> C30 CampaignEvidence -> versioned selector prior snapshot -> later campaign selection`

C30 must never rewrite a historical `creative_id` or `render_spec_id` because a campaign performed well or poorly. New selection behavior is represented by a new policy version / prior snapshot and can be replayed offline against the same candidate portfolio.

## Evidence contract

Each observation is bound to:

- an immutable `observation_id`;
- source platform + export identity;
- campaign and placement identity;
- canonical `creative_id` and `render_spec_id`;
- explicit observation window;
- one or more separately named rate metrics.

The first contract intentionally supports count/rate evidence only: `numerator / denominator + denominator_kind`. This keeps aggregation auditable and prevents silently mixing concepts such as starts, viewers, CTA actions and purchases.

Unknown creative/render identities are rejected. Duplicate observation IDs are rejected rather than silently double-counted. The same creative/metric may not change denominator semantics inside one snapshot.

## No aggregate viral score

C30 does not collapse behavior into one scalar score. The snapshot keeps separate posterior state for metrics such as:

- `hold_3s`;
- `completion`;
- `share`;
- `save`;
- `cta_action`;
- `downstream_open`.

A later selector may use a versioned decision policy over these dimensions, but the evidence layer does not pretend that their trade-offs are interchangeable.

The current v1 update uses independent Beta priors for bounded rate metrics. This is chosen because it is deterministic, additive and exactly replayable from counts — not because Beta means are assumed to be the final production ranking algorithm.

## Determinism and replay

For the same:

- candidate portfolio;
- evidence observations;
- learning-policy version;

C30 canonicalizes ordering and produces the same `prior_snapshot_id` from a SHA-256 of the normalized snapshot body. Reordering candidates, observations or metric-prior map entries must not change the output.

The snapshot records raw aggregated numerators/denominators and prior/posterior parameters, so a result can be independently reconstructed rather than accepted as an opaque learned weight.

## Synthetic audit boundary

The repository audit uses synthetic campaign observations only to prove mechanics:

- deterministic replay;
- order independence;
- duplicate-event rejection;
- unknown provenance rejection;
- denominator-semantics rejection;
- evidence changes posterior state for observed candidates;
- no-evidence candidates remain exactly at their declared prior;
- campaign learning cannot mutate creative/render identity.

Synthetic values do **not** demonstrate that any angle, hook, reveal timing or CTA is effective. Product evidence begins only when real publishing exports are attached to canonical campaign/creative/render identities.

## Production follow-up

The next live-data pass should connect real platform exports to this contract and preserve the raw source/export identifiers. Only after enough comparable observations exist should we test a bounded selector policy, ideally with explicit exploration and holdout traffic rather than greedily routing all future impressions toward the current posterior mean.

Offline replay should remain possible for every policy version: historical evidence is immutable; policy versions change, renderer behavior does not.

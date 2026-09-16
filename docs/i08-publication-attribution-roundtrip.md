# I08 — arm-aware publication attribution round-trip

## Question

C34 can compile a C30 prior snapshot into a deterministic selector plan with holdout, exploration and exploitation arms. C31 can bind raw platform-export rows back to canonical `creative_id` / `render_spec_id`. Those two boundaries are individually useful but incomplete together: C31's canonical C30 observation intentionally does not carry selector lane or arm identity.

That matters because the same canonical creative/render can legitimately appear in more than one experiment lane. The control creative, for example, can have both a holdout publication and an exploration publication. Joining later only on `creative_id` would collapse two different experiment exposures.

I08 asks:

> Can C34 arm identity survive publication mapping and C31 ingestion without changing the C30 evidence contract or trusting attribution fields supplied by the platform export itself?

## Important product correction: requested allocation is not observed organic delivery

C34 expresses a target allocation policy in basis points. For ordinary organic Shorts / Reels / TikTok publication, the factory does not choose each individual viewer who receives a post. Platform recommendation systems determine actual distribution.

Therefore I08 uses the term `requested_bps` deliberately:

- it is planning/allocation metadata from the C34 policy;
- it is **not** treated as observed viewer share;
- the publication manifest records `planning_basis_points_not_observed_delivery`;
- an attributed export records `platform_export_counts_only_no_requested_share_fidelity_claim`.

A real platform export is required before actual per-arm delivery volume or outcome rates can be measured. I08 does not manufacture that evidence.

## Publication manifest

`framewright-i08-publication-attribution-v1` is compiled from an exact content-addressed C34 traffic plan plus an external publication mapping.

The caller may provide only:

- `arm_id`;
- platform campaign ID;
- placement ID;
- platform/source creative key.

The caller may **not** provide `creative_id`, `render_spec_id`, `lane`, `requested_bps`, `traffic_plan_id` or `prior_snapshot_id`. Those fields are derived from the validated C34 plan. This prevents a publication adapter from silently re-labelling an experiment arm.

Every non-zero C34 arm must have exactly one publication binding. Unknown arms, duplicate arm bindings, missing arms and duplicate platform source keys fail closed.

Each binding carries:

- experiment / policy / traffic-plan / prior-snapshot / portfolio provenance;
- stable C34 `arm_id` and `lane`;
- requested planning basis points;
- canonical creative and render identities;
- platform / campaign / placement / source creative key;
- content-addressed `publication_binding_id`.

The full manifest is content-addressed as `i08m1_*`.

## C31 bridge

I08 derives the C31 publication join from its own validated manifest. A caller cannot pass a second independent join with conflicting canonical identities.

C31 remains authoritative for:

- raw export SHA binding;
- adapter platform/source-schema/version;
- row keys and observation windows;
- count metrics and denominator semantics;
- canonical C30 observation identity;
- rejection of unbound platform rows.

I08 does not widen the C30 observation schema. Instead it emits an attribution sidecar keyed by C31 `observation_id`.

## Attribution sidecar

`framewright-i08-attributed-evidence-v1` contains:

- the unchanged C30 evidence batch returned by C31;
- the unchanged C31 ingestion receipt;
- one attribution record per C30 observation.

Each attribution record carries:

- `observation_id`;
- `publication_binding_id`;
- experiment / policy / traffic-plan / prior-snapshot / portfolio provenance;
- `arm_id` and `lane`;
- requested planning basis points and their explicit non-observed semantics;
- canonical creative/render identity;
- platform campaign / placement / source creative key;
- source row key;
- content-addressed attribution identity.

This separation keeps C30 usable as a general metric-learning contract while preserving experiment provenance for later arm-aware analysis.

## Why observation ID is the join key

C31 sorts parsed rows by its explicit source row key before producing observations and preserves the resulting observation-ID ordering in its ingestion receipt. I08 independently normalizes those same adapter fields, sorts the source rows by the same row key, and checks one-to-one identity/campaign/placement agreement before attaching the sidecar.

If C31 changes this ordering contract later, the I08 regression must fail rather than silently misattribute outcomes.

## Synthetic integration audit

The I08 audit intentionally uses synthetic counts only to prove mechanics:

1. build six canonical C30 candidates and a C30 prior snapshot;
2. compile a real C34 plan;
3. enumerate its nine non-zero arms (`6 explore + 1 holdout + 2 exploit` for the fixture policy);
4. create one distinct platform publication key per arm;
5. create one source-shaped export row per publication;
6. ingest through the real C31 adapter/join/evidence path;
7. verify the unchanged result against C30 canonical validation;
8. attach I08 arm attribution by C31 observation ID.

The export rows deliberately contain hostile columns named `arm_id`, `lane`, `creative_id` and `render_spec_id`. They are ignored: canonical attribution must come from the server-owned I08 manifest and C34 plan.

A key positive check publishes `creative-1 / render-1` twice: once as holdout and once as exploration. Both observations keep the same canonical render identity while retaining different arm IDs and different platform source creative keys.

Negative gates cover:

- tampered C34 traffic-plan identity;
- missing arm publication;
- duplicate arm publication;
- unknown arm publication;
- duplicate platform source key;
- attempted injection of derived publication fields;
- export row not present in the publication manifest;
- raw export SHA mismatch;
- platform mismatch;
- tampered I08 manifest identity.

## Interpretation boundary

A green I08 proves attribution plumbing, not platform behavior.

It does **not** prove:

- the platform delivered C34's requested traffic shares;
- a holdout/explore/exploit arm received a representative audience;
- any creative caused an outcome difference;
- the selected primary metric is the right product objective;
- adaptive routing or fractional-factorial DOE improves campaign performance.

The next genuinely live step requires an actual raw platform export and its observed source schema. Only then can requested allocation metadata be compared with observed per-publication delivery and outcomes. C-H14 experiment design remains a separate layer on top of this attribution contract.

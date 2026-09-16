# C34 — bounded exploration/holdout selector v1

## Question

C30 made post-publication campaign evidence auditable and turned it into versioned per-metric prior snapshots. C31 made raw platform-export ingestion explicit and provenance-bound. The remaining failure mode is product-level: a selector could greedily route almost all future traffic to an early apparent winner and turn sampling noise into a self-reinforcing policy.

C34 asks a narrower question:

> Can campaign priors influence future variant allocation while preserving a frozen control holdout, a non-zero exploration floor for every candidate, deterministic replay, and immutable renderer identities?

This is a selector-contract experiment. It does not claim any campaign lift.

## Separation of concerns

C34 sits after creative generation and rendering:

`CreativeSpec / RenderSpec -> publish -> C31 export ingestion -> C30 prior snapshot -> C34 traffic plan`

C34 never edits `CreativeSpec`, `NarrativePlan`, `RenderSpec`, templates, pixels, audio, or runtime policy. A prior update may change only future traffic allocation.

## Policy v1

A selector policy declares exactly one `primary_metric` for one experiment. C34 explicitly rejects `metric_weights`, `objective_weights`, and composite-score inputs. Hold, completion, share, save, CTA, downstream-open and future metrics remain separate observations in C30; an experiment must say which one it is optimizing rather than hiding a business trade-off inside one synthetic score.

The policy also fixes:

- `experiment_id` and `policy_version`;
- opaque deterministic `assignment_seed`;
- one `control_creative_id`;
- `holdout_bps` out of 10,000 total traffic basis points;
- mandatory `exploration_bps_per_candidate`;
- `min_primary_denominator` before a candidate can receive exploitation traffic;
- `exploit_top_k`;
- `max_adaptive_bps_per_candidate`.

All budgets are integer basis points. The compiled traffic plan must sum exactly to 10,000.

## Allocation semantics

### Holdout

The holdout share always routes to the declared control creative. Holdout cohort membership is derived from `experiment_id + policy_version + assignment_seed + opaque subject key`, not from the current prior snapshot. Updating priors therefore cannot move a subject into or out of holdout while the experiment policy is unchanged.

### Exploration

Every candidate receives a non-zero exploration floor. Exploration cohort membership and exploration-candidate assignment are likewise independent of the current prior snapshot. A creative that currently looks weak still continues to receive bounded evidence.

### Exploitation

A candidate becomes exploitation-eligible only after its primary-metric denominator reaches the predeclared minimum. Eligible candidates are ranked by posterior mean, then denominator, then canonical creative ID for deterministic tie-breaking. Only the predeclared top K can receive exploitation traffic, and the per-candidate adaptive cap is enforced before a plan is accepted.

This use of posterior mean is a routing primitive, not a claim that posterior mean is the final product objective or an estimate of causal lift.

### Cold start

If no candidate clears the evidence threshold, C34 emits `mode=explore_only`. All non-holdout traffic remains exploration. The contract never labels cold-start traffic as exploitation merely because the budget must be assigned somewhere.

## Assignment receipt

The reference assignment function emits:

- experiment and policy version;
- traffic-plan and prior-snapshot IDs;
- lane: `holdout | explore | exploit`;
- stable arm ID;
- canonical `creative_id` and `render_spec_id`;
- a hashed `subject_ref`, never the raw opaque subject key;
- content-addressed assignment ID.

The arm ID is intended to survive into publication/campaign metadata so later platform exports can distinguish holdout/exploration/exploitation outcomes. C31 currently proves source-export ingestion mechanics, but the repository still contains no real platform export and no live arm-aware campaign result.

## Synthetic audit

The audit builds six canonical C30 candidates and two different prior snapshots, then compiles the same frozen C34 policy against both. It checks:

- exact 10,000-bps accounting;
- fixed 20% control holdout in the fixture policy;
- non-zero exploration for all six candidates;
- denominator gating before exploitation;
- per-candidate adaptive cap;
- candidate-order deterministic replay;
- unchanged holdout membership after prior changes;
- unchanged exploration membership and exploration creative after prior changes;
- changed exploitation assignments when priors materially change;
- pure explore-only behavior when all candidates are cold;
- raw subject keys absent from receipts;
- rejection of composite metrics, missing primary metric, unknown control, over-budget policy, insufficient cap, invalid top K, and empty assignment key.

The 10,000 synthetic subjects are only a deterministic assignment population used to exercise the contract. Their observed lane proportions are diagnostic, not campaign evidence.

## Interpretation boundary

A green C34 means the learning loop can change future allocation without changing the renderer and without erasing its own control/exploration evidence source.

It does **not** establish:

- the correct primary business metric;
- optimal holdout/exploration percentages;
- causal creative lift;
- platform delivery fidelity to requested traffic shares;
- statistical stopping rules;
- fractional-factorial campaign design across creative axes.

Those require real publication and export evidence. C-H14 fractional-factorial design remains a separate experiment-design layer; C34 is the allocation safety contract underneath later live learning.

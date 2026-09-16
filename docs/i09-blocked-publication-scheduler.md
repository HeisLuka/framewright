# I09 — blocked publication-opportunity scheduler

## Why this exists

C37 corrected C-H14's statistical budget: the current C29 global main-effects question needs an eight-creative screening design, not three to five. I08 proved that publication identity can survive a platform-export round trip, but also forced an important product correction: on an organic feed the factory does not randomize individual viewers.

The controllable experimental unit is therefore a **publication opportunity**: a backend-declared opportunity to publish one creative in a known platform/account/context slot before outcomes are visible.

I09 asks the next integration question:

> Can a selected creative design be assigned deterministically and evenly across explicit publication blocks without confusing publication randomization with viewer randomization?

## Input ownership

I09 does not invent a posting calendar. The caller provides explicit blocks and slots.

Each treatment declares:

- `treatment_id` — the experiment-level treatment identity;
- canonical `creative_id`;
- experiment axes/provenance;
- one canonical `render_spec_id` per platform that may appear in the supplied blocks.

Each publication block declares:

- `block_id`;
- contiguous `replicate_index`;
- platform;
- account identity;
- arbitrary server-owned block context;
- exactly one slot per treatment, with explicit slot ID, integer position and optional scheduled timestamp.

The backend therefore owns the nuisance-context definition. I09 only compiles a treatment assignment inside that declared structure.

## Complete-block v1 policy

I09 v1 intentionally supports complete blocks only.

For `N` treatments, every block must contain exactly `N` publication slots with positions `0..N-1`. Every treatment is then assigned exactly once in every block.

This has a useful statistical property: treatment identity cannot be perfectly confounded with a block intercept, because all treatments occur in every block.

Partial/incomplete blocks may be useful later, but they need a different missingness and balance policy. I09 fails closed rather than silently treating an incomplete schedule as equivalent.

## Deterministic cyclic position rotation

Treatments first receive a deterministic base order from:

`sha256(assignment_seed + treatment_id)`

For block replicate `r` and slot position `p`, the selected treatment is:

`base[(p + r) mod N]`

Consequences:

- every block contains every treatment exactly once;
- across `N` consecutive blocks, every treatment appears exactly once in every slot position;
- input array ordering cannot change the plan;
- repeated compilation with the same experiment inputs yields the same assignments;
- the scheduler does not inspect outcomes or C30 priors while compiling the blocked design.

This is positional balancing, not a claim that clock time, daypart, account state or platform distribution are irrelevant. Those remain block/context variables for later analysis.

## Platform-specific render identity

The same treatment may need different canonical RenderSpecs for YouTube Shorts, Instagram Reels, TikTok or another delivery profile.

I09 therefore binds the treatment's canonical `creative_id` to a platform-specific `render_spec_id` when compiling each publication opportunity. A block cannot compile if any treatment lacks exactly one RenderSpec for that block's platform.

RenderSpec IDs are also required to be unique across the supplied treatment/profile set. Reusing one canonical render identity for two distinct treatments would make later provenance ambiguous and fails closed.

## Output

`framewright-i09-blocked-publication-plan-v1` contains:

- experiment/policy/design provenance;
- normalized treatment and block definitions;
- deterministic base permutation;
- one content-addressed assignment per publication opportunity;
- canonical treatment/creative/render identity;
- block, platform, account, slot and optional schedule provenance;
- explicit exposure semantics:
  `publication_opportunity_only_platform_controls_viewer_delivery`.

The plan itself is content-addressed as `i09p1_*` and every assignment as `i09a1_*`.

## Synthetic audit

The audit consumes the **actual C37 exact eight-run screening design** rather than inventing a second treatment set.

It creates eight complete synthetic publication blocks with eight slots each:

- 8 C37 treatments;
- 8 blocks;
- 64 publication opportunities;
- alternating YouTube Shorts / Instagram Reels fixture contexts;
- four complete blocks per platform.

Gates require:

- the exact C37 selected treatment set;
- deterministic plan identity under reordered treatment/render/block/slot input arrays;
- every block contains all eight treatments exactly once;
- every treatment appears eight times total;
- every treatment appears four times on each fixture platform;
- across the eight blocks, every treatment appears exactly once in every slot position `0..7`;
- the platform-specific RenderSpec survives into each assignment;
- all assignment semantics stay at publication-opportunity level;
- content-addressed plan validation passes;
- fail-closed rejection for missing platform RenderSpec, duplicate treatment/creative/render/block/replicate/slot identity, replicate gaps, incomplete blocks, invalid slot positions/timestamps, and plan tampering.

The fixture timestamps are only provenance inputs used to test deterministic handling. I09 makes no claim that those hours or dates are good publication times.

## Important integration gap with I08

I08 currently models a C34 adaptive-selector publication manifest. Its attribution fields are specifically C34 `holdout / explore / exploit` arm semantics.

A C37/I09 blocked screening experiment has different treatment semantics. It would be incorrect to label I09 assignments as fake C34 arms merely to reuse I08 unchanged.

Therefore I09 stops at a canonical blocked publication plan. Before live blocked DOE, the publication-attribution layer must be generalized so that both adaptive-selector arms and blocked-design treatments can survive C31 export ingestion without semantic relabelling.

That is an explicit next integration task, not a hidden assumption.

## Interpretation boundary

A green I09 proves pre-outcome schedule mechanics only.

It does **not** prove:

- randomized viewer exposure;
- exchangeable audiences across publication opportunities;
- platform delivery fidelity;
- timing optimality;
- CTR/CPA/reading/purchase lift;
- causal treatment effects;
- absence of treatment-by-block or treatment-by-position interactions.

Live inference still requires actual publication execution, generalized attribution, real platform exports and an analysis model appropriate to the blocked design.

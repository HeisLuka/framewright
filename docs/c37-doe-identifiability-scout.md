# C37 — C-H14 DOE identifiability scout

## Why this scout exists

C-H14 proposes replacing a Cartesian creative matrix with a much smaller screening set, originally phrased as roughly `3–5 creatives`, then using real campaign outcomes to learn which creative axes matter.

That idea is directionally useful, but the run budget has to be checked against the actual statistical model before campaign data exists. Otherwise a deterministic factory can produce a perfectly reproducible experiment that is mathematically incapable of answering its stated question.

C37 performs that identifiability check on the current C29 controlled matrix.

## C29 is not a simple `3 × 2 × 3` crossed-factor model

C29 emits:

- 3 angle mechanisms: `premise / conflict / identity`;
- 2 hook candidates **inside each angle mechanism**;
- 3 reveal timings: `early / mid / late`.

The two hook candidates are not a universal binary treatment shared across angles. `premise hook 1` and `conflict hook 1` are different pieces of copy with no common semantic treatment called “hook 1”. Therefore the honest model treats hook as nested inside angle:

`angle + hook(angle) + reveal`

Reference-coded parameter count:

- intercept: 1;
- angle: 2 df;
- hook nested within angle: 3 df (one within-angle contrast for each angle);
- reveal: 2 df.

Total: **8 independent parameters**.

This corrects the tempting but wrong simplification `angle + common_binary_hook + reveal`, which would count only six parameters.

## Consequence for the original 3–5 run idea

A design matrix with `n` observations can have rank at most `n`. Therefore 3, 4 or 5 unique creative observations cannot have rank 8.

C37 still computes the maximum observed rank of 3-, 4- and 5-run subsets as a regression guard, but the impossibility follows directly from dimensionality. No weighting, Bayesian prior, clever hash assignment or D-optimal search can create missing independent observations.

**Decision:** reject the claim that `3–5` unique C29 creatives can identify all current C29 main effects.

This does not reject fractional-factorial / optimal-design thinking itself. It changes the required run budget or the scope of the question.

## Exact 8-run global main-effects screen

C37 enumerates all `18 choose 8 = 43,758` eight-run subsets.

For each subset it builds the nested main-effects design matrix with columns:

1. intercept;
2. `angle=conflict`;
3. `angle=identity`;
4. `premise hook 2`;
5. `conflict hook 2`;
6. `identity hook 2`;
7. `reveal=mid`;
8. `reveal=late`.

Only full-rank subsets are eligible. Among them C37 chooses the subset with maximum absolute design determinant, equivalent here to maximum determinant of the information matrix for the square 8-run design. Ties are resolved by:

1. lower deterministic level-balance penalty;
2. canonical lexicographic candidate IDs.

The audit additionally requires all six angle×hook concepts and all three reveal levels to survive into the selected design.

The result is a deterministic **main-effects screening design**, not a winner selector.

## What the 8-run design cannot answer

Eight runs are enough only for the declared additive nested main-effects model. They do not create degrees of freedom for creative-axis interactions.

If, for example, reveal timing behaves differently for each angle/hook concept, the additive screen aliases that interaction into its main-effect estimates. Interaction-rich questions require a larger design or a follow-up experiment.

C37 therefore records `interaction_policy = not estimated` rather than pretending a fractional subset identifies the full 18-cell response surface.

## A coherent strict 3–5 budget

A 3–5 run budget can be statistically coherent only after reducing the question.

C37 demonstrates one bounded option: fix one angle mechanism and test the `2 hooks × 3 reveal timings` subspace. The model is then:

`hook + reveal | fixed angle`

with:

- intercept: 1;
- hook: 1 df;
- reveal: 2 df.

Total: **4 parameters**.

An exact search over the six within-angle candidates finds a deterministic full-rank 4-run design. That small experiment can screen hook and reveal main effects **within that fixed angle only**. It says nothing about differences among angle mechanisms.

This is the general rule: a smaller campaign can test fewer degrees of freedom, not the same number of degrees of freedom by wishful compression.

## Organic publication boundary

Even a statistically identifiable creative matrix does not imply randomized viewer exposure on Shorts/Reels/TikTok.

For organic distribution the controllable experimental unit is a **publication opportunity**: a specific account/platform/time context in which the backend chooses which creative to publish. The recommendation platform then controls downstream viewer delivery.

Therefore a future live campaign must:

- define explicit publication slots/opportunities;
- block or stratify known context such as platform/account/time window;
- assign the selected C37 creatives to those opportunities before outcomes are visible;
- preserve the I08 arm/publication attribution through export ingestion;
- use actual observed platform counts, not requested C34 basis points, for analysis.

C37 does not yet implement the blocked publication scheduler. It establishes the creative-design identifiability boundary that such a scheduler must respect.

## Interpretation boundary

A green C37 proves only:

- the current C29 global main-effects model has rank 8;
- 3–5 observations cannot identify it;
- an exact deterministic 8-run full-rank screening subset exists;
- a 4-run screen is possible after fixing angle and narrowing the model.

It does **not** prove:

- any axis affects CTR, CPA, reading, purchase or retention;
- the additive model is true;
- the selected eight creatives are better creatives;
- platform audiences are exchangeable;
- publication times are unconfounded;
- causal effects can be estimated without blocked/randomized publication execution and real export data.

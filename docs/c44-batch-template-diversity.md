# C44 — Batch template diversity + anti-repeat policy v1

## Goal

Turn the C43 finite template design space into deterministic batches that do not collapse into visually repetitive output.

C44 is deliberately **not** a virality selector, aesthetic scorer, narrative planner or renderer. It never receives book copy, hook text, CTA text, facts or campaign outcomes. Its input is a finite set of already-valid `TemplateVariant` candidates.

## Explicit diversity constraints

The v1 policy is content-addressed and declares:

- minimum categorical distance across six axes;
- a bounded lookback window;
- unique full template tuples;
- maximum option share per axis in basis points.

Axes:

1. structural layout;
2. visual system;
3. typography;
4. motion grammar;
5. asset staging;
6. graphic devices.

Categorical distance is simply the number of axes whose selected option differs. No learned embedding, visual model or opaque scalar creativity score exists in this layer.

The default v1 policy requires distance >= 3 against each of the previous three selected variants. It also caps option concentration independently for every axis; the visual-system cap is looser because the current settled library has three visual systems while most other axes have six or more options.

## Determinism

Candidate input order is not authority. Every candidate receives a deterministic rank from `(seed, candidate_id)` and selection runs against that canonical ordering.

The output receipt binds:

- exact candidate-set hash;
- policy ID;
- seed;
- ordered assignments;
- per-transition categorical distance and component changes;
- final per-axis distribution;
- minimum observed transition distance;
- zero duplicate full tuples;
- content-addressed batch ID.

Same candidate set + same policy + same seed yields the same batch and receipt even when the candidate array arrives in a different order.

## Fail-closed behavior

C44 rejects:

- semantic-copy fields injected into candidates;
- duplicate candidate IDs;
- duplicate TemplateVariant IDs / full tuples;
- malformed or non-content-addressed policy;
- insufficient candidate pool;
- any candidate pool where the requested batch cannot satisfy the declared constraints.

It does not silently relax constraints, increase repetition caps or rewrite creative semantics to make the batch fit.

## Acceptance

The C44 CI builds a large synthetic candidate set through the real C43 bounded automatic composer, deduplicates exact TemplateVariants and requests a 40-item batch.

The gate requires:

- 40 selected variants;
- no duplicate full tuple;
- configured distance constraint across the full lookback window;
- every axis option below its declared share cap;
- exact replay;
- candidate-order invariance;
- seed-sensitive alternative batch;
- semantic-copy surface absent from output;
- hostile candidate injection rejected;
- impossible diversity policy rejected rather than relaxed.

C45 owns the next step: physical render proof and human review pack for the selected 40-video corpus.

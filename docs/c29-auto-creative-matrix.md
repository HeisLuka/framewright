# C29 - automatic angle x hook x reveal matrix

## Question

C27 proved that verified source material can be converted into BookEvidence, automatic mechanism groups, hook candidates and NarrativePlans without inventing visible book copy. C29 asks the next narrower question:

> When visual implementation, duration, CTA, seed and platform are fixed, do automatically constructed `angle mechanism x hook candidate x reveal timing` variants remain semantically distinct, render safely and produce reviewable final videos?

C29 is not an offline virality test. It is a controlled creative-mechanism matrix that prepares candidates for real distribution testing.

## Fixture

The lab uses the existing Russian demo book / cover `Архив ночного города` and a verified lab source pack. The source pack is deliberately richer than BookAdPayload and contains exact fixture sentences with explicit verification IDs and spoiler levels.

The automatic evidence layer is run with the BookPayload hook excluded from candidate discovery so the experiment measures source-pack discovery rather than reusing the legacy advertising hook.

The deterministic classifier yields the first three bounded mechanism groups in policy order:

- `premise`;
- `conflict`;
- `identity`.

Each group is required to contain exactly two distinct hook candidates. Every hook candidate has a verified tension source, so all six concepts can compile into the full 9-second grammar.

## Controlled matrix

The matrix is:

`3 angle mechanisms x 2 hook candidates x 3 reveal timings = 18 videos`

Controlled axes:

- angle mechanism;
- hook candidate within that angle;
- book reveal timing: `early`, `mid`, `late`.

Fixed axes:

- duration: 9 seconds;
- CTA treatment: `intent`;
- seed: `2901`;
- visual system: Swiss;
- typography: baseline;
- platform profile: generic;
- delivery: vertical;
- cover composition / motion / art direction: unchanged current C20-C27 stack.

This is intentionally not a factorial over visual styles. The experiment isolates semantic creative structure first.

## Semantic gates

Before any MP4 render, C29 requires:

- exactly 18 plans;
- exactly 3 angle types;
- exactly 2 visible hook candidates per angle;
- distinct hook copy within each angle;
- exactly 3 reveal variants per hook;
- strict `early < mid < late` reveal frame order for all six concepts;
- deterministic NarrativePlan replay;
- exact copy provenance through `resolveCopySource`;
- no evidence above spoiler level 1;
- no title or author identity before BOOK_REVEAL;
- duration, CTA and seed fixed across the matrix.

## Renderer gates

The current C20-C27 renderer is compiled without creative changes. C29 checks all 18 plans against that renderer before video encoding:

- exact NarrativePlan parity inside the renderer;
- exact plate schedule parity;
- C27 renderer contract identity;
- fixed Swiss/generic visual implementation;
- inherited C26 safe-zone capture across three sampled frames of every semantic role;
- zero safe-zone violations.

Final artifact gates require:

- 18 MP4 outputs;
- exact 270-frame / 9-second artifacts;
- zero layout warnings;
- 18 distinct output hashes;
- three distinct reveal outputs for every one of the six concepts.

## Human review surface

C29 produces one 900x1920 review matrix per angle mechanism. Each matrix contains six rows (`2 hooks x 3 reveal timings`) and five semantic checkpoints:

`HOOK | TENSION | PRE_REVEAL | REVEAL | END`

A separate hook-frame probe requires the two hook candidates to produce different pixels for each reveal timing (`9/9` controlled hook comparisons). This is only a machine sanity check that hook variation survives rendering; it is not a judgment that one hook is better.

## Interpretation boundary

A green C29 proves that the automatic source/evidence layer can create a bounded portfolio of materially different, truthful and render-safe organic-content candidates while holding visual confounds fixed.

It does not prove which angle earns distribution, which hook retains viewers, or which reveal timing drives book intent. Those questions require live publishing metrics such as early retention, completion, rewatches, shares/saves, profile/book clicks and downstream reading or purchase actions.

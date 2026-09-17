# C40 — Motion grammar families v2

C40 makes motion a bounded presentation grammar rather than a bag of random easing values.

The key ownership rule is strict: C27/NarrativePlan owns semantic role order and frame intervals. A C40 family receives only the already-selected semantic role, normalized progress inside that role, target kind and deterministic seed. It cannot insert, remove, reorder or resize NarrativePlan intervals.

## Families

- `motion_editorial_cuts_v2` — hard opacity cuts with no geometry drift.
- `motion_staggered_type_v2` — restrained vertical entrances for copy, cover and CTA.
- `motion_directional_slide_v2` — opposed horizontal copy/cover entrances.
- `motion_scale_depth_reveal_v2` — bounded scale/depth entrance.
- `motion_restrained_parallax_v2` — small opposed text/cover offsets with deterministic seeded direction.
- `motion_rhythmic_cards_v2` — bounded offset/scale/rotation choreography with deterministic seeded direction.

Every family is server-owned and versioned. The registry contains numeric bounds only; an LLM cannot author executable animation code.

## Motion state

`resolveMotionState()` consumes:

- `family_id`;
- semantic `role`;
- bounded target category `text | asset | cta`;
- `progress` in `[0,1]` inside the existing role interval;
- integer creative seed.

It returns deterministic `dx`, `dy`, `scale`, `rotate_deg` and `opacity`. All families settle to exact identity transform by progress `0.5` at the latest. From that point through the role end, C39 geometry is unchanged exactly.

This gives a simple readability invariant: the latter half of every semantic interval is a settled hold, while the first half may carry bounded entrance choreography.

## Bounded motion envelope

Registry validation caps motion to:

- `|dx| <= 80` normalized C39 units;
- `|dy| <= 80`;
- scale in `[0.8,1.1]`;
- rotation in `[-5°,5°]`;
- opacity in `[0,1]`;
- settle point no later than 50% of the role interval.

These are choreography bounds, not delivery pixels. Aspect geometry remains C39/DeliveryProfile-owned.

## C38/C39 composition

C40 appends six cross-compatible `motion_grammar` options to a C38 registry already extended with C39 layouts. The C40 acceptance composes:

`6 motion × 6 layout × 3 settled visual systems × 3 aspects × 6 durations = 1944` context checks.

Motion selection changes template identity through the C38 axis registry; changing downstream aspect/duration does not.

## Acceptance

The regression requires:

- six distinct versioned family IDs and signatures;
- deterministic replay of every sampled role/target trajectory;
- six distinct sampled book-reveal/cover trajectory fingerprints;
- exact settled C39 slot geometry from progress 0.5 through role end;
- semantic interval fingerprint unchanged after motion resolution;
- deterministic seed replay and a bounded seeded direction variation where declared;
- compatibility across all supported durations and aspect classes;
- no arbitrary animation code or second pacing grammar.

The trajectory fingerprints are deterministic state evidence, not a creativity or quality score.

## Non-goals

C40 does not require audio beat sync, physics simulation, per-frame LLM decisions, new semantic timing, codec/runtime tuning or a separate renderer. Physical multi-axis video acceptance remains C45 after C41/C42/C43/C44.

# C47 — Macro-aware batch diversity policy v2

## Why v2 exists

C44 v1 treats each changed template axis as one categorical unit. That is deterministic and useful for preventing exact/near tuple repetition, but C46 established that the axes do not operate at the same visual scale.

Controlled physical evidence showed:

- structural layout and cover staging produce macro composition changes;
- visual system changes overall art direction and remains materially visible;
- motion grammar is materially visible while motion is active, but is temporally scoped;
- typography and especially graphic devices are usually micro-level changes.

This is not a numeric quality ranking. It is an ownership distinction for anti-repeat policy.

## Additive versioning

C47 does not modify C44 v1. Historical v1 policy IDs, receipts and selector behavior remain reproducible.

C47 introduces:

- `newboo-batch-template-diversity-policy-v2`;
- `newboo-batch-template-diversity-receipt-v2`;
- `nbdivpol2_*` policy identity;
- `nbdiv2_*` batch identity.

## Macro separation

The initial v2 policy declares the server-owned macro axis set:

- `structural_layout`;
- `visual_system`;
- `asset_staging`.

Within the configured lookback window a candidate must satisfy both:

1. the existing minimum total categorical distance;
2. `min_macro_distance` across the explicit macro-axis set.

The default remains total categorical distance `>= 3` with lookback `3`, and adds macro distance `>= 1`.

`motion_grammar`, `typography` and `graphic_devices` remain real creative axes and still contribute to total categorical distance. They cannot, by themselves, satisfy the static macro-separation invariant in v2.

## Why not weighted visual scores

C46 produced L1/aHash descriptors as diagnostic evidence. C47 intentionally does **not** convert those values into hidden weights, a universal creativity score, or a family ranking.

Macro membership is an explicit, versioned product policy. It can be reviewed and changed in a future policy version without rewriting historical receipts.

## Determinism and fail-closed behavior

V2 preserves:

- deterministic candidate ordering;
- unique full tuples;
- per-option share caps;
- input-order invariance;
- exact replay validation;
- content-addressed policy, candidate-set and batch identities.

It rejects empty, duplicate or unsupported macro-axis definitions, impossible macro thresholds and forged policy/receipt identities.

## Acceptance counterexample

The regression suite constructs two valid C43 variants with identical macro axes but changes exactly three non-macro axes: typography, motion grammar and graphic device.

Under neutralized per-option caps, C44 v1 can accept the pair because total categorical distance is exactly three. C47 v2 rejects the same pair because macro distance is zero.

That counterexample captures the intended semantic difference between v1 and v2 without claiming that any individual family is better or worse.

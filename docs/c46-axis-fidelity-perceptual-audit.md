# C46 — Axis fidelity + controlled perceptual sensitivity audit

## Why this pass exists

C45 proved that 40 distinct typed template variants can travel through the canonical physical factory and produce valid MP4 artifacts with deterministic cache replay. It did **not** prove that every axis produces sufficient human-visible separation.

Two issues make the original C45 visual-distinctness evidence non-causal:

1. The C45 runtime painted the last eight characters of `template_variant_id` into every visible frame. Therefore unique PNG/MP4 hashes from that historical run cannot be used as proof of visual separation between template families.
2. The C45 batch deliberately varied many axes at once and sampled fixed wall-clock times (`0.75s`, `4.5s`, `8.15s`). On the canonical 9-second C27 plan those samples cover hook, tension and an already-settled CTA, but miss the book-reveal interval and most motion-entry states.

C45 remains valid physical-plumbing evidence. C46 owns controlled axis-fidelity and separation evidence.

## Runtime fidelity correction

C46 removes execution-time re-derivation where the typed contracts already resolved the state:

- C41 graphic devices are drawn from exact resolved `segments` carried in `TemplateSceneProgram`; the Canvas runtime no longer guesses anchor/geometry from device IDs.
- C40 family tokens are compiled into `motion_recipe` inside `TemplateSceneProgram` (`signature`, enter/settle fractions, and exact text/asset/CTA transform tokens). The Canvas runtime consumes these tokens and no longer owns a second hard-coded family table.
- No template/variant identity is painted into visible pixels. IDs remain metadata/audit state only.

## Controlled corpus

The C46 corpus is one-factor-at-a-time (OFAT):

- same book;
- same canonical C27 NarrativePlan and copy;
- same trusted cover bytes;
- same 9-second vertical DeliveryProfile;
- same seed;
- same values for every non-tested visual axis.

One explicit baseline tuple is compared with every alternate option on exactly one axis. With the current bounded registry this is 31 total physical cases: baseline plus 5 layout, 2 visual-system, 5 typography, 5 motion, 5 staging and 8 graphic-device alternates.

## Role-aware sampling

Frames are selected from semantic role intervals by normalized local progress instead of fixed seconds. The audit includes:

- settled hook;
- book-reveal entry, moving state and settled state;
- settled tension;
- settled desire/payoff;
- CTA moving state and settled state.

This makes motion and asset staging observable at the moments when they are supposed to differ.

## Diagnostic output

For each alternate option C46 records baseline-relative 32×32 grayscale pixel L1 distance and average-hash Hamming distance at relevant checkpoints, plus exact raw-frame equality. These are descriptive diagnostics only: C46 does not produce a universal creativity score, quality score, winner, or ranking.

The hard machine gate is intentionally narrow: an option may not be **exactly physically collapsed** into the baseline across every checkpoint relevant to that axis. Human contact sheets remain the evidence for subjective near-duplicate or weak-expression judgments.

## Invariants

C46 must preserve:

- identical semantic schedule hash and visible copy across the controlled corpus;
- profile-independent TemplateVariant ownership;
- canonical factory / RenderSpec / artifact QA path;
- exact second-run cache replay;
- reserve suppression;
- no codec/runtime throughput tuning and no C27 pacing changes.

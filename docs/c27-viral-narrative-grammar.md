# C27 - Sellable-angle + viral narrative grammar v1

## Product boundary

C27 does not attempt to predict virality offline. It turns a verified reason to care about a book into a deterministic semantic timeline that the renderer can execute later.

The product order is:

1. earn attention;
2. sustain a specific curiosity or identity/emotion mechanism;
3. reveal the book as the source/payoff;
4. optionally ask for an action.

The unit of creative is therefore not a visual template. It is:

`verified sellable angle -> NarrativePlan -> renderer -> artifact`

## No-AI / no-fabrication contract

C27 never writes free-form book copy. Every visible semantic atom must resolve from one of two trusted source classes:

- `book_payload_field`: exact full field, exact sentence, or exact character span from a permitted BookPayload field;
- `human_verified`: exact editorial text carrying a `verification_id`.

The planner can reorder verified atoms, assign them to semantic roles, allocate time, choose reveal position, and select a CTA treatment. It cannot invent a plot event, quote, factual claim, recommendation comparison, or promise.

`qr_slot` is only a reserved semantic affordance. QR generation, destination identity, and attribution are intentionally out of C27 scope.

## NarrativePlan v1

The planner emits a versioned plan with:

- stable `narrative_plan_id` over canonical semantic input;
- `angle.id`, `angle.type`, label and source metadata;
- exact duration, FPS and total frames;
- ordered semantic roles with contiguous frame spans;
- literal copy atoms plus provenance;
- `early`, `mid`, or `late` book reveal timing;
- CTA treatment;
- hook / pre-reveal / reveal / CTA / end checkpoints.

The initial semantic roles are:

`HOOK -> TENSION -> DESIRE_PAYOFF -> BOOK_REVEAL -> optional CTA`

The book reveal can move through the middle roles. It is not forced to frame 0.

For 7s+ full grammar the angle must provide verified `tension` and verified `payoff` sources. This prevents nominally different reveal modes from collapsing to the same semantic sequence.

## Compatibility with C24

C27 preserves the C24 duration semantics:

- 3s: hook-only teaser;
- 5s: hook -> book reveal, no explicit CTA role;
- 7/9/12/15s: full grammar with book reveal and optional explicit CTA.

The planner owns exact semantic frame allocation. The runtime should execute the plan rather than infer duration from media side effects.

## Phase A controlled matrix

The first fixture matrix uses six existing E08 books with two verified angle entry points per book and three reveal timings:

`6 books x 2 angles x 3 reveal timings = 36 NarrativePlans`

Visual system, typography, motion, cover treatment and delivery profile are intentionally absent from this first pass. C27 first proves the semantic contract before pixels can hide a bad narrative model.

For this lab fixture, angle text is constructed only from exact E08 hook sentences and exact BookPayload fields. Reordering is a controlled mechanism test, not a claim that these are production-quality hooks.

## Machine-verifiable gates

`c27-narrative-audit.mjs` checks:

- deterministic replay;
- exact copy provenance / no invented text;
- exact frame coverage with no gaps or overlaps;
- strict `early < mid < late` reveal start order;
- semantic divergence between the two angles beyond the opening hook;
- compatibility with all six C24 duration profiles.

A separate self-test exercises the planner without Chromium or FFmpeg.

## What this does not prove

Passing C27 does not prove that a video is viral, persuasive, attractive, readable in motion, or semantically honest enough for publication. Human review is still required for meaning and creative quality. Real retention, rewatches, shares, saves, CTA actions, and downstream book actions require live publishing.

The next renderer pass should therefore be controlled: take representative NarrativePlans, hold the visual implementation fixed, render hook / pre-reveal / reveal / CTA checkpoints, and inspect whether the semantic difference survives the visual system without introducing layout or readability failures.

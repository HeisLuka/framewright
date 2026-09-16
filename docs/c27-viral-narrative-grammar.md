# C27 - Sellable-angle + viral narrative grammar v1

## Product boundary

C27 does not attempt to predict virality offline. It turns a verified reason to care about a book into a deterministic semantic timeline that the renderer executes.

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

The semantic vocabulary is:

`HOOK -> required TENSION -> optional DESIRE_PAYOFF -> BOOK_REVEAL -> optional CTA`

The reveal can move through the narrative roles and its start frame is also explicitly targeted in time. On 7s+ profiles the desired reveal positions are approximately 22% / 40% / 57% of the clip for early / mid / late, clamped to feasible role minimums. This means a truthful two-beat angle can still have distinct mid and late reveal timing without inventing a third sentence.

A structured `title` or `author` atom is forbidden before `BOOK_REVEAL`. This preserves the product meaning of reveal timing: late reveal means the book identity itself has not already leaked through a nominal payoff beat.

## Two useful failed assumptions

The implementation caught two cases of fake experimental diversity before merge:

1. With only one middle beat, a sequence-only planner made nominal `mid` and `late` reveals collapse to the same role order. The fix was to make reveal timing temporal, not to force another piece of copy.
2. The first workaround required a third payoff atom and used `title` for two-sentence fixtures. Visual review showed that this leaked the book identity before a declared late reveal. The workaround was rejected. Payoff is now optional and structured identity leakage before reveal is a contract error.

A separate confound was also removed: render seed is fixed per book across its entire angle x reveal matrix, so background/motion variation cannot masquerade as narrative divergence.

## Compatibility with C24

C27 preserves the C24 duration semantics:

- 3s: hook-only teaser;
- 5s: hook -> book reveal, no explicit CTA role;
- 7/9/12/15s: full grammar with tension, book reveal and optional payoff / explicit CTA.

The planner owns exact semantic frame allocation. The runtime executes the plan rather than inferring duration from media side effects.

## Phase A controlled matrix

The fixture matrix uses six existing E08 books with two verified angle entry points per book and three reveal timings:

`6 books x 2 angles x 3 reveal timings = 36 NarrativePlans`

The CTA treatment is fixed to `intent`; the seed is fixed within each book. Visual system, typography, motion, cover treatment, platform profile and delivery profile are held fixed by the render fixture. The controlled axes are therefore angle and reveal timing.

For this lab fixture, angle text is constructed only from exact E08 hook sentences and exact BookPayload fields. Reordering is a mechanism test, not a claim that these are production-quality hooks.

## Renderer contract and machine gates

The C27 adapter reuses the existing C20-C26 visual primitives. `hook`, `tension`, and `desire_payoff` use the same hook renderer; `book_reveal` uses the existing book renderer with the generic hook suppressed; `cta` uses exact plan-owned CTA copy. Legacy fixed `/03` page numbering is suppressed because NarrativePlan can contain a variable number of semantic roles.

CI checks:

- deterministic replay;
- exact copy provenance / no invented text;
- exact frame coverage with no gaps or overlaps;
- strict `early < mid < late` reveal start order;
- no structured title/author identity leak before reveal;
- semantic divergence between the two angles beyond the opening hook;
- compatibility with all six C24 duration profiles;
- exact `NarrativePlan -> Canvas plate schedule` parity;
- inherited C26 safe-zone capture on multiple frames of every semantic role;
- zero layout warnings;
- final MP4 duration/frame count;
- six distinct outputs per book for 2 angles x 3 reveal timings;
- checkpoint review sheets for visual inspection.

## What this does not prove

Passing C27 does not prove that a video is viral, persuasive, attractive, or semantically strong enough for publication. Machine gates prove that the intended narrative mechanism was executed faithfully. Visual/semantic review is still required for creative quality, and real retention, rewatches, shares, saves, CTA actions, and downstream book actions require live publishing.

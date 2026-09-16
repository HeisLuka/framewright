# C27 - Sellable-angle + viral narrative grammar v1

## Product boundary

C27 does not attempt to predict virality offline. It turns a verified reason to care about a book into a deterministic semantic timeline that the renderer executes.

The product order is:

1. earn attention;
2. sustain a specific curiosity or identity/emotion mechanism;
3. reveal the book as the source/payoff;
4. optionally ask for an action.

The unit of creative is therefore not a visual template. It is:

`BookPayload + CreativeSourcePack -> BookEvidence -> sellable-angle candidates -> HookCandidate / arc variant -> NarrativePlan -> renderer -> artifact`

The book is the payoff/source of the content, not necessarily the first-frame advertising object. Visual system, motion and delivery remain downstream realization choices.

## Why CreativeSourcePack exists

`BookAdPayload v0` is intentionally a render payload. It contains title, author, one hook, CTA, cover and visual fields; it does not contain a synopsis, excerpt or broader book content. Treating that single hook as if it were enough to discover multiple independent sellable angles would create fake diversity.

`CreativeSourcePack v1` is therefore a separate upstream input. It contains verified source blocks such as:

- `publisher_synopsis`;
- `publisher_description`;
- `book_excerpt`;
- `editorial_verified`;
- `author_notes`.

Every block must have a stable block ID, exact text, a `verification_id`, and an explicit spoiler level from 0 through 3. The auto layer refuses source blocks without verification metadata instead of silently treating arbitrary generated copy as book truth.

The current NarrativePlan provenance envelope is preserved: exact sentences from verified source-pack blocks are carried as `human_verified` atoms with their block ID, source kind, sentence index, verification ID and source hash attached as provenance metadata. No visible sentence is rewritten by the auto layer.

## Automatic evidence extraction

The automatic extractor performs only bounded transformations over verified text:

1. split trusted blocks into exact sentences;
2. include exact sentences from the existing BookPayload hook when requested;
3. deduplicate identical sentences across payload and source-pack inputs;
4. assign stable evidence IDs;
5. inherit the source block's spoiler level;
6. classify each sentence into a coarse mechanism type using deterministic lexical rules;
7. mark hook/tension eligibility without changing the sentence itself.

The classifier currently recognizes candidate mechanisms such as `premise`, `conflict`, `question`, `identity`, `emotion`, `world`, `character`, and `thesis`, with bounded English/Russian lexical cues. These labels are routing metadata, not factual claims and not quality scores.

If an evidence sentence contains the exact book title or author, it stays in the evidence ledger for provenance but receives no pre-reveal role tags. This prevents the automatic path from defeating a nominal late reveal by selecting publisher copy that already names the book.

The extractor does not infer spoiler safety from language. Spoiler level is an explicit source-pack responsibility. High-spoiler evidence can exist in the ledger while being excluded from a low-spoiler creative search.

## BookEvidence + creative portfolio layer

`BookEvidence v1` is the semantic trust layer immediately above the source pack and existing planner. Each evidence item has:

- a stable evidence ID;
- a semantic kind such as `premise`, `conflict`, `character`, `world`, `identity`, `emotion`, `thesis`, `question`, `quote`, `recommendation_context`, or `payoff`;
- an exact trusted copy source;
- a bounded `spoiler_level` from 0 through 3;
- role tags controlling whether it may be used as a hook/tension candidate.

A sellable-angle candidate can carry multiple variants. Each variant names distinct evidence IDs for `hook`, optional `tension`, and optional `payoff`. The portfolio compiler creates a stable creative concept per `angle x variant`, preserves its hook-candidate identity, and compiles it into the existing `NarrativePlan v1` contract.

The automatic angle builder groups hook-safe evidence by mechanism type and creates bounded variants from exact evidence atoms. Tension selection is deterministic and prefers a complementary mechanism (for example a conflict beat behind a premise hook) when one exists. It does not synthesize a new sentence to make the arc work; if a 7s+ concept has no verified tension, that concept simply cannot compile into a full grammar.

This deliberately keeps the renderer and I05 compiler boundary unchanged. They still receive a NarrativePlan and do not need to know whether the hook was hand-curated or selected by the deterministic upstream evidence layer.

The portfolio compiler can expand bounded matrices over duration, reveal timing and CTA treatment, and can reject concepts above a configured spoiler budget before render. The goal is a portfolio of semantically distinct, truth-preserving creative candidates, not a giant factorial over every visual axis.

## No-AI / no-fabrication contract

C27 never writes free-form book copy. Every visible semantic atom must resolve from one of two trusted source classes:

- `book_payload_field`: exact full field, exact sentence, or exact character span from a permitted BookPayload field;
- `human_verified`: exact verified text carrying a `verification_id`; source-pack sentences retain their source block metadata inside this envelope.

`CreativeSourcePack` and `BookEvidence` do not weaken that rule. They only give trusted atoms explicit source identity and semantic routing so multiple angle/hook plans can reuse the evidence graph without turning the planner into a copywriter.

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

A structured `title` or `author` atom is forbidden before `BOOK_REVEAL`. The automatic source-pack path adds a stronger upstream guard: evidence sentences containing exact title/author identity are not eligible for hook or tension roles.

## Useful failed assumptions

The implementation has already caught several cases of fake diversity or unsafe convenience:

1. With only one middle beat, a sequence-only planner made nominal `mid` and `late` reveals collapse to the same role order. Reveal timing became temporal instead of inventing another sentence.
2. A workaround used `title` as a payoff and leaked book identity before a declared late reveal. Structured identity leakage before reveal became a contract error.
3. A single BookPayload hook looked superficially sufficient for automatic angle generation, but it cannot support honest multi-angle discovery. The source-pack layer was introduced instead of pretending permutations of one ad hook are independent book insights.

A separate confound was also removed: render seed is fixed per book across controlled angle x reveal matrices, so background/motion variation cannot masquerade as narrative divergence.

## Compatibility with C24

C27 preserves the C24 duration semantics:

- 3s: hook-only teaser;
- 5s: hook -> book reveal, no explicit CTA role;
- 7/9/12/15s: full grammar with tension, book reveal and optional payoff / explicit CTA.

The planner owns exact semantic frame allocation. The runtime executes the plan rather than inferring duration from media side effects.

The portfolio compiler respects the same boundary: 3s concepts force `none` CTA; 5s concepts only admit `none` or `soft_reveal`; 7s+ concepts require verified tension before they can compile.

## Controlled matrices

The existing renderer fixture uses six E08 books with two verified angle entry points per book and three reveal timings:

`6 books x 2 angles x 3 reveal timings = 36 NarrativePlans`

The CTA treatment is fixed to `intent`; the seed is fixed within each book. Visual system, typography, motion, cover treatment, platform profile and delivery profile are held fixed by the render fixture. The controlled axes are therefore angle and reveal timing.

That matrix remains useful for proving the existing NarrativePlan -> renderer boundary. It is not presented as production-quality automatic copy discovery.

Separate upstream self-tests now prove two additional boundaries:

- one BookEvidence set can create multiple hook candidates while preserving provenance and spoiler filtering;
- a verified CreativeSourcePack can be deterministically converted into distinct evidence mechanisms, automatic angle groups, hook candidates and a bounded plan matrix without creating new visible book copy.

The next live-content experiment should vary `angle mechanism x hook candidate x reveal timing` before multiplying visual systems. Distribution metrics should decide which concepts get more traffic.

## Renderer contract and machine gates

The C27 adapter reuses the existing C20-C26 visual primitives. `hook`, `tension`, and `desire_payoff` use the same hook renderer; `book_reveal` uses the existing book renderer with the generic hook suppressed; `cta` uses exact plan-owned CTA copy. Legacy fixed `/03` page numbering is suppressed because NarrativePlan can contain a variable number of semantic roles.

CI checks:

- deterministic NarrativePlan replay;
- deterministic creative-portfolio replay and stable hook-candidate identity;
- deterministic CreativeSourcePack -> evidence -> auto-angle replay;
- exact BookEvidence copy provenance / no invented visible text;
- source-pack block verification metadata is mandatory;
- duplicate sentence elimination across source inputs;
- exact title/author-bearing source text is excluded from automatic pre-reveal roles;
- spoiler-budget filtering before render;
- rejection of unknown/untrusted evidence;
- several independent mechanism types and hook candidates in the automatic fixture;
- exact frame coverage with no gaps or overlaps;
- strict `early < mid < late` reveal start order;
- no structured title/author identity leak before reveal;
- semantic divergence between the two controlled renderer angles beyond the opening hook;
- compatibility with all six C24 duration profiles;
- exact `NarrativePlan -> Canvas plate schedule` parity;
- inherited C26 safe-zone capture on multiple frames of every semantic role;
- zero layout warnings;
- final MP4 duration/frame count;
- six distinct outputs per book for 2 angles x 3 reveal timings;
- checkpoint review sheets for visual inspection.

## What this does not prove

Passing C27 does not prove that a video is viral, persuasive, attractive, or semantically strong enough for publication. Machine gates prove that the intended narrative mechanism was executed faithfully. Visual/semantic review is still required for creative quality, and real retention, rewatches, shares, saves, CTA actions, and downstream book actions require live publishing.

The deterministic classifier also does not know the book better than its verified sources. It can route exact evidence into plausible mechanism buckets, but it cannot discover an unstated premise, hidden theme, or plot fact. Richer source packs improve the search space; they do not justify hallucination.

C27 does not choose the best angle or hook. It creates a safe experimental search space. Real distribution and intent measurements, not an offline `viral_score`, must decide which concepts deserve more traffic.

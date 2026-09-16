# I11 — C35 creative ingress to physical I07 factory

> Numbering note: this integration was first prototyped with internal `i09-*` paths before canonical I09 and I10 were assigned to other merged integration work. The canonical research number for this pass is **I11**. Internal `i09-*` file names, artifact paths, fixture IDs, and machine schema labels are intentionally retained for reproducibility.

## Question

C35 proves that one user-side LLM JSON can deterministically enter one of three canonical creative trust modes. I07 proves a resumable local render worker around the existing I03/FAST factory.

I11 closes the missing physical boundary:

> Does accepted C35 creative meaning become the bytes actually rendered by the existing factory, or do we merely carry C35 IDs beside an unrelated renderer fixture?

The acceptance criterion is causal lineage, not metadata adjacency.

## Physical chain under test

```text
C35 CreativeIngress
  -> canonical C32 / C36 / C33 compiler
  -> real C27 NarrativePlan
  -> physical C27 scene payload bytes
  -> C19 CreativeSpec + RenderSpec
  -> I07 queue
  -> I03 / FAST executor
  -> MP4 + QA receipt
```

The test runs one 9-second vertical creative from each C35 mode in one campaign:

1. `trusted_atoms` / paper;
2. `verified_composition` / swiss;
3. `external_copy_review_required` / newspaper.

All three use the same generated book/cover fixture so differences are attributable to the creative program and presentation rather than a different product asset.

## Server-owned fixture construction

The historical `i09-build-c35-physical-fixture.mjs` builder starts from the canonical C26 physical fixture and hashes its actual cover bytes. It constructs a test ContextPack from the physical book payload and a matching server-owned CopyLanguage.

The three C35 ingresses are processed through the real unified C35 entrypoint. Their outputs are not copied into metadata only.

For each mode the builder writes a renderer payload containing:

- the exact C35 `narrative_plan` object;
- the exact hook display text from that plan;
- the C35-selected visual system;
- the existing physical book title, author, CTA, and cover data;
- the `youtube_shorts` platform profile.

The SHA-256 of those payload bytes becomes the C19 `CreativeSpec.payload_sha256`.

C35 identity and trust provenance is retained in `CreativeSpec.hook.provenance`, which participates in creative identity. The physical executor independently requires runtime payload bytes to match `CreativeSpec.payload_sha256` before rendering.

## Hard lineage gates

I11 fails unless, for every mode:

- C19 preserves the exact C35 `ingress_id`, `program_id`, `narrative_plan_id`, and creative trust state;
- execution payload SHA equals CreativeSpec payload SHA;
- execution payload physically contains that exact C35 NarrativePlan ID;
- runtime hook bytes equal the C35 program hook;
- runtime visual system equals the C35 presentation;
- exactly one RenderSpec is produced for that CreativeSpec;
- the corresponding physical receipt and MP4 exist;
- runtime QA passes at exactly 270 frames / 9000 ms;
- MP4 SHA equals the physical receipt SHA.

The three CreativeSpec IDs, RenderSpec IDs, and final MP4 hashes must all be distinct.

## Render permission is not publication trust

The unapproved C33 external-copy mode is intentionally included in the physical render campaign because C33 allows deterministic preview rendering before review.

That does **not** make it publish-ready.

The builder separately emits a `publish-ready` creative-trust receipt. Without a trusted C33 approval it must contain only `trusted_atoms` and `verified_composition`. `external_copy_review_required` must still render a physical preview while remaining absent from the publish-ready set.

```text
render permission != publication trust != final platform authorization
```

I11 tests the first two. Account credentials, platform authorization, scheduling, and campaign delivery policy remain outside this pass.

## I07 idempotence gate

The complete three-creative request is enqueued once into the real I07 local queue and processed by the real I03/FAST executor.

After success the identical request is enqueued again. It must resolve to the same content-addressed job in `done` state and must not create a second physical attempt.

Therefore C35 replay is tested beyond pure JSON identity: it reaches the existing durable render boundary without duplicating expensive physical work.

## CI note

The first historical attempt failed before rendering because its workflow referenced a non-existent `prepare-c26-platform-safe-template.mjs`. The current I11 workflow uses the actual canonical `prepare-c26-platform-safe.mjs` entrypoint and keeps the original `i09-*` artifact names only as historical identifiers.

## Scope boundary

I11 is deliberately one book, one delivery profile, one duration, and one physical campaign. It does not re-prove C26 platform matrices, I03 audio identity, provider economics, or creative performance.

If I11 passes, the remaining local-Codex integration problem is orchestration and operator ergonomics rather than whether an accepted LLM contract can physically reach the renderer.

# C21 — Deterministic opening grammar and causal isolation

## Question

Can the factory create several materially different first ~2 seconds for the same book ad, without AI or invented factual copy, while keeping the rest of the creative identical?

C21 deliberately isolates only the opening presentation. For every book, the following remain fixed:

- normalized book payload and verified copy;
- routed visual system;
- cover and C20 cover-adaptive art direction;
- structural variant;
- seed;
- delivery profile;
- motion profile after the opening window.

Only `opening_grammar` changes.

## Grammars

1. `hook-led` — existing verified-hook baseline.
2. `cover-led` — book identity / cover takes the first visual priority.
3. `title-led` — verified title takes the first visual priority.
4. `progressive-hook` — progressively reveals the **same verified hook**. It does not generate or paraphrase a factual claim.

The experiment is intentionally bounded: variants may diverge only in the opening and must converge back to the exact same baseline scene by 2.4 seconds.

## Important negative findings before the canonical run

### 1. Background RNG contaminated the first diversity measurement

An exploratory pass allowed the different grammars to receive slightly different background RNG state. That inflated visual distance for the wrong reason.

We removed the confound instead of accepting the number: every grammar now uses the exact same baseline hook background/motif for the same book/seed. Only foreground hierarchy and timing differ.

### 2. Alpha crossfade was rejected

A clean causal version faded the alternate opening out while the baseline hook underneath faded through it. Numeric gates passed, but manual review showed transient text-on-text ghosting.

### 3. Spatial wipe was also rejected

The next attempt used a geometric wipe. That removed alpha ghosting but created a different structural problem: during the wipe, one side of the frame could contain one text hierarchy while the other side already contained another. For copy-heavy book ads this produced sliced mixed-copy transition frames.

The final implementation avoids both effects. The alternate hierarchy remains intact until `S.t = 0.60` of the 3-second hook plate (about **1.8 seconds**), then performs a deliberate **one-frame editorial cut** to the untouched baseline hook. No crossfade and no spatial wipe remain in the canonical implementation.

## Final canonical run

GitHub Actions run: `35136282583` — SUCCESS.

Artifact: `10463910393` (`c21-opening-grammar`).

Artifact digest: `0ba2d6157ddfe1af7ff0bc7fad804b1417e1c8b7863c643cdb2ce683f96ad5d1`.

The run exercised head `bd37c7715e13105799008112ee653b7bfdb9516a`, which contains the final editorial-cut behavior later included in the merged C21 branch.

Workload:

- 10 representative routed-primary books;
- Newspaper / Paper / Swiss represented;
- 4 opening grammars each;
- **40 full 12-second videos**.

### Causal opening audit

Sampled opening times: `0.45s`, `1.05s`, `1.65s`.

Exact convergence checkpoint: `2.4s`.

Results:

- books: **10**
- mean opening difference across books: **0.092093**
- minimum opening difference across books: **0.037693**
- maximum difference at 2.4s convergence: **0**

The experiment therefore satisfies both causal requirements: the openings are materially different, and the rest of the creative is exactly rejoined.

### Full-render QA

- outputs: **40/40**
- layout warning groups: **0**
- sequential throughput on this runner: **557.43 videos/hour**
- peak Node + FFmpeg RSS: **778.2 MiB**

The throughput number is runner-specific and not used as a backend-selection result.

### Runtime cost vs `hook-led`

Across the three alternate grammars:

| metric | ratio |
|---|---:|
| mean | 1.0288 |
| p50 | 1.0290 |
| p95 | 1.0725 |
| max | 1.1038 |

Mean runtime regression is therefore about **+2.9%**; p95 about **+7.3%** on this runner.

By grammar:

| grammar | mean cost ratio | p95 cost ratio | mean MP4 byte ratio |
|---|---:|---:|---:|
| cover-led | 1.0456 | 1.0595 | 1.1697 |
| title-led | 1.0084 | 1.0290 | 0.9049 |
| progressive-hook | 1.0323 | 1.0725 | 0.9774 |

The alternate openings are cheap enough to be treated as a creative axis rather than a separate renderer cost class.

## Final manual review

The canonical review sheets show all four grammars at `0.45 / 1.05 / 1.65 / 2.4s` for all ten books.

All ten final sheets were reviewed after run `35136282583`.

Key findings:

- `cover-led` is clearly distinct from baseline and gives the book object an identity-first opening without changing later scene semantics.
- `title-led` works naturally when the title carries visual or semantic weight. Very short titles such as `Соль` intentionally produce a quieter, lower-energy opener; that is a creative tradeoff rather than a layout failure.
- `progressive-hook` is readable and rhythmically distinct, but it remains the most experimental grammar. Early ellipsis/truncation can feel mechanical on some copy, so it should remain a testable candidate rather than a default assumption.
- at `1.65s`, every alternate hierarchy is still visually whole; there are no sliced mixed-copy transition frames.
- at `2.4s`, every variant is visibly the same baseline scene, matching the exact convergence audit.
- no reviewed sheet showed clipping, alpha ghosting, half-copy wipes or opening-specific readability failure.

The final editorial cut is intentionally simple. For these copy-heavy ads it is cleaner than a transition effect that temporarily displays two semantic hierarchies at once.

## Decision

**C21 passes as a controlled opening-grammar primitive.**

The factory now has a no-AI opening axis that changes *how verified information is presented*, without inventing new information and without silently changing the rest of the ad.

The semantic contract should treat opening grammar as part of the verified `hook` / opening-presentation semantics inside `CreativeSpec`. Runtime consumes the resulting scene semantics; it does not choose the grammar.

C21 does **not** establish which grammar produces the best CTR/CPA. Synthetic distance, layout QA and manual review only prove that the variants are valid, meaningfully different and cheap enough to test. Campaign outcomes must update future routing/selection weights.

## Next

C22 — motion quality v2:

- improve easing and choreography rather than adding motion everywhere;
- maintain one clear focal motion event at a time;
- test scene continuity / settle windows / CTA emphasis;
- keep optional beat/onset synchronization as a separate controlled axis so its contribution remains attributable.

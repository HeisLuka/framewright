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

### 2. Cross-fading two text hierarchies looked dirty

The first clean causal version faded the alternate opening out while the baseline hook underneath faded through it. Static metrics passed, but manual review showed a risk of text-on-text overlap during the transition.

The final implementation uses a geometric wipe to reveal the already-rendered baseline instead. This keeps the transition readable and preserves exact convergence semantics.

## Final canonical run

GitHub Actions run: `35135829034`.

Artifact: `10463515194` (`c21-opening-grammar`).

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

So the experiment achieved both requirements simultaneously: the openings are measurably different, and the rest of the creative is exactly rejoined.

### Full-render QA

- outputs: **40/40**
- layout warning groups: **0**
- sequential throughput on this runner: **758.1 videos/hour**
- peak Node + FFmpeg RSS: **781.6 MiB**

### Runtime cost vs `hook-led`

Across the three alternate grammars:

| metric | ratio |
|---|---:|
| mean | 1.0293 |
| p50 | 1.0299 |
| p95 | 1.0707 |
| max | 1.0924 |

Mean runtime regression is therefore about **+2.9%**; p95 about **+7.1%** on this runner.

By grammar:

| grammar | mean cost ratio | p95 cost ratio | mean MP4 byte ratio |
|---|---:|---:|---:|
| cover-led | 1.0348 | 1.0489 | 1.1294 |
| title-led | 1.0120 | 1.0296 | 0.8777 |
| progressive-hook | 1.0410 | 1.0731 | 0.9803 |

The alternate openings are therefore cheap enough to be treated as a creative axis rather than a renderer cost class.

## Manual review

Review sheets show all four grammars at `0.45 / 1.05 / 1.65 / 2.4s` for all ten books.

The useful qualitative findings are not a universal ranking:

- `cover-led` is consistently and obviously different from the baseline and gives the cover a strong identity-first role.
- `title-led` works especially naturally when the title itself has visual or semantic weight. On very short titles such as `Соль`, the intended minimalism can produce a lower-energy opener; that is a creative tradeoff, not a layout failure.
- `progressive-hook` remains readable and creates a distinct rhythm, but it is the most experimental grammar. Early ellipsis/truncation can feel mechanical on some copy, so it should remain a candidate to test rather than a default assumption.
- the final wipe transition removes the previous text-on-text overlap problem.
- all reviewed variants visibly become the same baseline scene at 2.4 seconds, matching the exact audit result.

No reviewed sheet showed clipping or an opening-specific readability failure.

## Decision

**C21 passes as a controlled opening-grammar primitive.**

The factory now has a no-AI opening axis that changes *how verified information is presented*, without inventing new information and without silently changing the rest of the ad.

The semantic contract should treat opening grammar as part of the verified `hook` / opening presentation semantics inside `CreativeSpec`. Runtime consumes the resulting scene semantics; it does not choose the grammar.

C21 does **not** establish which grammar produces the best CTR/CPA. Synthetic distance, layout QA and manual review only prove that the variants are valid, meaningfully different and cheap enough to test. Campaign outcomes must update future routing/selection weights.

## Next

C22 — motion quality v2:

- improve easing and choreography rather than adding motion everywhere;
- maintain one clear focal motion event at a time;
- test scene continuity / settle windows / CTA emphasis;
- keep optional beat/onset synchronization as a separate controlled axis so its contribution remains attributable.

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
- baseline background / motif RNG;
- the complete creative after the opening window.

Only `opening_grammar` changes.

## Grammars

1. `hook-led` — existing verified-hook baseline.
2. `cover-led` — book identity / cover takes the first visual priority.
3. `title-led` — verified title takes the first visual priority.
4. `progressive-hook` — progressively reveals the **same verified hook**. It does not generate or paraphrase a factual claim.

The experiment is intentionally bounded: variants may diverge only in the opening and must converge back to the exact same baseline creative.

## Useful negative findings before the canonical run

### 1. Background RNG contaminated the first diversity measurement

An exploratory pass gave alternate openings a different background plate key. That changed decorative RNG and inflated visual distance for the wrong reason.

We removed the confound rather than accepting the number. All four grammars now use the exact same baseline `hook` background / motif for the same book and seed. Only foreground hierarchy and timing differ.

### 2. Automated gates did not catch an ugly alpha transition

A later causal version passed raw divergence, exact convergence, layout and cost gates, but manual review exposed double-text ghosting around the handoff: the alternate hierarchy faded while the baseline hook underneath became visible.

That run was rejected despite being automated-green.

### 3. A geometric wipe was also rejected

A spatial wipe avoids alpha ghosting, but its midpoint necessarily combines part of the baseline hierarchy with part of the alternate hierarchy. For copy-heavy book ads that produces a structurally bad transient frame even if selected review stills look acceptable.

We rejected that transition before declaring a result.

### Final transition: deliberate editorial cut

The canonical implementation keeps the alternate hierarchy fully intact until `S.t = 0.60` on the 3-second hook plate, approximately **1.8 seconds**, then returns to the untouched baseline in one frame.

This gives us a much cleaner causal contract:

```text
0.0s .. ~1.8s  alternate opening grammar
~1.8s onward   exact baseline creative
```

No alpha blending, no sliced mixed copy, no new background RNG state.

## Final canonical run

GitHub Actions run: `35136282583`.

Renderer commit under test: `bd37c7715e13105799008112ee653b7bfdb9516a`.

Artifact: `10463910393` (`c21-opening-grammar`).

Artifact digest: `sha256:0ba2d6157ddfe1af7ff0bc7fad804b1417e1c8b7863c643cdb2ce683f96ad5d1`.

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

The openings therefore remain materially different before the editorial cut while the later creative is exactly rejoined.

### Full-render QA

- outputs: **40/40**
- layout warning groups: **0**
- sequential throughput on this runner: **557.43 videos/hour**
- peak Node + FFmpeg RSS: **816,021,504 bytes (~778.2 MiB)**

The absolute throughput number is runner-specific and should not be treated as provider pricing evidence.

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

Aggregate MP4 byte ratio across alternate openings:

- mean: **1.0173**
- p50: **0.9683**
- p95: **1.2298**
- max: **1.2479**

The opening axis is therefore cheap enough to treat as creative variation rather than a separate renderer cost class.

## Manual review

All ten canonical review sheets were inspected at `0.45 / 1.05 / 1.65 / 2.4s`.

Additional stills were extracted immediately around the final cut (`~1.76s` and `~1.84s`) for short-title Newspaper, Paper, and the long-title stress case. The cut is clean: the frame changes from one complete hierarchy to the complete baseline without text ghosting or spatially mixed copy.

Qualitative findings are **not** an effectiveness ranking:

- `cover-led` is clearly different from the baseline and gives the book object a strong identity-first role.
- `title-led` remains readable on the long-title stress case. Very short titles such as `Соль` intentionally produce a lower-information, minimalist opener; that is a creative tradeoff, not a layout failure.
- `progressive-hook` is readable and produces a different rhythm, but the progressive ellipsis can feel mechanical on some copy. It remains a campaign-test candidate, not an assumed default.
- no canonical review sheet showed clipping, double-text ghosting, unsafe overlap, or an opening-specific readability failure.
- every grammar visibly returns to the same baseline creative, matching the exact raw convergence audit.

## Decision

**C21 passes as a controlled opening-grammar primitive.**

The factory now has a no-AI creative axis that changes *how verified information is presented* in the opening without inventing information and without silently changing the rest of the ad.

The semantic contract should treat opening grammar as part of `CreativeSpec`. Runtime consumes the chosen opening semantics; runtime does not decide which grammar is more effective.

C21 does **not** establish which grammar produces the best CTR, CPA, watch time or conversion. Synthetic distance, layout QA and manual review prove only that the variants are valid, materially different, causally isolated and cheap enough to test. Campaign outcomes must decide future routing / selection weights.

## Next

C22 — motion quality v2:

- improve easing and choreography rather than adding motion everywhere;
- replace ambient continuous drift with semantic motion roles;
- maintain one clear focal motion event at a time;
- introduce settle windows and deliberate CTA emphasis;
- measure high-frequency jitter, meaningful scene activity, layout safety, runtime and encoded size against E12 active-motion;
- keep optional beat/onset synchronization as a separate controlled phase so its contribution remains attributable.

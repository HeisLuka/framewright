# E13 — deterministic creative router

## Product question

Given ordinary catalog/editorial metadata for a book, can we deterministically rank several genuinely different ad systems and generate a small candidate set without AI in the render path?

E13 intentionally moves above renderer optimization. The renderer is treated as solved enough for STANDARD ads.

## Inputs

The lab taxonomy uses fields that can live in catalog metadata:

- genre;
- tone tags;
- pace;
- campaign objective;
- title length and hook length derived from copy.

No embedding, model call or generative step is required to make the routing decision.

## Candidate systems

The router scores and ranks the three E11/E12 systems:

- Swiss — graphic, commercial, high-pace, thriller/dystopia/science-fiction bias;
- Newspaper — literary/editorial, reflective, long-copy bias;
- Paper — emotional, intimate, atmospheric, family-drama/mystery bias.

Every book receives a ranked primary, secondary and exploration candidate. All candidates use the E12 active motion grammar.

## Canonical workload

Ten stress books × three ranked candidates = 30 full 1080x1920 / 12 s / 30 fps videos.

The experiment records:

1. routing scores and reasons;
2. complete layout QA;
3. total renderer throughput;
4. cross-system visual diversity at hook/book/CTA frames using low-resolution normalized pixel difference.

The visual-difference metric is not an aesthetic score. It only prevents the candidate set from collapsing into near-duplicates.

## Initial guardrails

- exactly three distinct systems per book;
- primary route must have a strictly higher score than the secondary on the ten canonical fixtures;
- zero layout warnings across all 30 videos;
- minimum per-book pairwise visual-difference floor `0.03` at sampled plate frames.

## What E13 can and cannot prove

E13 can prove that catalog metadata can drive deterministic creative selection and produce visually non-duplicate candidates cheaply.

It cannot prove that the primary candidate performs better in advertising. That requires later campaign outcome data. The router should therefore remain an explicit, versioned ruleset until real performance data exists to justify changing its weights.

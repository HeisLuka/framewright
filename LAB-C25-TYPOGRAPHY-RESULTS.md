# C25 — Typography as a first-class deterministic creative axis

## Question

Can typography itself become a materially different, deterministic creative axis — without changing copy, cover, palette, composition, pacing, motion, opening grammar, structural variant, seed or font family — while staying safe and essentially free to render?

## Controlled setup

- Base: current `lab/framewright-research` semantic stack.
- Art direction: C20 cover-adaptive palette fixed.
- Composition: C23 cover-composition fixed.
- Opening: C21 `hook-led` fixed.
- Motion: C22 `choreography-v2` fixed.
- Structural variant: `hook-first` fixed.
- Timeline: fixed 12s.
- Delivery: vertical 1080x1920 fixed.
- Font family: pinned `DejaVu Sans` for every variant; this is intentionally **not** a font-swap experiment.
- Corpus: 10 short / long / multilingual stress fixtures across Swiss, Newspaper and Paper.
- Four typography systems per fixture: `baseline`, `display-led`, `editorial`, `compact-dense`.
- Total: 40 complete videos.

Only the typography system changes inside a comparison set.

## Typography systems

The systems vary bounded semantic typography parameters:

- display/body/label scale;
- weight hierarchy;
- text measure;
- line height;
- tracked-label rhythm.

The current policy is deliberately strong enough to create real editorial hierarchy rather than cosmetic deltas. Long-copy fit constraints may reduce a nominally large display size when necessary; that is expected and preserves the same bounded readability rules.

## Measurement correction

The first implementation used whole-frame raster difference as the hard diversity gate. That was the wrong metric for this axis: unchanged cover and background pixels dominate the frame and dilute localized text changes.

The experiment therefore records the actual fitted typography for every sampled text block:

- requested and final size;
- weight;
- line count;
- measure / `maxW`;
- line height / tracking;
- text-region bounding box.

The final gate requires:

1. all four fitted typography signatures to remain distinct for every book;
2. mean text-region ROI divergence >= 0.10;
3. worst-book minimum text-region ROI divergence >= 0.05.

Whole-frame divergence remains diagnostic only; its threshold was not lowered to force a pass.

## Performance bug found during the experiment

A stronger `display-led` policy initially exposed a real implementation cost. The base template linearly recomputed `fitBlock` on every frame. Larger starting sizes plus narrower measures caused many repeated `measureText` / wrapping iterations, especially on long copy.

Pre-cache strict run `35143461510`:

- 40/40 renders;
- 0 layout warnings;
- mean cost ratio **1.0925**;
- p95 **1.5634**;
- max **1.8713**;
- throughput **603.89 videos/hour**.

The cost gate correctly failed.

The fix is a deterministic in-runtime cache keyed by text plus all fit-affecting options (`maxW`, `maxH`, `maxLines`, start/min size, weight, line height). Cache hits restore the exact final canvas font state left by the original fitter. The cache is applied identically to baseline and every typography system.

As a no-visual-change control, all 40 MP4s from the pre-cache strict run and the canonical cached run were SHA-256 compared: **40/40 files are byte-for-byte identical**.

## Canonical run

GitHub Actions run: `35144165706`

Artifact: `10466159581` (`c25-typography-axis`)

Branch head: `35174e09cbdae9fe76bb493d217da070b01f8e2c`

Result:

- 10 books / 40 complete videos;
- fitted typography signatures: **4/4 distinct per book**;
- text-ROI divergence mean: **0.157755**;
- worst-book minimum text-ROI divergence: **0.076324**;
- whole-frame diagnostic divergence: mean **0.026334**, min **0.006544**;
- layout warnings: **0**;
- missing comparisons: **0**;
- typography/baseline end-to-end cost ratio (`initMs + totalMs`): mean **0.9942**, p95 **1.0095**, max **1.0147**;
- mean MP4 byte ratio: **0.9302**;
- aggregate throughput: **724.24 videos/hour**;
- peak combined Node + FFmpeg RSS: **760,201,216 bytes** (~725 MiB).

The cache removed the pathological long-copy `display-led` cost without weakening the typography policy.

## Manual review

All 10 canonical review sheets were inspected at 1.65s, 5.2s and 9.6s, covering short, long and multilingual fixtures across Swiss / Newspaper / Paper.

Observed behavior:

- `display-led` produces the strongest display hierarchy and tighter measure; on long copy the fitter safely reduces final size rather than clipping;
- `editorial` produces a quieter, more text-forward rhythm with visibly different scale/weight/measure relationships;
- `compact-dense` compresses hierarchy and spacing without becoming an unreadable miniature version of baseline;
- the three existing visual systems keep their own character instead of collapsing into one generic typographic template;
- no clipped copy, destructive cover/text collisions or obvious CTA readability failures were observed.

## Decision

**Accept C25 as a useful deterministic creative primitive.**

Typography should be represented as a versioned CreativeSpec axis / provenance value, not as an implicit renderer style. Campaign selection may choose among bounded typography systems while Runtime only executes the declared system.

Keep the fitted-layout cache as a general deterministic optimization: text fitting is invariant across frames for the same text/options and should not be recomputed 360 times.

This result proves controlled visual-system diversity and render safety/cost. It does **not** prove CTR/CPA lift; campaign data must decide whether a typography system earns future weight.

## Product implication

The creative factory now has another cheap, auditable axis that changes perceived hierarchy without inventing copy or requiring new assets. More importantly, the experiment found and removed a hidden cost that would have made aggressive editorial typography disproportionately expensive. That is exactly the kind of coupling the lab should surface before campaign-scale production.

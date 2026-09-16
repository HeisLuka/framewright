# C23 — Cover composition heuristics without AI

## Question

Can simple deterministic image statistics improve cover crop/placement and book/text composition without ML/object/face detection, while keeping the current C20/C21/C22 creative stack unchanged?

## Controlled setup

- Base: current `lab/framewright-research` semantic stack.
- Art direction: C20 cover-adaptive palette fixed.
- Opening: C21 `hook-led` fixed.
- Motion: C22 `choreography-v2` fixed.
- Structural variant: `hook-first` fixed.
- Delivery: vertical 1080x1920 fixed.
- 36 diverse synthetic covers from the C20 fixture family.
- Strict pair per cover: `fixed` vs `adaptive` composition.
- Total: 72 complete 12-second renders across Swiss / Newspaper / Paper.

No AI, ML, OCR, face detection or object detection is used.

## Adaptive policy

The cover is sampled on a small deterministic grid. Each cell records:

- luminance;
- local luminance variance;
- edge density;
- coarse luminance entropy.

A weighted saliency proxy yields a focal centroid and confidence. The policy then:

1. keeps a bounded focal crop around that centroid;
2. caps zoom at 1.06x (`zoomRetention >= 0.89`);
3. only swaps the cover/text columns when the horizontal focal signal is strong enough;
4. records the full decision (`focusX`, `focusY`, confidence, side, zoom, grid cells) for audit/replay.

This is deliberately conservative. It is a layout prior, not semantic object understanding.

## Canonical run

GitHub Actions run: `35140548685`

Artifact: `10465261291` (`c23-cover-composition`)

Head: `c3808e317955ee29405ea21ca36add00eeb6048c`

Result:

- 36/36 covers analyzed from image bytes; no fallback;
- 72/72 complete paired videos;
- layout warnings: **0**;
- side decisions: **5 left / 31 right**;
- confidence: min **1.197**, mean **1.7477**, max **3.142**;
- zoom: **1.00–1.06x**;
- minimum retained source area from zoom policy: **0.89**;
- adaptive/fixed wall-cost ratio: mean **0.9992**, p95 **1.0285**, max **1.0370**;
- adaptive/fixed MP4 byte ratio: mean **0.9937**;
- aggregate runner throughput: **694.8 videos/hour**;
- peak combined Node + FFmpeg RSS: **764,604,416 bytes** (~729 MiB).

## Manual review

Paired book-plate sheets were checked across:

- all five left-side swap decisions;
- Swiss / Newspaper / Paper;
- high-confidence/max-zoom cases;
- noisy/high-detail and strongly asymmetric covers.

The bounded swaps preserve readable text columns and do not create collisions. The 6% maximum focal zoom is visually mild; the highest-zoom fixtures keep at least 89% of the baseline source area. The adaptive layout is most useful when the cover has a clearly asymmetric focal region; low-confidence cases correctly remain on the baseline side.

Representative behavior:

- Swiss: cover/text column swap remains balanced and preserves hierarchy.
- Newspaper: mirrored cover column keeps the editorial grid intact.
- Paper: swap retains the collage character rather than becoming a generic mirror.

## Decision

**Accept C23 as a useful deterministic creative primitive.**

Cover composition evidence should become versioned `CreativeSpec.art_direction` / composition provenance, alongside C20 palette evidence. Runtime must not recalculate or reinterpret the creative decision.

Use the heuristic conservatively:

- bounded crop/zoom only;
- confidence-gated side changes;
- explicit fallback to fixed composition;
- retain the numeric analysis for QA/debugging.

This does not prove the heuristic understands a cover semantically. Real catalog covers remain the next validation population before making the policy a hard production default.

## Product implication

C20 + C23 now allow the visual system to respond to both **the colors** and **the spatial structure** of the actual cover without AI and at effectively zero measured render cost. That attacks template sameness more directly than another renderer micro-optimization.

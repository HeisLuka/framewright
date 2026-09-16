# C20 — Cover-adaptive art direction v1

## Question

Can the factory derive a useful visual art direction from the actual book cover, deterministically and without AI, while keeping readability safe and render cost effectively flat?

C20 isolates that question. The book payload, visual system, seed, delivery profile and structural timing stay fixed inside each pair. The only changed axis is whether the visual system uses the generic treatment or a cover-derived art direction.

## Canonical run

GitHub Actions run: `35132993811`.

Matrix:

- 36 deliberately diverse synthetic cover fixtures
- Swiss / Newspaper / Paper
- strict generic vs cover-adaptive pair for every fixture
- **72 full renders**
- review stills at hook (`1.5s`) and book (`5.2s`)

Canonical batch result:

- outputs: **72/72**
- layout warning groups: **0**
- aggregate sequential throughput: **846.28 videos/hour**
- peak Node + FFmpeg RSS: **771.1 MiB**

### Palette and accessibility gates

- cover-derived art-direction failures: **0/36**
- unique palette signatures: **36/36**
- minimum ink/background contrast: **7.144:1**
- minimum accent/background contrast: **3.423:1**
- minimum white/accent contrast: **4.51:1**

### Cost of adaptation

Adaptive/generic end-to-end render-time ratio:

| metric | ratio |
|---|---:|
| mean | 1.0189 |
| p50 | 1.0207 |
| p95 | 1.0500 |
| max | 1.0515 |

Mean render-cost regression is therefore about **+1.89%** on this runner; p95 is **+5.0%**. This is comfortably inside the C20 gate and is small enough that cover adaptation should be treated as a creative primitive, not an expensive effect.

By visual system, mean cost ratio was:

- Swiss: **1.0272**
- Newspaper: **1.0203**
- Paper: **1.0094**

Encoded output size did not materially increase: mean adaptive/generic byte ratio was **0.9874**, p95 **1.0341**.

These are runner-specific diagnostics, not provider pricing measurements.

## Useful failure before the canonical run

The first strict palette audit failed with only **13 unique palette signatures** from 36 fixtures.

The extractor was not the real problem. The fixture generator had produced nominally different covers that still collapsed into a small number of underlying colour families. Lowering the diversity threshold would have made the test easier without improving the product.

We changed the **fixture set**, not the acceptance gate. The canonical run then produced 36/36 unique palette signatures while still passing all contrast thresholds.

This is the useful lesson: synthetic QA data must contain the variation the test claims to exercise. A green gate over repetitive fixtures is not evidence of robustness.

## Manual review

The six canonical review pages cover all 36 strict pairs with this cell order:

1. generic hook @ 1.5s
2. adaptive hook @ 1.5s
3. generic book @ 5.2s
4. adaptive book @ 5.2s

Manual review found the adaptation to be visually meaningful rather than a simple random tint:

- dark navy / amber covers produce restrained blue/amber systems;
- purple covers produce coherent lavender/purple treatments;
- green and teal covers shift background, accent and supporting geometry together;
- red/black, blue, beige/paper and lower-chroma covers retain distinct identities;
- low-chroma covers intentionally produce subtler adaptation rather than forced saturated colour;
- no reviewed pair showed obvious clipping, muddy body text or unsafe CTA contrast.

The cover-driven motifs also matter: Swiss, Newspaper and Paper do not merely receive the same palette swap; their existing visual grammar consumes the derived art direction differently.

## Decision

**C20 passes as a production creative primitive.**

The factory can cheaply derive deterministic art direction from a cover without AI. The implementation gives us a useful new independent creative axis:

```text
book cover
  -> deterministic visual features
  -> contrast-safe art direction
  -> visual-system-specific treatment
```

This result does **not** prove CTR, CPA or conversion lift. It proves that cover adaptation is robust, visually meaningful, auditable and cheap enough to include in controlled campaign experiments.

The important product consequence is that a large catalogue no longer needs one generic palette per template. Each book can inherit a recognizable visual identity at effectively negligible renderer cost.

## Next

1. Move to C21: deterministic opening / hook grammar.
2. Keep verified copy fixed and vary only first-1.5-to-2.5-second presentation semantics.
3. Require material opening divergence but convergence after the opening, so C21 remains a clean causal creative axis rather than another whole-video variant.
4. Later expose both `art_direction` and `opening_grammar` in `CreativeSpec`; campaign outcomes, not synthetic diversity metrics, decide which combinations earn more traffic.

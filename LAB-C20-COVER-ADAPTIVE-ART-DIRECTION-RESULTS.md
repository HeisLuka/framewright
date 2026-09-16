# C20 — Cover-adaptive art direction v1

## Question

Can the factory derive useful visual art direction from the actual book cover, deterministically and without AI, while keeping readability safe and render cost effectively flat?

C20 isolates that question. Within every generic/adaptive pair, book payload, visual system, seed, delivery profile, structural variant, hook and motion stay fixed. The changed axis is cover-derived art direction only.

## Final verification run

Final post-review verification: GitHub Actions run `35133994670`, artifact `10462707805`.

This run contains the Newspaper refinement produced after manual review of the first green pass. It therefore verifies the exact C20 implementation merged into `lab/framewright-research`.

Matrix:

- 36 deliberately diverse synthetic cover fixtures
- Swiss / Newspaper / Paper
- strict generic vs cover-adaptive pair for every fixture
- **72 full 12-second renders**
- review stills at hook (`1.5s`) and book (`5.2s`)

Final batch result:

- outputs: **72/72**
- layout warning groups: **0**
- aggregate sequential throughput: **701.72 videos/hour** on this runner
- peak Node + FFmpeg RSS: **779.9 MiB**

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
| mean | 1.0131 |
| p50 | 1.0174 |
| p95 | 1.0391 |
| max | 1.0501 |

Mean render-cost regression is therefore about **+1.31%** on this runner; p95 is **+3.91%**. This is small enough that cover adaptation should be treated as a creative primitive, not an expensive effect.

By visual system, mean cost ratio was:

- Swiss: **1.0135**
- Newspaper: **1.0228**
- Paper: **1.0029**

Encoded output size did not materially increase: mean adaptive/generic byte ratio was **0.9884**, p95 **1.0341**.

These are runner-specific diagnostics, not provider pricing measurements.

## Useful negative result: bad fixtures, not a reason to weaken the gate

The first strict palette audit failed with only **13 unique palette signatures** from 36 fixtures.

The extractor was not the real problem. The fixture generator had produced nominally different covers that still reused a small number of underlying colour families. Lowering the diversity threshold would have made the test easier without improving the product.

We changed the **fixture set**, not the acceptance gate. The corrected set produces 36/36 unique palette signatures while still passing all contrast thresholds.

Lesson: synthetic QA data must contain the variation the test claims to exercise. A green gate over repetitive fixtures is not evidence of robustness.

## Manual review and Newspaper refinement

The review pages use this order:

1. generic hook @ 1.5s
2. adaptive hook @ 1.5s
3. generic book @ 5.2s
4. adaptive book @ 5.2s

The first green review showed a real system-specific weakness: Swiss and Paper clearly inherited cover character, while Newspaper was often too conservative, especially on neutral and low-chroma covers.

We did **not** solve that by globally increasing saturation. Newspaper received cover-derived editorial devices that preserve its black/white hierarchy: a restrained surface tint, accent rule, edge device, and structured editorial rules when cover complexity warrants them. Final review shows a stronger book-specific Newspaper identity without turning it into Swiss/Paper.

Low-chroma covers such as the neutral Newspaper fixtures still adapt more subtly. That is intentional: the system should not invent saturated colour that the source cover does not contain.

Across all reviewed pairs:

- dark/navy/amber, purple, green/teal, red/black, blue and beige covers produce coherent book-specific treatments;
- background, accent and supporting geometry move together rather than as an arbitrary tint;
- Swiss / Newspaper / Paper consume the same cover evidence differently;
- no reviewed pair showed clipping, muddy body text or unsafe CTA contrast.

## Decision

**C20 passes as a production creative primitive.**

The factory can cheaply derive deterministic art direction from a cover without AI:

```text
book cover
  -> deterministic palette + luminance + entropy + edge evidence
  -> contrast-safe art direction
  -> visual-system-specific treatment
```

This does **not** prove CTR, CPA or conversion lift. It proves that cover adaptation is robust, visibly meaningful, auditable and cheap enough to include in controlled campaign experiments.

Current limitation: v1 uses palette and simple spatial-complexity heuristics, not OCR or semantic image understanding. Neutral covers intentionally produce less dramatic variation.

## Next

1. C21 — deterministic opening / hook grammar.
2. Keep factual copy provenance explicit; do not invent claims.
3. Vary first-1.5-to-2.5-second presentation semantics while keeping the rest of the creative controlled.
4. After that, C22 — motion quality / choreography as a separate causal axis.

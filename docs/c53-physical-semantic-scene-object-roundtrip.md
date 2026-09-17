# C53 — physical inverse round-trip for semantic scene objects

C53 tests a narrow claim: whether pixels produced by the bounded C52 semantic scene-object language can be mapped back to a safe approximation of that same language without reading source IDs or source parameters.

It is **not** arbitrary image understanding and it does not use generative image models.

## Trust boundary

The benchmark is sealed in stages.

1. Hidden target payloads contain the real C52 family, parameters and lowering seed.
2. Targets are rendered through the canonical `C19 -> run-video-factory -> FAST/WebCodecs -> AAC` path.
3. Inference receives MP4 pixels plus public bounded hypotheses only.
4. Inference is persisted before hidden truth is opened.
5. Wrong accepted hypotheses are failures. `ambiguous` / abstention is first-class and must not be converted to a forced answer.

No family ID, object-program ID, parameter value or target seed is painted into target pixels.

## Phase 1 — family admission

Corpus:

- 22 C52 families;
- one hidden default-parameter target per family;
- three public reference seeds per family;
- fixed 3 s, 1080x1920 delivery;
- 88 canonical physical renders total.

Observer:

- fixed 1.5 s frame;
- 64x64 grayscale observation;
- normalized mean absolute luma residual;
- family residual = mean of the best two of three public seed references;
- admission requires both bounded residual and runner-up margin.

Measured calibration run `35260063127`:

- targets: 22;
- accepted: 11;
- correct accepted: 11;
- wrong accepted: 0;
- abstain: 11;
- coverage: 0.50;
- accepted accuracy: 1.0.

The low coverage is intentional. A parallel scout that optimized for coverage accepted wrong families, especially around `network/constellation`, `timeline/device_ui`, `chart/timeline`, `ripple/topographic`, and `mechanism` confusions. Those results are preserved as negative evidence rather than treated as success.

## Phase 2 — bounded parameter recovery

Parameter recovery runs only after a family was safely admitted in Phase 1.

For every public parameter of an admitted family, C53 creates an OAT target: exactly one parameter is changed while all others stay at their registry defaults. This keeps attribution interpretable and avoids hiding a family error inside a multi-parameter optimizer.

Before parameter fitting, the changed physical target must pass the same family admission and must agree with the Phase-1 family. Otherwise the parameter target abstains.

Candidate values come only from the public C52 parameter schema:

- number: bounded grid across `[min,max]` plus registry default;
- integer: bounded legal integer values;
- boolean: both values;
- enum: declared enum values.

A small declared seed bank is searched as an implementation nuisance. The target seed is hidden. Seed is not treated as semantic ground truth; it only helps explain deterministic geometry in families whose lowering uses the seed.

Candidate hypotheses are rasterized with the exact same C53 Canvas draw path in one Chromium session. They are not encoded to H.264 individually because the hypothesis bank is not the evidence source. The evidence source is always the canonical physical target MP4.

## Reconstruction

Accepted parameter inference is persisted before truth is opened. A fresh typed C52 object program is then constructed only from:

- admitted family;
- inferred bounded parameter value;
- inferred nuisance seed.

That reconstructed program is rendered again through canonical C19/FAST. Hidden evaluation compares:

- family correctness;
- typed parameter error;
- target-vs-reconstruction pixel residual.

Any wrong accepted parameter/reconstruction case is a hard failure. Coverage is descriptive and is never increased by silently weakening the admission rule.

## Non-goals

- no AI image generation;
- no claim of understanding arbitrary video;
- no free-form SVG/Canvas/CSS recovery;
- no mutation of C52 family definitions to make the benchmark pass;
- no universal creativity or similarity score.

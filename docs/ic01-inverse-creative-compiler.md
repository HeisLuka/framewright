# IC01 — Inverse Creative Compiler v1

IC01 is the first bounded reverse path for the NEwBOO video factory:

```text
MP4
  -> ObservationIR
  -> ranked hypotheses over the existing C43 bounded axes
  -> benchmark against hidden SceneProgram ground truth
```

It is deliberately not a generic `video -> giant JSON` system. The observer records only measured video evidence. The inference layer separately maps that evidence into the already-existing C43 vocabulary. Unsupported properties remain ambiguous instead of being fabricated.

IC01 uses its own `IC` research namespace because the settled creative roadmap already assigns C44 to batch-level template diversity and C45 to physical multi-video proof.

## 1. ObservationIR

`newboo-video-observation-v1` is produced from MP4 bytes through local `ffprobe`/`ffmpeg` only. It records:

- exact source width, height, fps, duration and frame count;
- deterministic low-resolution sampling metadata;
- hard-cut candidates from sampled frame differences;
- mean/p95 motion energy and burstiness;
- 4x4 spatial motion activity;
- 4x4 edge/appearance activity;
- edge-feature centroid displacement as a coarse motion-direction signal;
- luma statistics;
- a quantized dominant-color palette.

The observer never reads RenderSpec, SceneProgram, receipts or provenance. Ground truth is reserved for the benchmark scorer.

The observation is content-addressed as `nbobs1_<sha256>` so identical extracted evidence replays to the same identity.

## 2. Inference boundary

`newboo-inverse-creative-hypothesis-v1` ranks candidates only inside the existing automatic C43 policy surface:

- six C39 structural layouts;
- three visual systems;
- six C41 typography systems;
- six C40 motion grammars;
- six C42 cover-staging families;
- nine C41 graphic devices.

The vocabulary is loaded from `buildDefaultTemplateAutoPolicy()` and checked against the canonical C43 registry. IC01 therefore cannot silently invent a second creative language.

The v1 inference is intentionally asymmetric:

- layout gets a coarse ranking from spatial edge mass, symmetry and distribution;
- motion gets a coarse ranking from motion energy, burstiness, direction and cut cadence;
- staging gets only a weak ranking from center/edge/spread evidence;
- visual system, typography and graphic-device identity are explicitly low-confidence because v1 has no font/style/device classifier.

Every axis carries ranked candidates, confidence evidence and ambiguity. An axis below the confidence threshold remains in `explainability.unresolved_axes`.

## 3. Ground-truth benchmark

The benchmark takes the inferred hypothesis plus the original hidden C43 `SceneProgram` and reports, per axis:

- ground-truth ID;
- inferred rank;
- top-1 hit;
- top-3 hit.

It also checks delivery-aspect recovery and emits aggregate top-1/top-3 accuracy. This is a presentation-recovery benchmark, not a creativity score.

The decompiler never receives the ground-truth SceneProgram during observation or inference. Only the scorer sees it.

## 4. Commands

Create observations from an MP4:

```bash
node .agents/skills/framewright/scripts/ic01-observe-video.mjs path/to/video.mp4 --out observation.json
```

Infer bounded creative hypotheses:

```bash
node .agents/skills/framewright/scripts/ic01-infer-recipe.mjs observation.json --out hypothesis.json
```

Score against a hidden known SceneProgram:

```bash
node .agents/skills/framewright/scripts/ic01-roundtrip-benchmark.mjs \
  --observation observation.json \
  --scene-program scene-program.json \
  --out benchmark.json
```

Run acceptance:

```bash
node contracts/check-ic01-inverse-creative-compiler.mjs
```

The acceptance creates a real synthetic MP4 through ffmpeg, observes it, verifies two known hard cuts, validates palette/motion/spatial evidence and runs deterministic inference tests.

## 5. What v1 proves

IC01 v1 proves the architectural seam and the first real video path:

```text
pixels != inferred program

pixels -> measured observations -> bounded hypotheses
```

It proves that the reverse system can share the forward compiler's finite language without contaminating observations with inference or ground truth.

## 6. What v1 does not claim

IC01 does not yet claim reliable recovery of arbitrary Reels/TikToks, exact typography, masks, per-object transforms, cover instance count, camera-vs-layer motion, easing curves, OCR text, or executable SceneProgram reconstruction.

It also does not yet implement analysis-by-synthesis rerender/search or a per-pixel ResidualMap. Those are follow-up passes after the observer is benchmarked on a corpus of our own C43/C44 outputs.

The next useful benchmark is a generated corpus where each sample keeps the original SceneProgram hidden from IC01 until scoring. That corpus should measure axis top-k accuracy, cut/boundary error, confidence calibration and the fraction of axes honestly left unresolved.

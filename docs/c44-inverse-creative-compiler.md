# C44 — Inverse Creative Compiler v1

Status: EXPERIMENT. This capability does not modify the production C35 -> C27 -> C19 -> I07 -> I03 path.

## Goal

C44 tests whether an already-rendered MP4 can be mapped back into the bounded creative language already used by the factory.

The target is not original-source recovery. Multiple programs can produce observationally equivalent pixels. The target is the simplest bounded explanation supported by evidence, plus an explicit residual for everything v1 cannot identify.

```text
MP4
  -> ObservationIR
  -> bounded candidate inference
  -> InverseResult
  -> optional scorer against hidden ground truth
```

The source SceneProgram, receipt, manifest, seed, narrative plan, or provenance must never be visible to the observer or candidate inferer. Those artifacts may be read only by a benchmark scorer after inference has completed.

## V1 identifiability contract

Observed directly in v1:

- delivery width/height;
- duration and average frame rate;
- scene-change timestamps from an ffmpeg scene detector;
- temporal frame-difference energy from `tblend=difference + signalstats`;
- source MP4 SHA-256.

Inferred in v1:

- delivery aspect;
- ranked motion-grammar candidates from the bounded C40 registry.

Explicitly unresolved in v1:

- structural layout family;
- typography family;
- asset-staging family;
- graphic device identity;
- visual-system identity;
- literal copy;
- narrative semantic IDs;
- original seed;
- internal provenance IDs.

These fields must not be synthesized from missing evidence. They remain `unresolved` until a later observation pass can support them.

## ObservationIR

`newboo-video-observation-ir-v1` contains only measured facts and measurement coverage. It is deliberately separate from the inferred result.

Important fields:

- `media` — width, height, fps, duration;
- `cut_times_seconds` — observed edit boundaries;
- `motion_energy` — normalized frame-difference samples;
- `coverage` — per-dimension measurement coverage;
- `residuals` — known unobserved/unexplained dimensions;
- `observation_id` — canonical content identity.

The contract canonicalizes ordering and numeric precision before calculating identity.

## Candidate inference

V1 motion inference is intentionally simple and inspectable. It extracts a few temporal features from measured frame-difference energy, compares them with bounded signatures derived from the C40 motion-family definitions, and emits top-k candidates with confidence and evidence.

This is a baseline classifier, not a claim that the motion grammar has been uniquely recovered. Confidence is capped by observation coverage and the result retains competing candidates.

## Physical observer

```bash
node .agents/skills/framewright/scripts/c44-observe-video.mjs \
  --video path/to/video.mp4 \
  --out /tmp/observation.json
```

Optional controls:

```text
--scene-threshold 0.24
--sample-fps 10
```

Requirements: `ffprobe` and `ffmpeg` on PATH.

## Contract check

```bash
node contracts/check-c44-inverse-creative-compiler.mjs
```

The check verifies canonical identities, ordering, bounded confidence, delivery recovery, explicit unresolved axes, and behavior with no usable motion evidence.

## Benchmark boundary

The first meaningful benchmark should use factory-owned videos with hidden ground truth:

```text
C43 SceneProgram -> physical MP4 -> C44 observer -> C44 inference
                                      |
                                      +---- no access to SceneProgram

hidden SceneProgram + InverseResult -> scorer only
```

Initial metrics:

1. scene-boundary precision/recall within a frame tolerance;
2. top-1/top-k motion-family recovery;
3. confidence calibration;
4. observational-equivalence ambiguity rate;
5. explainability vector by dimension;
6. residual/unexplained coverage.

The benchmark must prefer calibrated ambiguity over forced exact recovery.

## Non-goals

C44 v1 does not claim arbitrary Reel/TikTok reconstruction, OCR, font recognition, object tracking, optical flow, semantic understanding, or pixel-perfect inverse rendering. Those are later layers only after the factory can reliably decompile its own bounded language.

## Promotion criterion

Do not promote C44 because a schema test passes. Promotion requires a physical corpus of factory-generated MP4s, hidden-ground-truth scoring, and evidence that the inferred axes are stable enough to be useful for DSL evaluation or reference ingestion without provenance leakage.

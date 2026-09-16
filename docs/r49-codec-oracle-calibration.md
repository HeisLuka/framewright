# R49 — codec oracle calibration

## Why this pass exists

R47 expanded the R31 semantic-ROI codec gate from one canonical book to six heterogeneous books and exposed a problem that a longer bitrate ladder cannot solve cleanly.

The R31 decision rule is intentionally strict: for every semantic ROI, WebCodecs SSIM against the lossless Canvas frame must be at least the corresponding x264 CRF22 SSIM. R47 showed non-monotonic exact failures and many very small negative SSIM deltas even when PSNR moves in the opposite direction. It also showed cases where SSIM improves while PSNR becomes materially worse.

Therefore the next honest question is not “what bitrate clears the gate?” but:

> What visual differences are the current scalar metrics actually reacting to, and is the exact-SSIM domination rule measuring the defect we care about?

R49 is an evidence/calibration pass only. It does not change bitrate policy, replace SSIM with PSNR, or weaken the R31 threshold after seeing R47.

## Frozen comparison

R49 reuses the exact R47 renderer, fixtures, same-raster x264 CRF22 reference and seven semantic ROIs. It rerenders only two WebCodecs policies:

- 3.0 Mbps — the current operational default;
- 3.5 Mbps — enough to reproduce the observed non-monotonic region without another broad bitrate search.

The six books remain:

- `river-station` / paper;
- `letters` / paper;
- `city-seven` / swiss;
- `observatory` / swiss;
- `long-title` / newspaper;
- `night-archive` / newspaper.

All seven ROIs are kept for every fixture. R49 does not select only the regions that made R47 look bad.

## Four views of the same evidence

For every fixture, bitrate and ROI, R49 records:

1. exact R31 SSIM result versus x264;
2. PSNR direction versus x264;
3. whether the pair falls inside the already-existing R43 semantic equivalence band (`dSSIM >= -0.005`, `dPSNR >= -1 dB`), reported only as a diagnostic reference;
4. a lossless four-panel crop in fixed order: `Canvas | x264 CRF22 | WebCodecs 3.0M | WebCodecs 3.5M`.

The R43 band is not promoted into the codec gate by this pass. It already existed elsewhere in the project, so showing it is useful for calibration without inventing a convenient new threshold after R47.

## Why visual contacts are required

R47 produced examples where SSIM and PSNR disagree on direction. A scalar-only follow-up could therefore manufacture almost any desired answer by choosing which metric to privilege.

R49 instead persists the exact semantic crops next to both metrics. This makes later oracle design inspectable against the lossless source. If the metrics disagree but the underlying crop difference is visibly meaningful, the future gate needs to preserve that sensitivity. If exact SSIM flips on visually negligible edge noise, the future rule needs a predeclared equivalence concept rather than an exact floating-point domination test.

Manual inspection is evidence for designing the next gate, not an automatic production pass/fail in R49.

## Completeness gates

CI must produce:

- 6 fixtures;
- 7 semantic ROIs;
- 2 WebCodecs policies;
- 84 codec/ROI metric comparisons;
- 42 four-panel visual contacts;
- a deterministic visual manifest;
- a fixture-level replay comparison against the canonical R47 exact-gate outcomes.

A replay mismatch is itself evidence and is reported rather than hidden. It does not make CI red unless the matrix is incomplete or the harness is broken.

## Decision boundary

The only allowed R49 decision is `ORACLE_CALIBRATION_REQUIRED` with `policy_change=false`.

After the artifact is inspected, a later pass may predeclare and test a revised codec-quality rule. That later rule must be justified before its result is known; R49 cannot retroactively turn an R47 failure into a pass.

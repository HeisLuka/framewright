# R51 — replicated semantic codec acceptance candidate

## Why

R49 showed that exact SSIM domination and PSNR can disagree on the same semantic crop, while all 13 exact-R31 SSIM failures stayed inside the already-existing R43 diagnostic equivalence band. R50 then showed that WebCodecs/OpenH264 is not bit/metric deterministic under nominally identical encodes: the original `river-station 3M` boundary itself flipped PASS/PASS/FAIL under the exact R31 rule.

R51 therefore tests a candidate gate that was fully declared before R51 evidence exists. It does not tune a new epsilon.

## Candidate gate

Use the pre-existing R43 semantic equivalence band exactly as already defined elsewhere in the project:

- `dSSIM >= -0.005` relative to same-raster x264 CRF22;
- `dPSNR >= -1 dB` relative to same-raster x264 CRF22.

For a semantic ROI to pass, **all three** repeated WebCodecs 3 Mbps encodes must satisfy **both** thresholds. A fixture passes only if all seven R31 semantic ROIs pass this replicated rule.

No majority vote and no threshold relaxation are allowed after results are visible.

## Frozen corpus split

Calibration fixtures, already used by R49:

- river-station / paper
- letters / paper
- city-seven / swiss
- observatory / swiss
- long-title / newspaper
- night-archive / newspaper

Held-out fixtures, fixed before this run and not used to motivate R49/R50:

- salt
- winter-map
- quotes
- zero-hour

The generator resolves their existing routed styles from E14 rather than changing creative routing.

## Evidence

For each of 10 fixtures:

- one same-raster x264 CRF22 reference;
- three WebCodecs 3 Mbps encodes;
- seven semantic ROI SSIM + PSNR measurements against lossless Canvas for both reference and candidates;
- `dSSIM` and `dPSNR` versus x264;
- for every rejected ROI, a persisted five-panel contact: `Canvas | x264 | WC#1 | WC#2 | WC#3`.

## Canonical result

Canonical run: `35160802719`. Artifact: `10472868408`. Artifact digest: `sha256:48944755851cebd6d358e6289038c1fbd00dbc0eafd3d1621a335116a185aa43`.

The predeclared candidate is **rejected** (`promote=false`).

- Held-out validation is clean: `salt`, `winter-map`, `quotes`, and `zero-hour` all pass, so held-out acceptance is **4/4**.
- Five of six calibration fixtures pass: `river-station`, `letters`, `city-seven`, `long-title`, and `night-archive`.
- `observatory / swiss` fails repeatably on CTA regions.

`observatory / cta_title` fails all three repeats because PSNR is roughly `-3.33 dB` versus x264 even though SSIM is **better** by about `+0.0016`. `observatory / cta_button` also fails all three repeats: SSIM is better by roughly `+0.0021…+0.0026`, while PSNR is about `-1.00…-1.14 dB`.

Persisted five-panel rejection contacts (`Canvas | x264 | WC#1 | WC#2 | WC#3`) show aligned CTA typography/layout and no gross semantic/readability defect in these sampled regions. The rejection is therefore a stable disagreement between low-level scalar reconstruction metrics, not an obvious visual failure.

## Decision

Do **not** promote the R43 `dSSIM AND dPSNR` band into the production codec acceptance contract. It is substantially more repeatable than the old exact-SSIM domination gate and it generalizes to all four held-out fixtures, but it produces a stable false-reject on `observatory` CTA content under the predeclared rule.

Do not relax either threshold after seeing this failure, do not switch to SSIM-only because that would conveniently pass `observatory`, and do not change production bitrate from this task.

The next acceptance work should target the actual defect class the factory cares about — semantic typography/structure preservation — using a predeclared structure-aware signal plus replicated encoding, while keeping lossless Canvas and x264 as references rather than scalar winners.

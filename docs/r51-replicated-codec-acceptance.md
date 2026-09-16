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

## Promotion gate

The candidate acceptance rule is promoted only if:

1. every calibration fixture passes;
2. all four held-out fixtures pass (100% held-out acceptance);
3. every ROI stays inside the candidate band on all three repeats;
4. rejected or near-boundary contacts do not expose a gross semantic/readability defect hidden by the scalar rule.

If any gate fails, R51 does not invent a replacement threshold. Production remains on the current runtime policy while codec acceptance stays unresolved.

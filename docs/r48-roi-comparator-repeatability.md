# R48 — semantic ROI comparator repeatability scout

## Question

R46/R47 showed non-monotonic WebCodecs pass/fail behavior and tiny x264-relative ROI deficits even at 4 Mbps. Before extending bitrate further or weakening the quality contract, determine whether those deficits are stochastic run noise or reproducible properties of the encoder/comparator pair.

## Method

Representative fixtures:

- `river-station / paper` — passing/control fixture;
- `letters / paper` — unresolved R47 failure;
- `long-title / newspaper` — unresolved R47 failure;
- `night-archive / newspaper` — unresolved R47 failure.

For each fixture:

- generate the same-raster x264 CRF22 reference twice;
- encode WebCodecs at 3 Mbps three times;
- encode WebCodecs at 4 Mbps three times;
- record raw H.264 and muxed MP4 SHA-256, bytes, every R31 ROI SSIM/PSNR, binary pass/fail and run-to-run metric spread.

The R31 comparator is unchanged: every semantic ROI must be at least its same-fixture x264 CRF22 SSIM.

## Decision rule

This task does **not** change bitrate policy and does **not** introduce a tolerance.

If repeated identical x264/WebCodecs encodes are byte-identical and ROI metrics have zero (or negligible measured) spread while the same small deficits recur, classify R46/R47 as a comparator-materiality/contract-calibration problem rather than stochastic encoder noise. A later task may then define a principled materiality rule using separate evidence.

If repeated encodes vary enough to flip ROI pass/fail, first characterize encoder/measurement variance; do not calibrate a fixed tolerance from a single run.

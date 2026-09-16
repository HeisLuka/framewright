# R46 — content-adaptive bitrate oracle scout

## Question

Before building any deterministic complexity score, does the current creative catalog actually contain enough codec heterogeneity for different videos to deserve different target bitrates under the established semantic quality gate?

R31 established 3 Mbps as the lowest fixed WebCodecs target that passed every measured semantic ROI on its canonical typography-heavy fixture. R35 then showed that lower single-fixture points can be non-monotonic: an isolated 2.25 Mbps pass did not make a safe production policy. R46 therefore tests the prerequisite for adaptive bitrate rather than assuming it.

## Fixture set

Three `hook-first / vertical` creatives deliberately cover the three current visual systems:

- `river-station` — paper;
- `city-seven` — swiss;
- `long-title` — newspaper.

Each fixture is encoded from the same Chromium Canvas raster to:

- x264 CRF22 same-raster reference;
- WebCodecs at 2.00 / 2.25 / 2.50 / 2.75 / 3.00 Mbps.

The quality oracle reuses the R31 semantic regions for hook, book cover, book title, book hook, CTA cover, CTA title and CTA button. A WebCodecs point passes only when every ROI SSIM is at least the same fixture's x264 CRF22 ROI SSIM.

## Stability rule

A low bitrate is not considered usable merely because that single point passes. The `lowest stable PASS` for a fixture is the lowest ladder point for which that point **and every higher bitrate point** pass the semantic-ROI gate. This explicitly rejects the kind of non-monotonic isolated pass seen during R35.

## Promotion gate

A complexity model earns implementation only if:

1. every representative fixture has a stable passing point at or below 3 Mbps;
2. at least two different stable bitrate steps are selected across the three visual systems, proving content-dependent separation rather than one new global bitrate;
3. equal-weight projected encoded-byte savings versus fixed 3 Mbps are at least **20%**;
4. no semantic ROI is weakened relative to its same-raster x264 CRF22 reference.

If the oracle fails this prerequisite, do not build complexity scoring, per-job bitrate routing or new production policy. Fixed 3 Mbps remains the safe software default.

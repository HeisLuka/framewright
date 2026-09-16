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

## Canonical result

GitHub Actions run `35155585167`, artifact `10470029892`:

| fixture | style | lowest stable PASS | bytes saved vs 3M | 3M result |
|---|---|---:|---:|---|
| river-station | paper | 2.75 Mbps | 4.1% | PASS |
| city-seven | swiss | none <=3M | n/a | FAIL |
| long-title | newspaper | none <=3M | n/a | FAIL |

`river-station` reproduces the non-monotonic shape that motivated the stability rule: 2.00M PASS, 2.25M PASS, 2.50M FAIL, then 2.75M and 3.00M PASS. Therefore its usable floor is 2.75M, not either lower isolated pass, and the byte saving is only 4.1%.

The other two visual systems expose a more important issue than adaptive savings. At 3 Mbps:

- `city-seven / swiss` misses the same-raster x264 reference by `0.000164` SSIM on `hook` and `0.000050` on `book_hook`;
- `long-title / newspaper` misses by `0.000125` on `cta_cover` and `0.000566` on `cta_title`.

Their mean/worst ROI summaries remain high, but the established R31 contract is binary: **every semantic ROI must be >= the same-raster x264 CRF22 ROI**. Under that contract, neither fixture passes at 3 Mbps.

## Decision

**Do not implement a content-adaptive bitrate model.** Only one of three representative visual systems has a stable passing point at or below 3 Mbps, and its byte saving is only 4.1%, far below the 20% gate.

R46 also invalidates a stronger inference from the single R31 fixture: **3 Mbps is not yet proven as a catalog-wide x264-relative semantic-ROI floor.** Keep 3 Mbps as the current runtime default while the replacement is being measured, but do not describe it as universally clearing the R31 oracle across visual systems.

The follow-up is R47: extend the upper bitrate ladder across multiple books per visual system and determine a robust catalog floor without weakening the quality threshold.

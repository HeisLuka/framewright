# R47 — catalog-wide semantic ROI bitrate floor

## Why this exists

R46 rejected content-adaptive bitrate, but it also exposed a more important policy gap. The old R31 conclusion — 3 Mbps is the lowest fixed target that clears every semantic ROI versus same-raster x264 CRF22 — was proven on one canonical `paper` fixture. R46 then found that `city-seven / swiss` and `long-title / newspaper` still miss that strict oracle at 3 Mbps.

R47 asks a narrower question: **what bitrate floor is actually robust across the current visual systems?**

This is not permission to weaken the R31 threshold and not another adaptive-bitrate experiment.

## Matrix

Six `hook-first / vertical` fixtures, two per routed visual system:

- paper: `river-station`, `letters`;
- swiss: `city-seven`, `observatory`;
- newspaper: `long-title`, `night-archive`.

Each fixture gets a same-raster x264 CRF22 reference and WebCodecs candidates at:

`3.00 / 3.25 / 3.50 / 3.75 / 4.00 Mbps`.

The oracle is unchanged from R31/R46: hook, book cover/title/hook and CTA cover/title/button; **every ROI SSIM must be >= the same fixture's x264 CRF22 ROI SSIM**.

## Stability rule

A bitrate is a fixture's usable floor only if that point and every higher tested point pass. Isolated lower passes do not count. This protects the decision from the non-monotonic behavior already seen in R35 and R46.

## Decision rules

1. The catalog sample has a robust global floor only if all six fixtures have a stable pass inside the tested ladder.
2. The global floor is the maximum of the six per-fixture stable floors.
3. A style-specific policy is considered only if both sampled books inside each style support a stable style floor and using those style floors saves at least **20% encoded bytes** versus the robust global floor.
4. Otherwise prefer one global target; do not add style routing for small byte wins.
5. If 4 Mbps still does not establish a global floor, do not guess upward or weaken the quality oracle; extend the bounded ladder in a follow-up.

R47 is evidence generation. Any production default change must preserve the existing codec/profile/content/latency settings and be recorded explicitly after the canonical run.

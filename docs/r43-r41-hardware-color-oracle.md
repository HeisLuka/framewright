# R43 — close the R41 hardware color gate in the same paid-host run

## Why this exists

R41 correctly refuses to promote Intel hardware from throughput/economics alone, but the merged harness currently leaves `decision.colorGate` as `pending R39/R40 oracle on saved c1 samples`. That means a real paid bare-metal run can finish with incomplete promotion evidence and require a second host session.

R43 closes that gap without changing the R41 performance or economics gate.

## Trigger

The color oracle runs only when the existing R41 matrix earns its predeclared performance/economics deep pass:

- all jobs valid;
- real Intel Video-engine activity proven;
- hardware/software same-host cost-per-100k ratio <= 0.80.

If performance does not earn the deep pass, the oracle is skipped and software remains STANDARD. This avoids spending extra benchmark time on a hardware path that already lost economically.

## Oracle workload

The oracle uses the same Chromium executable, WebCodecs H.264 Baseline/realtime policy, 3 Mbps target and hardware-acceleration flags as R41.

It runs two bounded references under both `prefer-software` and `prefer-hardware`:

1. The R39 deterministic 1080x1920 RGB patch/ramp chart.
2. The exact `river-station / paper / hook-first / vertical` representative C18 fixture used by the earlier color/semantic work.

The browser hardware oracle has its own `intel_gpu_top` window. `prefer-hardware` is not accepted as proof by itself.

## Predeclared color gate

Hardware passes only when all of the following are true:

- the software reference itself passes the R39 synthetic absolute gate;
- hardware synthetic mean absolute channel error <= 6;
- hardware synthetic max absolute channel error <= 18;
- neutral cast <= 4;
- black mean <= 6;
- white mean >= 249;
- grayscale remains monotonic;
- hardware mean RGB error is no more than 2 points worse than the same-host software reference;
- hardware max RGB error is no more than 8 points worse than software;
- emitted `range / matrix / transfer / primaries` match the same-host software reference for both synthetic and representative-book streams;
- every semantic ROI is within `-0.005 SSIM` and `-1 dB PSNR` of software on the exact same lossless Canvas reference;
- oracle-window Intel Video-engine max busy >= the R41 proof threshold (default 5%).

The metadata equality is intentional. R40 defined the current software path as a measured reference contract containing both decoded RGB behavior and emitted metadata. A candidate with different metadata is not silently treated as equivalent merely because one decoder happens to reconstruct similar RGB.

## Decision composition

The existing R41 report remains the canonical report. When the performance gate passes, the oracle writes `color-oracle.json` and then updates the R41 report:

- `decision.colorGate = pass | fail`;
- `decision.standardEligible = performanceEarned && colorOracle.pass`;
- failure leaves the current software Chromium path as STANDARD.

A negative color result is valid evidence. CI/harness success means the measurement completed, not that hardware must win.

R43 does not change bitrate, codec profile, creative rendering, concurrency sweep, provider price input, or the R41 >=20% cost-per-100k improvement threshold.

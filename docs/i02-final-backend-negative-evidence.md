# I02 — final FAST backend comparison: negative browserless evidence

## Decision

Keep Chromium Canvas -> WebCodecs as the software STANDARD. Do not promote the browserless `@napi-rs/canvas -> raw RGBA -> FFmpeg libx264` path, and do not spend another software pass building a browserless typography-compatibility layer unless a future hardware/provider regime materially changes the economics.

This document records the completed negative experiment from closed PR #81 so the result is discoverable from the shared research tree. It does not weaken the original parity thresholds and does not reinterpret failed parity as backend equivalence.

## Canonical evidence

GitHub Actions run `35155379394`.
Artifact `10469894573`.
Artifact digest `sha256:39f52a0c269ce60f0ec538f235350936ba5663cf83bc7f03882ec105494b013d`.

Workload: the canonical I03 physical scene, 1080x1920, 30 fps, 360 frames / 12 s, 3 Mbps target, no audio. Chromium uses the shared FAST `avc1.420028` path. The browserless candidate uses `@napi-rs/canvas`, raw RGBA, and FFmpeg libx264 `veryfast`.

The experiment predeclared semantic parity as a prerequisite for interpreting backend timing/economics: all six sampled frames must have SSIM >= 0.97 and PSNR >= 30 dB against the Chromium Canvas raster.

| frame | SSIM | PSNR dB | gate |
|---:|---:|---:|---|
| 0 | 0.999995 | 74.727 | pass |
| 89 | 0.999995 | 74.727 | pass |
| 90 | 0.996881 | 32.545 | pass |
| 239 | 0.948868 | 20.351 | **fail** |
| 240 | 0.996595 | 32.147 | pass |
| 359 | 0.962820 | 20.992 | **fail** |

Full decoded-video agreement was SSIM `0.961179`, PSNR `21.178443` dB. The parity prerequisite therefore failed and backend economics are not considered apples-to-apples.

## Why the parity miss is substantive

Artifact inspection of the lossless checkpoint PNGs shows a layout difference, not merely codec/raster noise. At frame 239 the Chromium version lays the lower hook copy in three lines while `@napi-rs/canvas` lays it in four; title and smaller text metrics also differ. Later plates therefore have materially different typography geometry.

This means browserless parity would require a compatibility/layout effort rather than a small encoder or color fix. That work is not earned by the current candidate.

## Diagnostic performance only

These values are retained as diagnostics, not as a backend ranking because parity failed:

- Chromium FAST inner run: `3550.688 ms`, output `1,910,539` bytes.
- Browserless reference: `5919.9 ms`, `608.12 videos/hour`, output `2,377,922` bytes, process-tree RSS `679.63 MiB`, cgroup CPU `16,540 ms`.

The browserless candidate is therefore not showing a performance signal strong enough to justify a typography-compatibility project even before a valid apples-to-apples comparison exists.

## Research boundary

Closed PR #81 intentionally failed its original CI at the semantic-parity precondition. That is valid negative evidence, not an infrastructure failure. The thresholds remain unchanged: SSIM >= 0.97 and PSNR >= 30 dB at every checkpoint.

Revisit browserless software rendering only if a substantially different backend or hardware path changes the expected machine economics enough to pay for semantic compatibility work. Do not reopen the current `@napi-rs/canvas -> RGBA -> libx264` path based on its lower browser dependency alone.

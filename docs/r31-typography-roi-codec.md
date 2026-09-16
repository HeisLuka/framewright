# R31 — typography ROI codec policy scout

## Question

Global full-frame SSIM can hide the exact failure mode that matters for a book ad: hook/title/CTA edges or the cover becoming visibly worse while the background still dominates the score. R31 moves the codec gate from full-frame averages to deterministic semantic regions.

## Fixture

Use the existing C18 `river-station / paper / hook-first / vertical` 1080x1920 creative. Do not alter creative routing, layout, motion or assets.

## Common raster reference

Both codec families are judged against the same Chromium Canvas frames. The x264 CRF22 reference is encoded from the exact same full Canvas timeline via a PNG image pipe, so this pass isolates codec damage rather than Chromium-vs-node raster differences.

## Semantic ROIs

Sample stable moments after entrances and score:

- hook text;
- book cover;
- book title;
- book-scene hook/copy;
- CTA cover;
- CTA title;
- CTA button/text.

The first scout compares x264 CRF22 against Chromium WebCodecs fixed 2/3/4/5 Mbps. Each WebCodecs policy only passes when every semantic ROI reaches or exceeds the corresponding x264 ROI SSIM against the lossless Canvas reference.

## Canonical result

GitHub Actions run `35141867150`, artifact `10465487001`, Ubuntu 24.04 / Node 20.20.2 / FFmpeg 6.1.1.

| policy | encoded bytes | encode wall | ROI SSIM mean | ROI SSIM worst | every semantic ROI >= x264 |
|---|---:|---:|---:|---:|---|
| x264 CRF22 | 0.56 MiB | 8.25 s | 0.980595 | 0.948084 | reference |
| WebCodecs 2 Mbps | 1.20 MiB | 2.38 s | 0.985802 | 0.958287 | **FAIL** |
| WebCodecs 3 Mbps | 1.42 MiB | 2.34 s | 0.986204 | 0.961759 | **PASS** |
| WebCodecs 4 Mbps | 1.65 MiB | 2.14 s | 0.986303 | 0.957067 | **PASS** |
| WebCodecs 5 Mbps | 1.87 MiB | 2.16 s | 0.987118 | 0.962740 | **PASS** |

The important result is not the global average: 2 Mbps looks strong in aggregate but loses to the x264 reference in at least one semantic ROI. The smallest fixed-bitrate policy that clears every measured hook/title/CTA/cover region is **3 Mbps**.

At that passing point WebCodecs is about 3.5× faster in encode wall than the x264 reference in this controlled run, but produces about 2.54× as many video bytes. This is a quality/throughput policy result, not yet a provider cost verdict; storage/egress economics still need the final machine-economics pass.

## Decision

- Use **3 Mbps at 1080×1920** as the current lowest validated fixed-bitrate WebCodecs policy for this canonical typography-heavy fixture.
- Do not accept 2 Mbps as the production default from full-frame SSIM alone.
- Quantizer/content-adaptive QP does **not** earn a deep pass yet because a simple fixed-bitrate policy already clears the semantic quality gate.
- Scene-boundary keyframes remain closed by I02 evidence.
- Revalidate the bitrate ladder across additional visual systems/profiles before treating 3 Mbps as universal; this run proves the gate and one canonical point, not every creative.

## Metrics

- per-ROI SSIM and PSNR;
- worst and mean semantic ROI quality;
- encoded bytes;
- encode wall;
- pass/fail vs exact-same-raster x264 CRF22.

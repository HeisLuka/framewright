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

## Escalation rule

- If a fixed bitrate clears every ROI, choose the smallest passing bitrate and do not add quantizer complexity yet.
- If no fixed bitrate clears the ROI target, quantizer/content-adaptive policy earns a bounded follow-up.
- Scene-boundary keyframes are not reopened here: I02 already found they were not a major global-quality lever.

## Metrics

- per-ROI SSIM and PSNR;
- worst and mean semantic ROI quality;
- encoded bytes;
- encode wall;
- pass/fail vs exact-same-raster x264 CRF22.

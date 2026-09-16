# E04 results — intermediate transport codec

GitHub Actions run: `35083213413`

Workload: `examples/book-ad-v0`, 1080×1920, 360 frames, 12 s, one browser page. The scene/template is unchanged. Only the canvas transport format changes.

## Matrix

| mode | intermediate MB | browser inner ms/frame | evaluate wall ms/frame | final x264 encode s | final MP4 KiB | SSIM vs PNG-reference MP4 | PSNR |
|---|---:|---:|---:|---:|---:|---:|---:|
| PNG | 48.71 | 20.742 | 23.002 | 3.795 | 447.8 | 1.000000 | — |
| JPEG q95 | 35.61 | 24.770 | 26.710 | 3.038 | 459.1 | 0.998815 | 49.409572 |
| JPEG q85 | 25.43 | 22.994 | 24.513 | 3.055 | 510.2 | 0.998170 | 47.754869 |
| WebP q90 | 13.09 | 128.323 | 129.916 | 2.345 | 465.6 | 0.998730 | 49.259901 |

All final videos in this transport experiment use the same `libx264 -preset veryfast -crf 22`, so the final-encode column is directly comparable inside E04.

## Interpretation

Reducing intermediate bytes with another image codec does not solve the transport problem.

- JPEG q95 reduces frame bytes by ~27%, but browser-side frame/codec time increases by ~19% versus PNG.
- JPEG q85 roughly halves intermediate bytes, but evaluate wall time is still slower than PNG and quality drops further.
- WebP q90 cuts intermediate bytes by ~73%, but browser-side encoding becomes ~6× slower and is unusable for this workload.
- The smaller/lossy intermediates also change the final H.264 output; JPEG q85 actually produces a larger final MP4 than the PNG-reference path at the same H.264 settings.

The important result is that the expensive unit is not merely the number of bytes crossing Browser → Node. The browser image-encoding step itself is substantial. Trading PNG for another compressed image format just moves cost around and can make it worse.

## Decision

Do not pursue JPEG/WebP as the production frame transport.

The next transport experiment should remove per-frame image encoding entirely: send raw RGBA outside the normal `toDataURL`/CDP image path and stream directly into FFmpeg. Because 1080×1920 RGBA is ~8.3 MB/frame (~249 MB/s at 30 fps), this must be measured as a binary streaming path rather than assumed to be faster.

A useful architecture to test is a local binary channel between the Chromium page and the Node renderer (for example WebSocket or another binary IPC path), with FFmpeg consuming `rawvideo` from stdin. This keeps the current JS/Canvas scene layer intact while eliminating PNG/base64/temp files.

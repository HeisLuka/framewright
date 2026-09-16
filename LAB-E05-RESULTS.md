# E05 results — raw RGBA over per-frame HTTP

Canonical CI run: `35083631059`

Workload: `examples/book-ad-v0`, 1080×1920, 30 fps, 360 frames, 12 s. Both paths use `libx264`, preset `veryfast`, CRF 22.

## Result

| path | render/stream | encode | end-to-end | temp frames |
|---|---:|---:|---:|---:|
| PNG → disk → x264 | 9.631 s | 4.971 s | 14.602 s | 48.71 MiB |
| raw RGBA → one HTTP POST per frame → x264 stdin | 184.631 s | concurrent | 185.202 s | 0 |

The first raw transport design is therefore **not viable**: it is ~12.7× slower end-to-end than the PNG baseline (`0.079×` speedup).

## What actually became slow

The raw frame itself is 1080×1920×4 = `8,294,400 bytes` (~7.91 MiB), so 360 frames move `2,985,984,000 bytes` (~2.78 GiB) before H.264 compression.

Measured per frame in Chromium:

- scene render: mean `2.341 ms`, p95 `3.6 ms`;
- `getImageData` readback: mean `7.206 ms`, p95 `7.5 ms`;
- `fetch()` send/wait: mean `335.280 ms`, p95 `346 ms`;
- total frame wall: mean `512.845 ms`.

This is important: **Canvas composition and GPU/Canvas readback are not the reason E05 failed**. The failure is the transport protocol used by this experiment: 360 sequential HTTP requests, each carrying an 8.29 MB body, while the response is held until the request has been consumed and FFmpeg backpressure has cleared.

The implementation couples browser upload latency to encoder drain on every frame. It is therefore a deliberately simple probe, not a production transport.

## Quality

Decoded output is pixel-identical to the PNG-reference encode:

- SSIM: `1.000000`;
- PSNR: `∞` (the summary JSON parser recorded `null` because its numeric regex did not match `inf`).

So the raw RGBA path itself preserves visual data exactly before the same H.264 settings.

## Decision

1. Keep the finding that raw RGBA can preserve exact output parity.
2. Reject **request-per-frame HTTP** as the browser→Node transport.
3. Do not interpret E05 as evidence that raw video or Canvas readback is intrinsically too slow.
4. Next experiment: one long-lived binary upload stream for all frames, with Node piping that request directly into FFmpeg stdin and applying backpressure at stream level rather than request level.
5. If the persistent stream is still materially worse than PNG, stop spending time on browser→Node raw transport and test browser-side video encoding (WebCodecs) or a non-browser Canvas backend.
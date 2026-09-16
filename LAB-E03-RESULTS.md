# E03 results — encoder matrix

GitHub Actions run: `35082861195`

Workload: `examples/book-ad-v0`, 1080×1920, 360 frames, 12 s at 30 fps. The PNG sequence was rendered once, then reused for every encode combination so Chromium/render cost is excluded from this experiment.

## Matrix

| preset | CRF | encode s | fps | size KiB | speedup vs slow/22 | size ratio | SSIM | PSNR |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| veryfast | 18 | 3.682 | 97.781 | 638.7 | 1.318 | 1.268 | 0.998872 | 52.137555 |
| veryfast | 22 | 3.530 | 101.983 | 447.9 | 1.374 | 0.889 | 0.998330 | 48.941411 |
| veryfast | 26 | 3.503 | 102.757 | 312.6 | 1.385 | 0.621 | 0.997448 | 45.656004 |
| fast | 18 | 4.885 | 73.694 | 697.6 | 0.993 | 1.385 | 0.999333 | 55.092749 |
| fast | 22 | 4.695 | 76.679 | 506.5 | 1.033 | 1.006 | 0.998900 | 51.873680 |
| fast | 26 | 4.686 | 76.827 | 368.4 | 1.035 | 0.732 | 0.998358 | 48.530392 |
| medium | 18 | 4.425 | 81.348 | 686.5 | 1.096 | 1.363 | 0.999375 | 55.536563 |
| medium | 22 | 4.507 | 79.882 | 509.4 | 1.076 | 1.012 | 0.998977 | 52.253978 |
| medium | 26 | 4.363 | 82.517 | 376.5 | 1.112 | 0.748 | 0.998450 | 48.983274 |
| slow | 18 | 5.052 | 71.258 | 679.8 | 0.960 | 1.350 | 0.999398 | 55.725757 |
| slow | 22 | 4.851 | 74.207 | 503.6 | 1.000 | 1.000 | 0.998982 | 52.462503 |
| slow | 26 | 4.801 | 74.985 | 373.9 | 1.010 | 0.743 | 0.998518 | 49.140072 |

Exact `slow / CRF 22` output: 515,644 bytes. Exact `veryfast / CRF 22` output: 458,616 bytes.

## Interpretation

`veryfast / CRF 22` is the strongest production candidate for this workload:

- ~1.37× faster than the upstream `slow / CRF 22` baseline;
- ~11% smaller MP4;
- SSIM drops by only 0.000652;
- PSNR drops by ~3.52 dB;
- side-by-side inspection of the saved 1080×1920 sample frame did not reveal an obvious difference in typography, flat fills or cover line work.

`medium / CRF 22` is not compelling: it is only ~1.08× faster than `slow / 22` and produces essentially the same file size.

`veryfast / CRF 26` is a useful low-bandwidth/low-cost candidate at ~312.6 KiB with nearly identical encode time, but its lower SSIM/PSNR means it should not replace the quality baseline without a broader visual QA pass across text sizes and covers.

## Decision

Do not keep upstream `preset slow` as the default production assumption for mass book ads. Use `veryfast / CRF 22` as the current candidate baseline for subsequent cost and transport experiments, while keeping the old `slow / 22` numbers as the historical control.

Do not modify `build.sh` on the shared baseline yet. First complete the transport experiment and then make one explicit production-profile change with both encoder and transport evidence behind it.

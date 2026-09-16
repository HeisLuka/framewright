# E02 results — Book Ad Template v0

Canonical result commit: `ec56ae6327089e0431bade91e1eca9d9534321b2`

GitHub Actions run: `35045161835`

Environment recorded by the profiler:

- Linux x64 / GitHub Actions Ubuntu runner
- Node `v20.20.2`
- 4 vCPU, `AMD EPYC 9V74 80-Core Processor`
- ~15.6 GiB RAM
- Puppeteer/Chromium render path
- FFmpeg/libx264 baseline build path

The workload is `examples/book-ad-v0`: 12 s, 30 fps, 360 frames, 9:16, no full-frame JavaScript pixel post-processing.

## Stage matrix

| case | aggregate fps | scene ms | trivial post ms | PNG encode ms | approx. CDP ms | base64 decode ms | disk write ms | temp PNG |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 720 / 1 tab | 77.758 | 0.367 | 0.853 | 7.780 | 1.949 | 0.053 | 0.121 | 28.16 MiB |
| 720 / 5 tabs | 113.100 | 1.002 | 1.505 | 13.356 | 19.898 | 0.066 | 1.849 | 28.16 MiB |
| 1080 / 1 tab | 49.471 | 0.384 | 1.487 | 14.729 | 2.516 | 0.077 | 0.132 | 48.71 MiB |
| 1080 / 5 tabs | 117.587 | 0.690 | 3.101 | 27.030 | 5.367 | 0.106 | 0.192 | 48.71 MiB |

The 720/5 CDP result is an outlier relative to the other cases and an earlier successful run, so it should not be treated as a stable per-stage constant. The 1080 measurements are much more consistent across repeated CI runs.

## What the 1080 / 1-tab profile says

For the clean single-tab case, the measured stage subtotal is ~19.33 ms/frame:

- scene composition: `0.384 ms` (~2.0%)
- trivial canvas post/copy: `1.487 ms` (~7.7%)
- PNG encode: `14.729 ms` (~76.2%)
- approximate CDP transfer: `2.516 ms` (~13.0%)
- base64 decode: `0.077 ms` (~0.4%)
- disk write: `0.132 ms` (~0.7%)

So about **90% of the measured single-tab frame cost is the PNG/CDP/base64/disk transport path**, not book-ad scene composition.

This is the strongest E02 result: for a cheap book-ad visual system, rewriting the scene DSL in Rust/C++ would currently attack the wrong part of the pipeline.

## Parallelism

At 1080p, moving from 1 tab to 5 tabs increased aggregate render throughput from `49.47 fps` to `117.59 fps`, about **2.38×**, on a 4-vCPU runner.

That is useful but far from 5×. Per-frame PNG/post time rises under contention, so simply adding more tabs is not a free scaling strategy.

At 720p the measured speedup in this run was only ~1.45× and the CDP stage was unusually noisy. Concurrency should be tuned per worker rather than hardcoded to five tabs.

## End-to-end canonical run

1080×1920, 360 frames, 5 tabs, existing `build.sh` (`libx264`, preset `slow`, CRF 22):

- instrumented render process: `3.63 s`
- FFmpeg build: `4.85 s`
- total benchmark wall time: `8.54 s`
- output: H.264, 1080×1920, exactly 360 frames, exactly 12.0 s
- final MP4: `515,644 bytes` (~0.49 MiB)
- temporary PNG frames: `51,071,439 bytes` (~48.71 MiB)

For this one isolated runner, that total wall time is equivalent to roughly **421 sequential 12-second videos/hour** if sustained. This is a throughput observation, **not** a production cloud-cost claim; startup, orchestration, queueing and provider pricing still need separate accounting.

The existing slow x264 encode already consumes ~57% of end-to-end benchmark wall time. If the PNG transport is removed, encoding will become an even larger share unless the encoder settings change too.

## Visual QA

The ordinary Cyrillic fixture passes the sampled contact sheet: hook, cover/title/author block and CTA stay inside the intended composition and vertical safe region.

The first long-copy run exposed two real layout defects:

1. `textBlock()` ellipsized at the initial font size instead of shrinking first;
2. the book-scene author line could overflow the narrow right column.

Commit `ec56ae6` replaced that behavior with box-aware fitting (`maxW + maxH + maxLines`) and single-line font fitting.

After the fix, the long fixture renders the full stress-test hook and title, the long author stays inside the column, and the CTA remains readable without source changes. This is the desired `Template + Payload` behavior.

## E02 decision

E02 answers the architecture question clearly enough to move on:

1. `Template + BookAdPayload` works as the production model; one HTML template can render materially different books without rewriting the source.
2. For this cheap visual system, Canvas scene composition is not the bottleneck.
3. The current PNG/dataURL/CDP path is the dominant render cost and should be the next renderer experiment.
4. The existing `libx264 -preset slow` build is already the largest end-to-end stage and deserves a separate encoder matrix immediately after transport work.
5. Keep JS/TS as the scene/template layer unless later profiles produce contrary evidence.

Next experiment: eliminate per-frame PNG/base64/disk from the book-ad path while preserving visual output, then compare end-to-end wall time and quality against this E02 baseline.

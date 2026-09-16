# E09 — pinned browserless worker 100-video soak

Canonical soak run: `35092934500`, job `104783306282`.

The GitHub Actions workflow is marked failed only because the final optional Markdown-summary shell heredoc had an indentation/syntax error. The 100-video soak itself completed successfully, the validator passed, and the artifact was uploaded. Treat the render/soak/validation result below as valid; fix the reporting step separately.

## Pinned worker

- base: `node:20.20.2-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0`;
- Node `v20.20.2`;
- `@napi-rs/canvas` **1.0.9**;
- FFmpeg `5.1.9-0+deb12u1`;
- pinned DejaVu Sans;
- no Chromium/Puppeteer in the hot worker image;
- Docker image ID in this run: `sha256:d519a559fdb31819a713867c729b7d53b3f2a2ab97b9b9055f65a4ed14e62d72`.

Host observed inside the canonical run:

- Linux x64;
- 4 logical CPUs;
- AMD EPYC 7763 64-Core Processor;
- ~15.6 GiB host RAM;
- container limited to 4 CPU and 4 GiB memory.

## Workload

- 100 complete videos in one long-lived Node process;
- cycles the 10 E08 Cyrillic/Latin payload + raster-cover stress fixtures;
- 1080x1920;
- 30 fps;
- 12 s / 360 frames per video;
- raw RGBA -> FFmpeg;
- `libx264 veryfast / CRF 22`;
- one video at a time (sequential soak).

## Throughput

- total: **552.369 s / 9.21 min**;
- throughput: **651.74 videos/hour**;
- mean: `5.504 s/video`;
- p50: **5.320 s**;
- p95: **7.004 s**;
- max: `7.200 s`;
- layout warning groups: **0**.

This is consistent with E08's 641.9 videos/hour and gives a stronger long-lived-worker baseline.

## Memory

- peak combined Node + FFmpeg RSS: **726.3 MiB**;
- Node RSS min: `195.5 MiB`;
- Node RSS max: `314.0 MiB`;
- first-quartile Node RSS median: **246.4 MiB**;
- last-quartile Node RSS median: **243.3 MiB**;
- quartile delta: **-3.18 MiB**;
- linear fitted slope: `+70.5 KiB/video`.

The positive linear slope is tiny relative to the per-video RSS oscillation and conflicts with the stronger quartile test, whose median is lower at the end than at the beginning. Across this 100-video run there is **no practical monotonic memory-growth signal**.

This is evidence against an obvious short/medium-run leak, not a proof of infinite stability. A production soak can later extend to 1k+ videos, but memory is no longer a blocker for provider benchmarking.

## Cost normalization

At the measured **651.74 videos/hour**, 100,000 videos require about **153.44 worker-hours** before provider-specific performance differences.

Using current published hourly prices only as a normalized envelope (not provider benchmarks):

| published plan | USD/hour | normalized USD/1k | normalized USD/100k |
|---|---:|---:|---:|
| Hetzner CPX32 EU shared | 0.0673 | 0.103 | 10.33 |
| DigitalOcean Basic 4 vCPU | 0.07143 | 0.110 | 10.96 |
| Google C4D standard-4 Spot | 0.079774236 | 0.122 | 12.24 |
| DigitalOcean CPU-Optimized 4 vCPU | 0.125 | 0.192 | 19.18 |
| Hetzner CCX23 EU dedicated | 0.1626 | 0.249 | 24.95 |
| Google C4D standard-4 on-demand | 0.187114224 | 0.287 | 28.71 |

These numbers answer only the scale question. Actual $/video must use throughput measured on the exact provider SKU.

## Decision

The pinned browserless worker is stable enough to move to real priced-compute tests. Do not spend more time on Chromium transport or a full renderer rewrite for the STANDARD/editorial workload.

Next high-value measurements:

1. real shared 4-vCPU VM throughput + variance;
2. real dedicated 4-vCPU VM throughput;
3. concurrency 1/2/4 on the same VM;
4. optional ARM price/performance probe when a suitable instance is available.

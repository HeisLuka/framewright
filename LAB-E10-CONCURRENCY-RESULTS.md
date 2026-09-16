# E10 — pinned worker concurrency 1 / 2 / 4

Canonical CI run: `35094835897` (PR #19).

## Question

Given the pinned E09 browserless worker on a 4-vCPU budget, should one worker render one video at a time or run multiple Node Canvas + FFmpeg jobs concurrently?

## Workload

Same STANDARD Book Ad workload as E08/E09:

- 1080x1920;
- 30 fps;
- 12 s / 360 frames;
- pinned DejaVu Sans + raster covers;
- `@napi-rs/canvas 1.0.9 -> raw RGBA -> libx264 veryfast / CRF22`;
- 30 complete videos per concurrency case;
- container limited to 4 CPUs / 4 GiB;
- host: 4 logical CPUs, AMD EPYC 7763.

E10 samples RSS for the **actual full process tree** while each case runs: matrix process + all Node render workers + their FFmpeg children.

## Result

| concurrency | videos/hour | speedup vs c1 | parallel efficiency | p50/video | p95/video | peak process-tree RSS |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 642.50 | 1.000x | 100.0% | 5.393 s | 6.957 s | 768.7 MiB |
| 2 | 744.64 | 1.159x | 57.9% | 9.505 s | 10.140 s | 1350.8 MiB |
| 4 | **771.15** | **1.200x** | 30.0% | 18.058 s | 18.744 s | 2626.8 MiB |

All cases rendered 30/30 videos with zero layout warnings.

## Interpretation

The workload is already CPU-heavy enough that concurrency does **not** scale linearly. Four simultaneous videos produce only ~20% more aggregate throughput than one, while per-video latency grows from ~5.4 s to ~18.1 s.

`c2 -> c4` adds only ~3.56% aggregate throughput (`744.64 -> 771.15 videos/hour`) while roughly doubling process-tree memory and almost doubling per-video latency.

This is still useful for pure batch economics because a fixed-price 4-vCPU VM is paid by the hour: if the queue is large and per-video latency is irrelevant, c4 gives the lowest measured compute per output. But c2 is the more conservative latency/RAM mode and loses very little aggregate throughput.

## Normalized cost effect

At c4's measured `771.15 videos/hour`, 100,000 STANDARD videos require about **129.68 worker-hours**, versus ~155.6 hours at the E10 c1 rate.

Using the same current published prices as the E09 envelope (still **not provider benchmarks**):

| published plan | USD/hour | normalized USD/1k at c4 | normalized USD/100k at c4 |
|---|---:|---:|---:|
| Hetzner CPX32 EU shared | 0.0673 | 0.087 | 8.73 |
| DigitalOcean Basic 4 vCPU | 0.07143 | 0.093 | 9.26 |
| Google C4D standard-4 Spot | 0.079774236 | 0.103 | 10.35 |
| DigitalOcean CPU-Optimized 4 vCPU | 0.125 | 0.162 | 16.21 |
| Hetzner CCX23 EU dedicated | 0.1626 | 0.211 | 21.09 |
| Google C4D standard-4 on-demand | 0.187114224 | 0.243 | 24.26 |

The c2-vs-c4 cost difference is tiny compared with provider-to-provider CPU performance variance. Do not overfit the GitHub runner: carry c1/c2/c4 into the real provider benchmark.

## Decision

- **Batch throughput mode:** concurrency 4 on a 4-vCPU worker is the current measured maximum and stays comfortably below a 4 GiB memory ceiling.
- **Balanced mode:** concurrency 2 when lower per-video latency / larger memory margin matters; it gives ~96.6% of c4 aggregate throughput.
- **Latency/reference mode:** concurrency 1.
- Do not test higher local concurrency before provider benchmarks; c4 parallel efficiency is already only 30%, so the next uncertainty is the provider CPU, not worker-count tuning on GitHub Actions.

Next step: run the exact pinned E09/E10 worker contract on actual priced shared and dedicated VMs, recording c1/c2/c4 throughput and deriving $/video from the **measured provider result**.

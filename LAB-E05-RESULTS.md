# E05 results — worker throughput / warm Chromium economics

Canonical benchmark commit: `10c124b426a2691e6c55e5f7959b17b1fdd91c9e`

GitHub Actions run: `35046748064`

Environment:

- Linux x64
- Node `v20.20.2`
- 4 vCPU, AMD EPYC 7763 host
- ~15.6 GiB RAM available to the runner
- workload: `book-ad-v0`, 1080×1920, 360 frames / 12 s
- output profile: WebCodecs H.264, 1.2 Mbit/s
- 12 complete videos per case

RSS is an approximate Linux `/proc` process-tree sample covering the benchmark Node process and its Chromium/FFmpeg descendants.

## Matrix

| mode | concurrency | videos/hour | p50 latency | p95 latency | peak RSS |
|---|---:|---:|---:|---:|---:|
| cold process/video | 1 | 1,032 | 3.39 s | 3.89 s | 1.05 GiB |
| cold process/video | 2 | 1,386 | 5.17 s | 5.25 s | 2.00 GiB |
| cold process/video | 4 | 1,391 | 10.25 s | 10.62 s | 3.90 GiB |
| warm browser/pages | 1 | 1,420 | 2.53 s | 2.56 s | 1.05 GiB |
| warm browser/pages | 2 | **1,904** | **3.74 s** | **3.93 s** | **1.35 GiB** |
| warm browser/pages | 4 | 1,938 | 7.25 s | 7.73 s | 1.88 GiB |

Warm setup cost:

- 1 page: ~358 ms total setup
- 2 pages: ~400 ms total setup
- 4 pages: ~486 ms total setup

At concurrency 2, amortizing setup over only 12 videos changes throughput from 1,904 steady-state videos/hour to 1,871 videos/hour. On a real long-lived worker, startup is therefore a small cost.

## Main result: 2 warm pages is the current sweet spot

Moving from cold concurrency 2 to warm concurrency 2:

- throughput: `1,386 → 1,904 videos/hour` (**+37.4%**)
- p50 latency: `5.17 s → 3.74 s` (**-27.7%**)
- peak RSS: `2.00 GiB → 1.35 GiB` (**~34% less**)

Moving from warm concurrency 2 to warm concurrency 4:

- throughput: `1,904 → 1,938 videos/hour` (**only +1.8%**)
- p95 latency: `3.93 s → 7.73 s` (**~2× worse**)
- peak RSS: `1.35 GiB → 1.88 GiB` (**~42% more**)

Four concurrent encoders have already saturated the useful CPU/encoder capacity of this 4-vCPU worker. More parallelism mostly increases contention and latency.

The same pattern is even stronger for cold processes: concurrency 4 gives essentially no throughput gain over concurrency 2 while doubling latency and almost doubling memory.

**Production candidate:** one long-lived Chromium process, two warm renderer pages / encoder jobs per 4-vCPU worker.

A concurrency-3 point may be worth checking on the actual production VM, but it is no longer architecturally important; the plateau is already clear.

## What one benchmark-equivalent worker means

At the measured warm-concurrency-2 steady throughput (`1,904 videos/hour`):

- 1,000 videos: ~0.525 worker-hours (~31.5 min)
- 10,000 videos: ~5.25 worker-hours
- 100,000 videos: ~52.5 worker-hours

With 10 equivalent workers, 100k videos would take roughly ~5.25 wall-clock hours if scaling is close to linear and the queue/storage side keeps up.

## Current cloud-price sensitivity — 2026-09-16

These are **not provider benchmarks**. They answer a narrower question: what would compute cost be if a concrete 4-vCPU cloud VM sustained the same 1,904 videos/hour measured on the GitHub runner? The renderer must still be benchmarked on the chosen provider before treating these as budget numbers.

### Google Cloud C3D highcpu-4

Google's current C3D pricing table lists `c3d-highcpu-4` as 4 vCPU / 8 GiB. Current Linux compute price components sum to approximately:

- on-demand: `$0.134984/hour`
- Spot: `$0.029872/hour`

At benchmark-equivalent throughput:

| scale | on-demand compute | Spot compute |
|---:|---:|---:|
| 1,000 videos | ~$0.071 | ~$0.016 |
| 10,000 videos | ~$0.709 | ~$0.157 |
| 100,000 videos | **~$7.09** | **~$1.57** |

Source: Google Cloud Compute VM pricing, C3D section, checked 2026-09-16: https://cloud.google.com/compute/vm-instance-pricing#c3d_instance_types

Spot is interruptible and should only be used with idempotent jobs / queue retry.

### Hetzner sensitivity cases

Hetzner's 15 June 2026 price adjustment lists, for Germany/Finland:

- CPX32 shared-resource tier: `$0.0673/hour`
- CCX23 dedicated-resource tier: `$0.1626/hour`

Using the same benchmark-equivalent throughput purely as a sensitivity calculation gives roughly:

- CPX32 price level: ~$0.035 / 1k, ~$3.53 / 100k
- CCX23 price level: ~$0.085 / 1k, ~$8.54 / 100k

Source: https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/

Hetzner explicitly describes CPX as shared CPU suitable for variable/low-to-medium CPU use, while CCX provides dedicated CPU resources for sustained CPU-intensive workloads. For a renderer farm, the dedicated class is the more honest production comparison until CPX is actually benchmarked under continuous load.

## What these numbers do and do not mean

The compute result is already small enough that **renderer CPU is unlikely to be the dominant business cost for flat/editorial book ads**.

Not included yet:

- object storage retention;
- egress/upload to advertising/video platforms;
- queue/orchestration services;
- failed/retried jobs;
- heavier visual styles;
- audio generation/mux if used;
- real provider performance differences;
- idle capacity if workers are kept permanently warm.

The output size of the current 1.2 Mbit/s profile is ~1.03 MB/video, so 100k outputs are only ~103 GB before replication. Storage economics should be measured, but they are unlikely to overturn the compute conclusion.

## E05 decision

1. Use long-lived Chromium workers rather than process-per-video.
2. Start with **2 warm pages per 4-vCPU worker**.
3. Treat concurrency 4 as over-subscribed for this worker class.
4. Keep jobs idempotent so Spot/preemptible workers are an option.
5. Compute at 100k scale is plausibly single-digit dollars on suitable 4-vCPU infrastructure if provider performance is in the same region as the benchmark runner.
6. Before production budgeting, run the exact E05 harness on the selected real VM class.
7. The next product risk is no longer renderer cost; it is whether multiple visual systems keep this throughput/quality profile and whether automated QA can replace manual review at scale.

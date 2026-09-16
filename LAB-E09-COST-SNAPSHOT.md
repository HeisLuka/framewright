# E09 — cost snapshot before provider benchmarks

Pricing snapshot date: **2026-09-16**.

This file is deliberately a **normalized cost envelope**, not a provider benchmark. It applies the pinned E09 100-video soak throughput (`651.74 videos/hour`) to current published hourly VM prices. A VM with the same vCPU count may be materially faster or slower than the GitHub-hosted runner, so these numbers must be replaced by measured provider throughput before making a production purchasing decision.

Canonical E09 workload: 1080x1920, 30 fps, 12 s / 360 frames, pinned fonts + raster cover, `@napi-rs/canvas 1.0.9 -> raw RGBA -> libx264 veryfast/CRF22`, sequential videos. Canonical soak: 100 videos / 552.369 s, p50 5.320 s, p95 7.004 s, peak Node+FFmpeg RSS 726.3 MiB, no practical memory-drift signal.

## Current published price points

| Provider / plan | CPU class | Published USD/hour | Cost / 1k if 651.74 videos/h | Cost / 100k if 651.74 videos/h |
|---|---|---:|---:|---:|
| Hetzner CPX32 EU | shared, 4 vCPU / 8 GB | $0.0673 | $0.103 | $10.33 |
| DigitalOcean Basic | shared, 4 vCPU / 8 GB | $0.07143 | $0.110 | $10.96 |
| Google Cloud C4D standard-4 Spot | spot, 4 vCPU / 15 GB | $0.079774236 | $0.122 | $12.24 |
| DigitalOcean CPU-Optimized | dedicated, 4 vCPU / 8 GB | $0.125 | $0.192 | $19.18 |
| Hetzner CCX23 EU | dedicated CPU plan | $0.1626 | $0.249 | $24.95 |
| Google Cloud C4D standard-4 on-demand | 4 vCPU / 15 GB | $0.187114224 | $0.287 | $28.71 |

At the pinned E09 soak throughput, 100,000 videos require about `153.44 VM-hours` on one sequential 4-vCPU worker.

Formula:

```text
$/video = hourly_price / measured_videos_per_hour
$/1000  = 1000 * $/video
$/100k  = 100000 * $/video
```

## Sources

- Hetzner June 15 2026 price adjustment (current EU hourly USD rates, excl. VAT/IPv4): https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/
- Hetzner CPX32 current server page: https://www.hetzner.com/cloud-made-in-germany/
- Hetzner shared vs dedicated resource semantics: https://docs.hetzner.com/cloud/servers/faq/
- DigitalOcean Droplet pricing: https://www.digitalocean.com/pricing/droplets
- Google Cloud general-purpose VM pricing (C4D): https://cloud.google.com/products/compute/pricing/general-purpose
- Google Cloud Spot VM pricing: https://cloud.google.com/spot-vms/pricing

## Storage scale

The E08 outputs were about 556–654 KiB each. Using ~605 KiB as a midpoint, 100,000 outputs are only about **57.7 GiB** of MP4 data. Storage and upload/egress should still be priced separately, but compute is already cheap enough that these non-render costs and orchestration can become material.

## What makes this estimate real

Run the exact pinned E09 worker image on at least:

1. one cheap shared-CPU VM (price floor / variability test);
2. one dedicated 4-vCPU VM (predictable production reference);
3. optionally one preemptible/Spot VM (batch-cost floor with retry semantics).

For each provider record: exact CPU model, vCPU/RAM, image digest, `@napi-rs/canvas` version, FFmpeg version, sequential throughput, concurrency 1/2/4, peak RSS, p50/p95, and current hourly price. Only then promote the normalized table above into a production cost table.

## Dependency pin

E09 pins `@napi-rs/canvas` to **1.0.9**. Source: https://www.npmjs.com/package/@napi-rs/canvas

# E09 provider benchmark targets

This is a target list, not a benchmark result.

## Tier A — production reference

### Dedicated x86, 4 vCPU

Purpose: stable CPU allocation and a clean baseline for $/video without noisy-neighbor ambiguity.

Candidates:
- DigitalOcean CPU-Optimized 4 vCPU / 8 GB (`$0.125/hour` at 2026-09-16 snapshot).
- Hetzner CCX23 EU (`$0.1626/hour` at 2026-09-16 snapshot).

Run the exact `Dockerfile.node-canvas-worker` image and `e09-provider-bench.sh`, then test concurrency 1/2/4.

## Tier B — cheap shared x86

Purpose: price floor and variance test.

Candidates:
- Hetzner CPX32 EU, 4 vCPU / 8 GB (`$0.0673/hour`).
- DigitalOcean Basic, 4 vCPU / 8 GB (`$0.07143/hour`).

Shared CPU may show larger run-to-run variance, so run at least three batches and record p50/p95 across batches before comparing $/video.

## Tier C — ARM price/performance probe

### Hetzner CAX21

Published post-2026-06-15 EU price: `$0.0200/hour`, 4 vCPU / 8 GB. Hetzner documents CAX as Ampere Altra. The current product page observed during this snapshot marks CAX21 unavailable, so this is a high-upside future target rather than a deploy-now recommendation.

`@napi-rs/canvas 1.0.9` publishes Linux arm64 binaries and documents arm64 support for Cortex-A57 or newer, so there is no obvious renderer-package architecture blocker. Actual Ampere throughput is unknown and must be measured.

If an available CAX21 sustains even half the canonical E08 x86 throughput, its compute cost could still be extremely low. Do not use this hypothetical in production cost totals until measured.

## Tier D — Spot/preemptible

Google C4D standard-4 Spot was `$0.079774236/hour` at the snapshot date. Useful for retryable batch jobs once idempotency and queue semantics are implemented. Spot price and availability vary; record the actual price at benchmark/run time.

## Benchmark contract

Every provider result must record:
- provider, region, instance SKU and hourly price at test time;
- CPU model, vCPU, RAM;
- worker image ID/digest;
- Node, `@napi-rs/canvas`, FFmpeg and font manifest;
- workload profile/version;
- sequential throughput;
- concurrency 1/2/4 throughput;
- p50/p95/max per-video time;
- peak RSS and memory drift;
- layout/QA failures;
- $/video, $/1k and $/100k from measured throughput only.

Current price/reference sources are listed in `LAB-E09-COST-SNAPSHOT.md`.

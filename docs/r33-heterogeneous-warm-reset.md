# R33 — heterogeneous warm-page reset deep pass

## Question

R30 found a large warm-page/concurrency win, but reused pages kept one immutable payload and cover. R33 asks whether the useful part of that win survives real catalog churn without stale creative state.

## Controlled workload

Three existing C18 fixtures, all `hook-first / vertical`, intentionally changing book, routed visual system, text, colors and cover:

- `river-station` / paper
- `city-seven` / swiss
- `long-title` / newspaper

The benchmark does not change creative routing or layout semantics.

## Compared runtime contracts

1. **persistent Chromium + fresh page per job** — safe warm-process baseline.
2. **persistent Chromium + reused page objects + full document navigation per job** — JS globals, Canvas and image state are rebuilt by navigation while the browser/page process stays warm.

A true in-document mutable `loadJob/resetJob` contract is deliberately not implemented first. It earns a later pass only if full-navigation reuse leaves a material (>10%) residual opportunity.

## Correctness gate

For each book, sampled pre-encode Canvas frames are PNG-hashed and compared against fresh-page references. Any stale title, cover, palette or visual-system state fails the run before throughput is considered.

## Canonical result

GitHub Actions run `35140992776`, artifact `10465685752`, Ubuntu 24.04 / Node 20.20.2, 18 heterogeneous jobs per scenario, concurrency 2, 1080x1920, WebCodecs H.264 at 2 Mbps, cached AAC stream-copy mux.

| scenario | videos/hour | p50 job | p95 job | p50 navigation | CPU/video | failures | sampled Canvas parity |
|---|---:|---:|---:|---:|---:|---:|---|
| persistent browser + fresh page/job | 1444.46 | 4.840 s | 5.725 s | 94.28 ms | 9.277 s | 0 | PASS |
| persistent browser + reused page object + full navigation/job | 1557.56 | 4.617 s | 4.816 s | 64.51 ms | 8.415 s | 0 | PASS |

Reusable page objects with full document navigation improved scenario throughput by **7.8%** while preserving sampled pre-encode Canvas parity across three different books, covers, routed styles, text and colors.

The remaining document navigation itself is only **64.5 ms p50 / 4617 ms p50 job = ~1.4%** of job wall. That is the optimistic ceiling for eliminating navigation entirely, before accounting for any work a mutable reset still has to perform.

The RSS field in this R33 harness is only a lightweight direct-child proxy and should not be used as the canonical process-tree memory measurement; R30 remains the stronger pool-memory evidence.

## Decision

**KEEP:** persistent Chromium + concurrency 2 + reusable page objects + full document navigation for each heterogeneous job.

**KILL:** mutable in-document payload/asset swapping as the next optimization. It does not clear the 10% deep-pass gate; its optimistic residual ceiling is only ~1.4%, while full navigation gives explicit state reconstruction and avoids stale creative state.

This is a useful negative result: most of the safe warm-worker benefit is available without introducing a complicated `loadJob/resetJob` lifecycle contract.

## Next evidence required

- mixed-catalog long soak (eventually 1k+ jobs) on the chosen page-pool contract;
- adaptive recycle based on RSS/latency/error drift rather than fixed `N` jobs;
- fault injection for browser/page/asset/encode/mux failures;
- codec/ROI quality work after I02 quality matrix is available.

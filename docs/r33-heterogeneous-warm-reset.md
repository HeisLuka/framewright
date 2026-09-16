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

A true in-document mutable `loadJob/resetJob` contract is deliberately not implemented first. It earns a later pass only if full-navigation reuse leaves a material (>10%) opportunity.

## Correctness gate

For each book, sampled pre-encode Canvas frames are PNG-hashed and compared against fresh-page references. Any stale title, cover, palette or visual-system state fails the run before throughput is considered.

## Metrics

- scenario videos/hour
- p50/p95 job wall
- cgroup CPU/video
- peak process RSS proxy
- failures
- exact sampled pre-encode frame parity

## Decision rule

If reused page objects + full document navigation are within the same economic band as a more mutable in-document design, prefer full navigation because its state-reset semantics are much simpler. Only build a mutable scene reset API if the measured upper bound is >=10% and correctness can remain explicit and testable.

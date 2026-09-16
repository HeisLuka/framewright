# R42 — Delivery-profile concurrency matrix

R30 established `concurrency=2` as the useful warm Chromium/WebCodecs point on the vertical 1080×1920 workload. The production factory, however, emits vertical, square and landscape responsive layouts. R42 checks whether one global c2 policy leaves material throughput on the table or creates unnecessary memory/tail pressure for other profiles.

## Controlled workload

- existing responsive C18 fixtures only; no creative changes;
- three heterogeneous books/styles per profile: `river-station` / paper, `city-seven` / swiss, `long-title` / newspaper;
- `hook-first` structural variant;
- vertical, square and landscape measured separately;
- persistent Chromium, reusable page objects, full document navigation between jobs (R33 safe reset contract);
- WebCodecs H.264 Baseline, 3 Mbps target, 30 fps;
- canonical pre-encoded AAC, stream-copy mux;
- 12 jobs per profile/concurrency scenario after page-object warmup;
- concurrency matrix c1/c2/c3/c4 on one GitHub runner.

Sampled pre-encode Canvas frames must exactly match fresh references for every scenario. Any state leak or failed job invalidates that point.

## Metrics

- steady-state videos/hour;
- p50/p95 job wall;
- cgroup CPU per video;
- recursively sampled process-tree RSS;
- failures;
- sampled pre-encode parity.

## Predeclared promotion rule

`c2` is the baseline for every profile. A profile-specific concurrency setting is promoted only if it beats c2 by at least 10% throughput while:

- preserving all sampled visual/state parity;
- producing zero job failures;
- increasing p95 job wall by no more than 20%;
- increasing peak process-tree RSS by no more than 30%.

If no alternative clears all gates, keep the simpler global c2 policy for that profile.

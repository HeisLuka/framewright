# R48 — 1080-job state-recycle lifecycle freeze soak

> Reproducibility note: the branch, workflow, scripts, schemas, and artifact paths retain their original `r47-*` names because this experiment was created before canonical R47 was assigned to the catalog bitrate-floor work. The canonical research number for this lifecycle experiment is R48.

## Question

R34 found process-tree RSS movement in a mixed-catalog warm soak. R37 then motivated a bounded state-triggered recycle candidate. R48 asks one final lifecycle question: does that exact policy stay correct and bounded over a 1k+ heterogeneous run rather than a short deep pass?

R48 is freeze validation, not another recycle-threshold tuning experiment and not a comparison against fixed-N restart policies.

## Exact lifecycle contract

The worker is generated at CI time from the canonical R34 harness using exact transform markers. Source drift fails generation rather than silently forking the runtime.

Workload:

- 1080 physical jobs = 30 full cycles of the 36-fixture C18 mixed catalog;
- persistent Chromium, concurrency 2;
- two reusable pages with full document navigation for each job;
- WebCodecs H.264, 3 Mbps;
- one pre-encoded canonical AAC fixture + FFmpeg stream-copy mux;
- the existing synchronous artifact validation used by the R34/R37 lineage;
- state-fingerprint parity on every job;
- temporary video outputs cleaned after validation.

Lifecycle policy frozen before evidence:

- idle barrier every 6 completed jobs;
- first 36 jobs learn-only;
- learned baseline = median recursive process-tree RSS at the six learn barriers;
- arm when idle RSS is at least `1.25x` baseline for 3 consecutive barriers;
- recycle only at the drained idle barrier;
- close both pages + browser, relaunch Chromium, recreate the c2 page pool;
- no fixed-N recycle and no threshold retuning after results are visible.

`memory.current` remains diagnostic only because it includes reclaimable file cache. Recursive process-tree RSS is the lifecycle signal.

## Predeclared freeze gates

The candidate lifecycle freezes only when every gate passes:

1. **accounting** — exactly 1080 jobs accounted for and 180 idle-barrier samples;
2. **correctness** — zero job failures, zero corrupt artifacts, state fingerprint parity on every successful job;
3. **bounded idle RSS** — post-learn idle RSS p95 <= `1.35x` learned baseline, max <= `1.50x`, and the median of the final 12 barriers <= `1.30x`;
4. **trigger consistency** — every recorded recycle corresponds to the predeclared 3-barrier high-RSS streak; if no recycle fires, no unresolved qualifying streak may exist;
5. **latency drift** — p95 production wall for the last 180 successful jobs is no more than 10% worse than the first 180 post-learn jobs;
6. **throughput drift** — completion throughput for the last 180 successful jobs loses no more than 10% versus the first 180 post-learn jobs;
7. **recycle overhead** — summed browser-recycle pause is no more than 2% of total scenario wall;
8. **recovery tail** — p95 of the first job after each recycle is no more than `1.25x` the overall post-learn p95.

A negative gate is valid evidence. CI success means the experiment completed and produced a complete report; it does not mean the freeze decision passed.

## Canonical evidence

Actions run: `35160295836`  
Artifact: `10473447451`  
Artifact digest: `sha256:9416480818c4bc0c87f60a41c8c2be7c3abb01953290c6d968c1fd493ab668db`

The corrected run physically executed all **1080 jobs / 30 catalog cycles** and produced **1080/1080 successful jobs**, with zero state/artifact/runtime failures.

Observed whole-scenario behavior:

- throughput: **2235.55 videos/h**;
- production-equivalent p50/p95: **3374.21 / 3754.59 ms**;
- first stable p50/p95: **3377.76 / 3699.82 ms**;
- last stable p50/p95: **3352.41 / 3710.34 ms**;
- latency growth: **-0.8% p50 / +0.3% p95**;
- process-tree RSS post-warmup slope: **-0.180 MiB/job**;
- first-to-last process-tree RSS median: **+6.4%**;
- navigation p50 share: **1.5%**.

The frozen state-recycle policy fired **9 recycles**. Recycle behavior itself was cheap and safe:

- recycle pause share: **0.21%** of scenario wall;
- recycle pause p50/p95: **337.2 / 661.2 ms**;
- p95 first post-recycle job: **2706.4 ms** versus overall **3751.4 ms**;
- early -> late p95: **3758.6 -> 3750.6 ms (-0.2%)**;
- early -> late throughput: **2229.2 -> 2258.1 videos/h** (no degradation).

But the predeclared bounded-idle-RSS gate failed:

- learned baseline: **1761.9 MiB**;
- idle RSS p95: **139.6%** of baseline, above the **135%** limit;
- idle RSS max: **150.8%**, above the **150%** limit;
- late idle median: **106.6%**, comfortably below the **130%** limit.

All other freeze gates passed: accounting, correctness, barrier completeness, trigger consistency, latency drift, throughput drift, recycle overhead, and recovery tail.

## Decision

**DO NOT FREEZE the state-based recycle lifecycle candidate.** The failure is specifically the predeclared `idleRssGate`; thresholds are not changed after seeing the result.

This does **not** mean the warm Chromium pool is unstable. The full 1080-job run is actually strong evidence for the simpler production policy: correctness stayed perfect, latency and throughput stayed flat, late memory was bounded, and the post-warmup RSS slope was slightly negative. The recycle policy reacted to transient high-RSS barriers but did not establish that recycling is necessary for the current software runtime.

Production/research conclusion:

- keep the simpler persistent Chromium **c2 + full navigation** lifecycle;
- do **not** add adaptive or fixed-N recycle to the current software STANDARD;
- stop spending software-runtime research cycles on lifecycle/recycle unless a future real-host/provider soak reproduces sustained memory growth or correctness drift;
- R41 real Intel hardware/provider economics remains the external runtime direction that can legitimately reopen lifecycle assumptions.

R48 does not change codec quality policy, Intel hardware economics, provider pricing, creative quality, or cross-machine byte reproducibility.

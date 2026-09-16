# R34 — mixed-catalog warm soak and adaptive recycle scout

## Question

R30/R33 established the useful warm runtime contract: one persistent Chromium process, c2 page workers, and full document navigation for each new immutable creative. R34 asks whether that simple contract stays healthy under sustained catalog churn, or whether runtime state must be recycled based on measured health.

This is a bounded soak scout, not the final 1k+ STANDARD freeze soak.

## Workload

Cycle all existing C18 fixtures rather than one repeated creative:

- 3 books / routed visual systems;
- 4 structural variants;
- 3 delivery profiles;
- 36 distinct semantic render fixtures total;
- 180 full jobs = five catalog cycles;
- persistent Chromium, two page workers;
- full document navigation per job;
- WebCodecs H.264 with a 3 Mbps target for this stability pass;
- one canonical pre-encoded 12s AAC artifact, stream-copy mux per job.

The fixed **target** of 3 Mbps is intentionally held constant across profiles so this pass measures lifecycle stability rather than introducing a second adaptive bitrate variable. `bitrateMode` is not overridden, so WebCodecs uses its standard variable-mode default; this is not a CBR claim. R31 only proves the 3 Mbps semantic-ROI quality gate for one canonical 1080x1920 fixture, so this soak must not be cited as universal bitrate validation.

For the canonical R34 run, the first **36 jobs** are warmup and every stable measurement window is **36 jobs**. One window therefore corresponds to one complete catalog cycle. This avoids comparing windows with materially different vertical/square/landscape or structural-variant mixes and mistaking workload composition for latency or memory drift.

## Correctness and observability

Every C18 fixture gets a fresh-page baseline state fingerprint before the timed soak. Each warm-navigation job recomputes the same multi-frame downsampled Canvas fingerprint before encoding; mismatch is treated as a state-corruption failure.

Every encoded artifact is muxed with cached AAC and then ffprobed for video frame count, audio presence and duration before temporary files are deleted. The benchmark therefore does not hide disk growth behind accumulating artifacts.

Measure:

- observed successful videos/hour;
- p50/p95 production-equivalent job wall by catalog-balanced sequential windows;
- navigation/reset wall;
- cgroup CPU per successful video;
- cgroup `memory.current` as an advisory whole-cgroup signal;
- recursive process-tree RSS level/slope as the canonical bounded memory-drift gate;
- sampled peak memory;
- state/artifact failures and runtime/browser/encoder failures;
- QA fingerprint overhead separately from production-equivalent job wall.

`memory.current` is deliberately **not** allowed to trigger recycle by itself: cgroup v2 includes reclaimable file/page cache, and this workload continuously creates and deletes temporary H.264/MP4 files. Treating that signal as anonymous process memory would create a false leak detector. A future freeze soak may split `memory.stat` anon/file or use PSS for a stronger memory model.

## Predeclared observe-only recycle gates

R34 does **not** recycle during the run. A state-based recycle implementation only earns a deep pass if the unrecycled process crosses a predeclared gate:

1. **failure:** >1% job failures, any browser/page/encoder-class failure, or any state/artifact corruption;
2. **latency drift:** last stable window p95 >=25% above first stable window and p50 >=10% above;
3. **memory drift:** first-to-last stable recursive process-tree RSS median grows >=25% with a positive slope >=0.5 MiB/job.

Separately, full-navigation reset is only reopened if navigation reaches >=10% of p50 production-equivalent wall. R33 measured about a 1.4% residual ceiling, so this should remain closed unless heterogeneous profile churn changes the result.

## Decision rule

- If no recycle gate fires, do not add fixed-N or state-based restarts yet. Keep the simpler warm c2/full-navigation pool and reserve the 1k+ soak for final STANDARD freeze.
- If a recycle gate fires, the next bounded runtime pass implements the smallest state-based trigger and measures recovery cost, throughput loss and whether it actually arrests drift.
- Fixed-N restart policy is not considered evidence-based unless a later failure mode requires it.

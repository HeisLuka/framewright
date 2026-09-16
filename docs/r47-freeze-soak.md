# R47 — 1k+ state-recycle freeze soak

## Question

R34 found material process-tree RSS drift in a 180-job mixed-catalog warm soak. R37 then showed that a state-triggered recycle policy could recover memory headroom without material throughput or tail-latency damage. R37 explicitly left one final lifecycle question open: does the same policy stay correct and bounded over a 1k+ heterogeneous run rather than one short deep pass?

R47 is that freeze validation. It is not another recycle-threshold tuning experiment and it does not compare fixed-N restart policies.

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

Lifecycle policy is frozen from R37:

- idle barrier every 6 completed jobs;
- first 36 jobs are learn-only;
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

## Interpretation

If all gates pass, stop spending software-runtime research cycles on warm-pool lifecycle and treat this policy as the frozen candidate until real-host hardware/provider evidence forces a change.

If correctness, memory boundedness, drift, or recovery fails, do not patch thresholds after the fact. Inspect the failing dimension and open a new bounded hypothesis only if the failure exposes a concrete mechanism.

R47 does not answer Intel hardware economics, provider pricing, creative quality, or cross-machine byte reproducibility.

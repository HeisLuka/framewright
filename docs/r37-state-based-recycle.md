# R37 — state-based warm-pool recycle deep pass

## Question

R34 earned a recycle deep pass because its 180-job mixed C18 soak crossed the predeclared process-tree RSS drift gate while correctness and latency stayed healthy. R37 asks the narrower production question: does an RSS/state-triggered browser recycle buy meaningful memory headroom at acceptable throughput and tail-latency cost?

This is not a fixed-N restart experiment. If the state trigger does not fire, or if the no-recycle control does not reproduce meaningful drift, the correct result is to keep the simpler no-recycle warm pool.

## Workload held fixed

Both scenarios use the same R34 production-shaped contract:

- all 36 C18 mixed book/style/variant/profile fixtures;
- 180 jobs / five catalog cycles;
- persistent Chromium;
- concurrency 2;
- full document navigation per job;
- WebCodecs H.264 at 3 Mbps;
- one canonical pre-encoded AAC fixture + FFmpeg stream-copy mux;
- current accepted synchronous artifact gate;
- state fingerprint parity on every job.

R37 derives its scenario worker from the canonical R34 script at CI time. The transform asserts exact source markers so the experiment fails instead of silently drifting when R34 changes.

## Idle-barrier contract

Each scenario is divided into identical 6-job batches. With c2, all six jobs finish before the barrier is sampled. Recycle is permitted only at this barrier, never while a job is in flight.

The first 36 jobs are learn-only. Their six barrier RSS samples define the process-tree RSS baseline (median). No recycle is allowed during this period.

After the learn window, the recycle scenario arms only when recursive process-tree RSS is at least `baseline * 1.25` for three consecutive idle barriers. Then both pages are already drained, the browser/page pool is recycled, and the experiment records pause cost, RSS before/after, and the first post-recycle job. The streak resets after recycle.

The control uses the same batching and barriers but never recycles.

`memory.current` is not used for the decision because R34 established that it includes reclaimable file cache from temporary media IO. The canonical memory signal is recursive process-tree RSS.

## Predeclared promotion gates

R37 promotes state-based recycle only if all of the following hold:

1. the no-recycle control reproduces material RSS drift: late idle-barrier RSS is at least 25% above its learned baseline;
2. the predeclared recycle trigger actually fires;
3. recycle buys material memory headroom: at least 15% lower late or post-learn peak RSS, or at least 384 MiB lower peak RSS;
4. zero state/artifact correctness regressions;
5. observed throughput loss is no more than 5%;
6. p95 production-equivalent job wall regression is no more than 10%.

Do not lower these gates after seeing the result.

## Interpretation rules

- Trigger never fires: do not add recycle.
- Control does not reproduce drift: do not add recycle from this run; treat R34 drift as not yet robust enough for policy.
- Memory improves but throughput/tail gates fail: do not promote; provider memory economics may justify a different future threshold, but that is a new hypothesis.
- All gates pass: state-based recycle becomes the candidate warm-pool lifecycle policy for the later 1k+ freeze soak.

R37 does not answer hardware-encoder economics, codec policy, scene compilation, or creative quality.
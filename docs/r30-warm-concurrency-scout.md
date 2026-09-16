# R30 — Warm pool & concurrency economics scout

R30 asks whether Chromium/WebCodecs keeps its I02 compute advantage once memory and worker lifecycle are treated as economic constraints rather than ignored benchmark details.

The experiment runs the unchanged C18 production-shaped scene used by I02/R32:

- `river-station`
- visual system `paper`
- structural variant `hook-first`
- vertical 1080x1920
- 12 seconds / 360 frames / 30 fps
- WebCodecs H.264 at 2 Mbps
- canonical AAC stream-copy mux from the R29/R32 direction

## Scenarios

```text
cold-browser-per-job
  launch Chromium
  load page
  encode one job
  cached-AAC stream-copy mux + validation
  close Chromium

persistent-browser-fresh-page
  launch Chromium once
  for each job:
    create/load page
    encode
    cached-AAC mux + validation
    close page

reuse-c1 / c2 / c3 / c4
  launch Chromium once
  preload N pages once
  each page acts as a sequential worker
  jobs vary deterministic seed
  encoder is recreated per job
  cached-AAC mux + validation per job

short soak
  rerun the best raw-throughput concurrency for a larger batch
```

## Why both throughput and memory matter

I02 measured Chromium/WebCodecs at roughly 1.7x the peak RSS of the browserless Node path on the same scene. Therefore raw `videos/hour` is not sufficient.

R30 records:

- scenario wall and derived videos/hour;
- per-job p50/p95 wall;
- cgroup CPU and CPU/video;
- peak process-tree RSS;
- videos/hour/GiB;
- browser/page setup cost;
- per-job Canvas reset cost;
- failures;
- a short warm-worker soak.

The production question is whether concurrency increases usable capacity **per machine dollar**, not whether four tabs look fast in isolation.

## Warm-page caveat

The current C18 template freezes normalized payload/cover data at page boot. Reused-page jobs therefore keep the same immutable payload/cover and vary the deterministic seed. This is intentional for the scout: it measures the upper-bound lifecycle/cache/concurrency value without inventing a second Creative interface.

If page reuse clears the economics gate, a later production pass must define and test a safe payload/asset reset contract. `clearRect` alone is not accepted as proof that arbitrary catalog jobs can reuse one page.

The `persistent-browser-fresh-page` scenario is the conservative reference for payload-changing production jobs because each job boots a fresh page while keeping Chromium warm.

## Decision gates

Promote a lifecycle/concurrency direction only when it gives a material improvement in one or more of:

- >=10–15% videos/hour at acceptable memory cost;
- >=10–15% videos/hour/GiB;
- lower CPU/video;
- lower p95/failure rate;
- operational simplification that survives the warm-worker soak.

A concurrency setting that wins raw throughput but collapses memory efficiency or shows latency/RSS drift is not the production winner.

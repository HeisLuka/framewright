# R44 — static layer/subtree cache scout

## Question

Does retaining static scene raster work inside one video materially improve the current FAST production path, or is Canvas composition already too small relative to WebCodecs encode/runtime?

This is H20 from the Runtime Gold Rush. It is intentionally different from R43 whole-frame/static-span reuse: R43 was killed because current creatives keep meaningful motion in hold windows. R44 keeps rendering every frame, but replaces repeated background construction with a retained bitmap layer.

## Candidate

The scout caches only the deterministic background function for each plate (`hook`, `book`, `cta`) inside the current document. The cache bitmap is created at the exact physical raster size implied by the current canvas transform, then copied in device pixels to avoid adding a scaling/resampling step.

The cache is per navigation/document, so it does not rely on state leaking between books. At 1080×1920 RGBA, one retained full-frame layer is about 7.9 MiB; three plates are about 23.7 MiB per warm page before browser overhead. Memory economics are therefore a first-class gate rather than a footnote.

This pass deliberately does **not** re-test deterministic typography fit caching. That optimization already has separate byte-identical evidence and a material throughput win.

## Oracle and workload

The workflow rebuilds the exact C18 responsive/variant fixture stack and uses three heterogeneous books across vertical, square, and landscape delivery profiles. Baseline and candidate both run the existing R42 production-shaped path at global `c2`: navigation → Canvas/WebCodecs 3 Mbps → H.264 upload → cached AAC stream-copy mux.

Before performance evidence counts, a separate cross-variant oracle renders 12 semantically distributed frames for each of 3 books × 3 profiles and requires baseline/candidate PNG SHA-256 equality for every sample. The R42 harness's internal warm-page parity remains enabled as an additional check.

## Metrics

For baseline and candidate record end-to-end videos/hour, p50/p95 job wall, Canvas `drawMs`, CPU/video, recursive process-tree peak RSS, H.264 bytes/video, failures, and videos/hour/GiB.

## Predeclared gate

Promote the background layer cache only if all correctness checks pass and the equal-mix aggregate clears all of:

- at least **+10%** end-to-end throughput;
- aggregate p95 no more than **+20%** worse;
- aggregate peak RSS no more than **+30%** worse;
- videos/hour/GiB neutral or better;
- no individual delivery profile loses more than **5%** throughput or violates the p95/RSS limits.

Otherwise kill/hold H20 at the background-cache level. A broader cover/text subtree cache should only be attempted if the measured `drawMs` reduction is substantial enough that the remaining static composition could plausibly bridge the gate; it must not be justified by a draw-only microbenchmark.

## Reproduction

Canonical evidence is produced by `.github/workflows/r44-static-layer-cache.yml` and uploaded as `r44-static-layer-cache` with baseline/candidate reports, cross-variant parity report, final decision report, and summary.

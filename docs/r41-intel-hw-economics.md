# R41 — Real Intel QSV/VAAPI provider economics deep pass

## Goal

Measure whether a cheap dedicated Intel iGPU host creates a production-level cost frontier for the current deterministic video factory. The first target class is Hetzner EX44 / Core i5-13500 / UHD 770.

R41 is not a synthetic encoder benchmark. It keeps the current production-shaped path around the encoder so any claimed gain survives navigation, Canvas rendering, H.264 upload, cached AAC mux, synchronous `ffprobe -count_frames` validation and artifact hashing.

## External requirement

Canonical evidence must run on a real Intel media device. GitHub-hosted Actions is only used to lint the harness because earlier R35 tracing proved that runner is software OpenH264/SwiftShader.

The host must expose `/dev/dri/renderD128`. The R41 preflight also requires:

- Intel CPU and display controller;
- a working `vainfo --display drm --device /dev/dri/renderD128` with H.264 encode entrypoints;
- FFmpeg `h264_vaapi` or `h264_qsv`;
- `intel_gpu_top` access;
- Chromium/Chrome.

API support is not hardware proof. A hardware scenario is considered real only when the `intel_gpu_top` Video/VideoEnhance engine reaches the predeclared busy threshold during the measured window.

## Fixed workload

- exact 36-fixture C18 catalog;
- 1080x1920 production renderer and current deterministic scene semantics;
- H.264 `avc1.420028`, 3 Mbps, realtime, queue limit 8;
- current full-document navigation between jobs;
- cached AAC input;
- FFmpeg stream-copy mux;
- current synchronous `ffprobe -count_frames` artifact validation;
- SHA-256 artifact identity;
- serialized per-page final tail, matching the negative R38 overlap decision.

The only intended changed axis is software-vs-hardware video encode and the concurrency level needed to reach the best host frontier.

## Backends

### Software reference

Browser WebCodecs with `hardwareAcceleration=prefer-software` on the exact same host.

### Hardware candidate

Browser WebCodecs with `hardwareAcceleration=prefer-hardware` and Chromium `VaapiVideoEncoder` enabled. `--ignore-gpu-blocklist` is included because Linux VA-API encode remains feature-gated/experimental. Additional host-specific Chromium flags can be supplied through `CHROME_EXTRA_ARGS` and are recorded in the report.

If Chromium accepts the configuration but Video-engine activity is absent, the run does **not** count as hardware evidence.

FFmpeg QSV/VAAPI remains a diagnostic/fallback floor if browser hardware cannot be proven. It is not silently substituted into the current production architecture.

## Matrix

Default concurrency sweep: `c1,c2,c4,c6,c8`, 36 heterogeneous jobs per scenario. Every worker/page is warmed before timing. Each measured job completes only after navigation, render/encode, upload, mux, frame-count validation and SHA-256.

For each scenario record:

- videos/hour;
- p50/p95 completion wall;
- CPU ms/video;
- peak process-tree RSS and cgroup memory;
- draw, `VideoFrame` construction, encode, upload, mux and validation wall;
- encoded bytes;
- exact artifact validity and hash;
- emitted color metadata from a saved c1 sample;
- raw `intel_gpu_top` trace and parsed Video-engine mean/max busy;
- Chromium GPU/system information.

## Economics

At run time provide the actual quoted monthly host price and currency:

```bash
PROVIDER_MONTHLY_PRICE=57.30 \
PROVIDER_PRICE_CURRENCY=EUR \
node .agents/skills/framewright/scripts/r41-intel-hw-economics.mjs
```

The report uses the supplied monthly quote and 730 hours/month by default to compute cost per 100,000 videos. The quote is an input, not hard-coded provider truth; record it again at the canonical run because limited-server availability and pricing can change.

## Performance/economics gate

A hardware point earns the quality-gated deep pass only when:

1. all jobs are valid;
2. actual Intel Video-engine activity is proven; and
3. same-host projected cost/100k is at least 20% below the best software point (`hardware/software cost ratio <= 0.80`).

Because both backends occupy the same monthly host, the cost-ratio test is equivalent to requiring at least a 25% sustained end-to-end throughput increase before quality is considered.

## Color/quality gate

Performance alone can never promote hardware. A candidate that clears the economics gate must then pass the R39 synthetic-patch + representative-book oracle against Canvas references. If the parallel explicit RGB->YUV R40 produces a valid portable mapping, that contract must also be consumed.

R39 already demonstrated why this is necessary: post-hoc metadata relabeling can leave full-frame SSIM deceptively high while creating a systematic RGB matrix shift.

Until that oracle passes, R41 reports `STANDARD eligible: false` even if the hardware economics gate succeeds.

## Expected first host

Hetzner EX44-class bare metal is the current first target because Core i5-13500 includes UHD 770 / Quick Sync media engines and Hetzner documents enabling i915 and `/dev/dri/renderD128`. This is a target for measurement, not a permanent provider commitment.

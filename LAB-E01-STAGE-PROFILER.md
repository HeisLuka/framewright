# E01 — Stage profiler

Purpose: measure where Framewright render time actually goes before changing the renderer architecture.

Baseline commit: `c98005d8580bae5df750de89e0643a3cec34db4f`.

This experiment does **not** modify `examples/ris-tv/index.html` or the normal `render.mjs`. The profiler wraps runtime functions from Puppeteer after the page has loaded, so the visual workload remains the baseline implementation.

## What is measured

Per frame:

- `frameWallMs` — Node wall time for the full frame operation through disk write;
- `browserTotalMs` — time inside `window.RISO.frame()`;
- `sceneEngineMs` — `RISO.frame` time excluding measured post-processing and PNG encode;
- `postMs` — time spent in `post()` and/or `crt()` when present;
- `pngEncodeMs` — `HTMLCanvasElement.toDataURL()` time;
- `cdpTransferMs` — approximation of Puppeteer/CDP return/serialization overhead (`page.evaluate` wall time minus browser-side `RISO.frame` time);
- `base64DecodeMs` — Node data URL/base64 decode;
- `diskWriteMs` — synchronous PNG write;
- PNG bytes and data URL character count.

Run-level fields include Chrome launch time, metadata page startup, worker-page startup, Node resource usage, final Node memory, throughput and p50/p95 stage summaries.

`cdpTransferMs` is intentionally labelled an approximation: it includes protocol/serialization/scheduling overhead around `page.evaluate`, not only raw transport time.

## Quick sanity run

From repository root after `npm install`:

```bash
START=0 END=60 \
HTML=examples/ris-tv/index.html \
PROFILE_OUT=e01-60f-720.json \
node .agents/skills/framewright/scripts/profile-render.mjs frames-e01 7 720 1
```

This renders two seconds / 60 frames with one tab and writes the stage profile to JSON.

## Canonical E01 matrix

Run the same RIS TV workload with the following cells:

```text
width  tabs  frames
720    1     300
720    5     300
1080   1     300
1080   5     300
1920   1     300
1920   5     300
```

For vertical book-ad work use `AR=9:16` separately; do not mix those numbers with the 16:9 RIS TV baseline.

Example:

```bash
START=0 END=300 \
HTML=examples/ris-tv/index.html \
PROFILE_OUT=e01-ris-1080-t5.json \
node .agents/skills/framewright/scripts/profile-render.mjs frames-e01 7 1080 5
```

## End-to-end benchmark

`benchmark.mjs` runs the instrumented render, then the existing `build.sh`, probes the MP4, and creates one JSON report with render time, encode time, intermediate PNG size and output metadata.

```bash
START=0 END=300 \
HTML=examples/ris-tv/index.html \
KEEP_FRAMES=1 \
node .agents/skills/framewright/scripts/benchmark.mjs e01-ris-1080-t5.json 7 1080 5
```

By default benchmark frames are removed after the report is written. Set `KEEP_FRAMES=1` while validating the experiment.

## Interpretation

Do not add the per-frame stage sums and compare them directly to multi-tab wall time: several browser tabs execute concurrently. Use stage distributions to identify hot paths, and use `summary.fps` / end-to-end wall time for throughput.

The key decision questions are:

1. How much of browser time is `crt/post` versus scene composition?
2. How much wall time remains in PNG encoding + CDP + decode + disk after post-processing is excluded?
3. Does increasing tabs reduce wall time, or only multiply memory/CPU contention?
4. At what resolution does the bottleneck shift from post-processing to transport/encoding?
5. After replacing CRT with a shader/native implementation, which stage becomes dominant next?

## Status

Instrumentation implemented. Numerical results must be produced on a machine with the project toolchain (Puppeteer Chrome + FFmpeg) and recorded together with host metadata from the generated JSON. Do not extrapolate dollar cost from unmeasured hardware.
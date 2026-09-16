# E15 — render cost gate

Renderer optimization is only valuable when it changes product economics or unlocks a visual capability that matters.

The repository now has a small cost model:

```bash
HOURLY_USD=0.07143 VIDEO_SECONDS=15 OUTPUT_FPS=30 \
node .agents/skills/framewright/scripts/cost-model.mjs \
  exact=artifacts/exact.json \
  composition=artifacts/composition.json
```

It converts measured renderer throughput into:

- wall seconds per video;
- videos per compute hour;
- dollars per video;
- dollars per 1,000 videos;
- dollars per 100,000 videos;
- incremental cost versus the cheapest measured path.

## Why the gate exists

E11 proved that the RIS TV JavaScript CRT consumes most of frame-render wall time in isolation. E13/E13c then proved a different fact: on a small multi-core production-like machine, moving the exact pixel loop to native CPU does not materially improve end-to-end throughput once Chromium composition and FFmpeg compete for the same CPU budget. E14 showed that WebGL2 on a CPU VM is SwiftShader and is slower than the legacy Canvas CRT.

Those results make FPS alone a bad optimization target.

## Current scenario calculation

The following is **not a DigitalOcean benchmark**. It combines throughput measured on a 4-logical-CPU GitHub runner with a price scenario equal to the currently visible DigitalOcean 4-vCPU / 8-GB basic Droplet price (`$0.07143/hour`). It is useful for order-of-magnitude product decisions only; a provider benchmark is still required before capacity planning.

Using the E13c 720×1280, 3-tab measurements:

- legacy full CRT: about `5.1446 fps`;
- composition-only / identity post: about `6.3508 fps`.

For a 15-second, 30-fps ad (450 frames), that implies approximately:

| Path | Render time/video | $/video | $/1,000 | $/100,000 |
| --- | ---: | ---: | ---: | ---: |
| legacy exact CRT | 87.47 s | $0.001736 | $1.74 | $173.56 |
| composition-only | 70.86 s | $0.001406 | $1.41 | $140.59 |

The modeled incremental compute cost of keeping the exact legacy CRT is therefore only about:

- `$0.000330` per 15-second video;
- `$0.33` per 1,000 videos;
- **`$32.96` per 100,000 videos**.

For a 40-second, 30-fps video (1,200 frames), the same throughput assumptions give about `$462.82 / 100k` for exact CRT versus `$374.91 / 100k` for composition-only — an incremental difference of roughly `$87.91 / 100k`.

## Decision rule

Do not spend significant engineering time replacing an existing backend solely because its FPS is lower. Continue an optimization only when at least one of these is true:

1. provider-measured cost reduction is material at expected production volume;
2. current throughput creates a real latency/capacity constraint;
3. the new backend unlocks a visual system we cannot otherwise ship;
4. it materially reduces operational complexity, failure rate, or infrastructure requirements.

For the book-ad product, this pushes the next work away from exact-CRT micro-optimization and toward the higher-value questions: template quality, creative variation, batch orchestration, and a real provider benchmark of the ordinary production workload.

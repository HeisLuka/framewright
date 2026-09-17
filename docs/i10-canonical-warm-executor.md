# I10 — Canonical warm c2 executor wiring

## Why this integration pass exists

The renderer/runtime research and the production factory had drifted into two different lifecycle contracts.

The accepted software STANDARD is already established by R33/R34/R42/R48:

- Chromium Canvas → WebCodecs H.264;
- fixed 3 Mbps software policy;
- one persistent Chromium process;
- global concurrency `c2`;
- two reusable page objects;
- full document navigation for every physical render;
- canonical cached AAC;
- FFmpeg stream-copy mux;
- no adaptive or fixed-N browser recycle.

But the canonical I03/I07 production path still called `render-webcodecs.mjs`, which launches and closes Chromium for every RenderSpec. Running I06 against that wiring would freeze a runtime that is not the declared STANDARD.

I10 is therefore wiring, not a new performance hypothesis. It does not change CreativeSpec, RenderSpec, bitrate, codec, concurrency, browser recycle policy, mux policy, or artifact identity.

## Canonical path after I10

```text
I07 local queue worker
  -> one worker-owned warm WebCodecs pool
       -> one Chromium
       -> exactly two reusable pages
  -> canonical run-video-factory
       -> canonical render-factory-fast
            -> pool physical encode when WEBCODECS_POOL_URL is present
            -> existing one-shot render-webcodecs fallback otherwise
       -> canonical AAC stream-copy mux
       -> existing QA / cache / artifact receipts
```

The queue core remains unchanged. The `local:worker` package command owns the warm pool for the worker lifetime and then starts the existing I07 queue core with `WEBCODECS_POOL_URL` in its environment.

## Pool boundary

`render-webcodecs-pool.mjs` owns exactly one Chromium process and two reusable Puppeteer pages. Every render:

1. gets a unique scene URL and payload binding;
2. performs a full `page.goto(...)` navigation;
3. waits for the normal scene readiness contract;
4. encodes the Canvas through the same WebCodecs configuration used by FAST;
5. uploads Annex-B H.264 to the local pool server;
6. stream-copies it into MP4 with the same timestamp normalization;
7. returns a report consumed by the unchanged FAST receipt/QA tail.

Scene HTML is `no-store`; static assets are content-stable/cacheable so Chromium's native cache can do the work already validated by R45.

The pool exposes only localhost with a random tokenized path. It does not change semantic job identity.

## Production concurrency

`run-video-factory.mjs` stays serial when no pool is configured. When `WEBCODECS_POOL_URL` is present it executes at most two RenderSpecs concurrently, matching the already-selected global `c2` policy. No profile-specific or adaptive concurrency is introduced.

## Canonical audio wiring

I10 also closes a production-only wiring gap: `run-video-factory` now passes `execution.audio` into FAST when a RenderSpec declares canonical audio. FAST still verifies the artifact SHA against the RenderSpec before muxing. `CANONICAL_AUDIO_PATH` remains a fallback, not the required normal path.

## Acceptance experiment — frozen before evidence

The I10 CI fixture reuses the existing I03 C27 campaign with two vertical platform RenderSpecs (YouTube Shorts and Instagram Reels) and canonical AAC.

The experiment runs:

1. the canonical factory once through the old one-shot fallback;
2. the same canonical request through one warm `c2` pool;
3. an immediate canonical cache replay using the same artifact cache;
4. a second physical canonical run using a fresh artifact cache but the **same pool process**.

Promotion gates are fixed before the result:

- same RenderSpec IDs and delivery-package identity across one-shot and warm runs;
- existing factory QA passes for every artifact, including platform binding, frame count, codec and canonical audio;
- warm runs report `render_concurrency=2` and exactly one shared pool PID;
- the first c2 run exercises both reusable page slots;
- every warm report states `fullDocumentNavigation=true`;
- cache replay hits every RenderSpec and does **not** increment the pool physical-render sequence;
- exact sampled Canvas state fingerprints match across the two physical warm runs for every RenderSpec;
- decoded one-shot vs warm video at five fixed checkpoints per RenderSpec must satisfy the already-broad wiring parity floor `SSIM >= 0.97` **and** `PSNR >= 30 dB` at every checkpoint;
- thresholds are not changed after evidence.

MP4 byte equality is deliberately not required: R50 established that nominally identical software OpenH264 encodes are not bit deterministic on the hosted runner.

## Decision boundary

I10 can only promote the lifecycle wiring if all gates pass. It does not freeze production by itself. Once merged, I06 can return to `Ready` and run the >=1000-job production STANDARD freeze soak without changing architecture during the soak.

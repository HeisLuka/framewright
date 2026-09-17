# I07 — Local resumable render worker

The local worker is a thin queue around the canonical I03 factory executor. It does not define a second render path and does not change CreativeSpec, RenderSpec, or canonical artifact identity.

I10 wires the accepted software STANDARD into the same worker lifetime: the normal package command starts one warm Chromium pool (`c2`, two reusable pages, full navigation/job) and then runs this unchanged queue core with that pool attached to the canonical factory executor.

## Queue layout

```text
.local-render-queue/
  pending/
  running/
  done/
  failed/
  results/
  canonical-artifacts/
  .worker.lock
  .webcodecs-pool.json   # runtime-only while the STANDARD worker is alive
```

A job is identified by the SHA-256 of the exact campaign request bytes:

```text
lrj_<sha256(request.json)>
```

The queue identity is local runtime metadata only. Canonical media identity remains owned by the existing factory contracts.

## Enqueue

```bash
node .agents/skills/framewright/scripts/enqueue-local-render-job.mjs \
  --request .bench/i03/input/campaign.json \
  --queue .local-render-queue \
  --workspace .
```

Enqueue copies the campaign request into the queue. A byte-identical request is deduplicated while it exists in pending, running, done, or failed state.

`--workspace` is the checkout/runtime root that contains paths referenced by the campaign execution binding. It is not included in the semantic job identity. When moving the worker to another machine later, use the corresponding checkout path there.

## Production STANDARD worker

Use the package command for normal local production:

```bash
npm run local:worker -- \
  --queue .local-render-queue \
  --workspace .
```

For one job only:

```bash
npm run local:worker -- \
  --queue .local-render-queue \
  --workspace . \
  --once
```

`local:worker` starts `local-render-worker-standard.mjs`, which owns one warm WebCodecs pool for the worker lifetime and then starts the existing queue core. The queue core still calls exactly:

```text
run-video-factory.mjs → render-factory-fast.mjs
```

When the pool is present, FAST delegates only the physical Canvas/WebCodecs encode to that pool. RenderSpec compilation, canonical AAC verification, mux, QA receipts, artifact cache, retries, queue transitions and canonical identities remain on the existing path.

The raw queue core remains available for contract tests and fallback/debugging as:

```bash
npm run local:worker:queue-core -- --queue .local-render-queue --workspace . --once
```

Without `WEBCODECS_POOL_URL`, it retains the previous one-shot Chromium behavior.

Successful canonical outputs live under:

```text
.local-render-queue/results/<job_id>/
```

The shared canonical artifact cache lives under:

```text
.local-render-queue/canonical-artifacts/
```

The queue job is moved to `done/` only after `run.json` and `canonical-artifacts.json` exist. Each execution attempt gets an immutable queue-local receipt under `attempts/`.

## Queue ownership

The v1 queue intentionally permits one active queue consumer per queue root. `.worker.lock` prevents two queue-core processes from consuming the same queue. The warm pool is owned by the STANDARD wrapper process and is terminated with the worker; its port file is runtime metadata and is removed on shutdown.

This does **not** mean only one physical RenderSpec can run at a time. Within one canonical campaign request, the attached STANDARD pool permits the already-selected global `c2` physical render concurrency.

## Crash recovery

On startup, after acquiring the queue lock, all abandoned `running/` jobs are moved back to `pending/`. The canonical RenderSpec artifact cache still prevents unnecessary duplicate physical work where a completed artifact already exists.

If both pending and running copies of the same job exist, recovery stops instead of guessing which copy is authoritative.

## Failure and retry

A failed execution is moved to `failed/` with an attempt receipt containing the error. Retry is explicit. Through the STANDARD wrapper:

```bash
npm run local:worker -- \
  --queue .local-render-queue \
  --workspace . \
  --retry lrj_<sha256> \
  --once
```

Retry preserves previous attempt receipts and does not mutate the campaign request or canonical factory identities.

## Contract check

```bash
node contracts/check-i07-local-render-worker.mjs
```

The check uses a fake executor so queue semantics can be tested without Chromium or ffmpeg. I03 remains responsible for one-shot factory/MP4 correctness, while I10 owns the warm-pool integration parity gate.

## Migration boundary

Local-first is the current deployment policy while render volume is low. Future VPS workers should consume the same campaign request and call the same canonical executor. Replacing the filesystem queue with a network queue is an infrastructure change, not a creative/render contract change. A real hardware/provider move may change the worker host, but must not silently fork the factory contract.

# I07 — Local resumable render worker

The local worker is a thin queue around the canonical I03 factory executor. It does not define a second render path and does not change CreativeSpec, RenderSpec, or canonical artifact identity.

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

## Process one job

```bash
node .agents/skills/framewright/scripts/local-render-worker.mjs \
  --queue .local-render-queue \
  --workspace . \
  --once
```

The worker atomically renames one job from `pending/` to `running/`, verifies its request hash, then calls the canonical:

```text
run-video-factory.mjs → render-factory-fast.mjs
```

Successful canonical outputs live under:

```text
.local-render-queue/results/<job_id>/
```

The shared canonical artifact cache lives under:

```text
.local-render-queue/canonical-artifacts/
```

The queue job is moved to `done/` only after `run.json` and `canonical-artifacts.json` exist. Each execution attempt gets an immutable queue-local receipt under `attempts/`.

## Continuous local worker

```bash
node .agents/skills/framewright/scripts/local-render-worker.mjs \
  --queue .local-render-queue \
  --workspace .
```

The v1 worker intentionally permits one active worker per queue root. `.worker.lock` prevents two local processes from consuming the same queue. This keeps filesystem ownership simple while there is no production-scale load.

## Crash recovery

On startup, after acquiring the queue lock, all abandoned `running/` jobs are moved back to `pending/`. The canonical RenderSpec artifact cache still prevents unnecessary duplicate physical work where a completed artifact already exists.

If both pending and running copies of the same job exist, recovery stops instead of guessing which copy is authoritative.

## Failure and retry

A failed execution is moved to `failed/` with an attempt receipt containing the error. Retry is explicit:

```bash
node .agents/skills/framewright/scripts/local-render-worker.mjs \
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

The check uses a fake executor so queue semantics can be tested without Chromium or ffmpeg. The existing I03 workflow remains responsible for physical factory/MP4 correctness.

## Migration boundary

Local-first is the current deployment policy while render volume is low. Future VPS workers should consume the same campaign request and call the same canonical executor. Replacing the filesystem queue with a network queue is an infrastructure change, not a creative/render contract change.

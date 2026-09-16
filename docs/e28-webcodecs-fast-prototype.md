# E28 — WebCodecs fast-path prototype

## Product purpose

This is the first production-shaped STANDARD path for mass book-ad rendering. It is intentionally separate from the SPECIAL external-post path used for CRT/heavy effects.

```text
Newboo book / BookResponse
  -> deterministic BookRenderPayload + BookRenderJob
  -> cover staging
  -> Chromium Canvas composition
  -> VideoFrame(canvas)
  -> WebCodecs H.264
  -> FFmpeg stream-copy video + optional AAC audio mux
  -> MP4
  -> render manifest + render_id keyed artifact cache
```

No AI is used in the render path.

## Commands

Generic renderer:

```bash
HTML=examples/book-ad-v0/index.html \
node .agents/skills/framewright/scripts/render-webcodecs.mjs out.mp4 7 1080
```

Book-ad prototype:

```bash
node .agents/skills/framewright/scripts/book-ad-fast.mjs \
  --book-json book.json \
  --cover-file cover.jpg \
  --track track.wav \
  --width 1080 \
  --seed 7 \
  --out ad.mp4 \
  --artifact-dir .artifacts/video
```

NPM aliases:

```bash
npm run render:webcodecs
npm run book-ad:fast -- --book-json book.json --cover-file cover.jpg
```

## Bitrate policy

The initial conservative policy comes from E24:

- width <= 720: 1 Mbps;
- width <= 1080: 2 Mbps;
- larger widths: scale approximately with pixel area;
- `WEBCODECS_BITRATE` / `--bitrate` overrides the policy.

The 1080 policy should be refined with the planned 1.25/1.5/1.75/2.0 Mbps visual sweep before calling it final.

## Artifact and determinism contract

E26/E27 established that Chromium WebCodecs H.264 is not byte-identical across repeated encodes of identical deterministic frames. Therefore `render_id` identifies the deterministic render semantics and encoding policy, not the final MP4 SHA.

`render_id` currently fingerprints:

- renderer and bitrate-policy versions;
- template HTML path + SHA-256;
- immutable encoded `BookRenderJob`;
- deterministic query controls;
- seed and requested width/aspect;
- bitrate;
- staged cover SHA-256;
- audio SHA-256 when present.

The completed MP4 is stored by `render_id`. A repeated request with the same identity reuses the stored MP4 and verifies its SHA-256 before materializing it at the requested output path.

Manifest contract:

```text
kind: framewright-render-artifact
renderId: fwc1_<sha256>
renderer: webcodecs-h264-v1
input: deterministic visual/asset fingerprint
output: MP4 SHA/bytes/ffprobe metadata
metrics: wall/encode/upload/mux/attempts
invocation.cacheHit: whether this request reused a stored artifact
```

## Reliability features in the prototype

- bounded WebCodecs `encodeQueueSize` backpressure;
- configurable retries around browser/WebCodecs execution;
- atomic MP4 temp -> final rename;
- `ffprobe` validation of decoded frame count;
- audio-stream validation when a track is supplied;
- output SHA verification before cache reuse;
- persistent `render_id` keyed artifact directory;
- local receipt manifest per requested output.

## Current limitation

`book-ad-fast.mjs` supports Newboo API reads, local covers, explicit cover URLs and public `cover_url`. The older `book-ad.mjs` also has direct signed S3/YC cover staging; that staging code has not yet been factored into a shared module for the fast entrypoint. For a first production worker, either share that asset resolver or stage assets before submitting the render job.

The artifact cache is filesystem-backed. Its contract is deliberately storage-agnostic so the next step can replace the directory with object storage while retaining the same `render_id -> stored MP4 + manifest` semantics.

## CI gate

`.github/workflows/e28-webcodecs-fast-prototype.yml` renders a full 15-second / 450-frame book ad with:

- deterministic fixture book;
- staged cover;
- 15-second audio track;
- H.264 + AAC MP4;
- persistent artifact cache;
- repeated identical request expected to be a cache hit;
- different seed expected to create a different `render_id`.

Canonical run and measured results are appended after the first green E28 run.

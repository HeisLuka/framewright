# Render pipeline v0: PNG reference vs raw RGBA stream

`video-engine-v0` now keeps two render paths side by side.

The old path remains the reference implementation:

```text
Canvas
  -> toDataURL(PNG)
  -> base64 over CDP
  -> Node base64 decode
  -> PNG files on disk
  -> ffmpeg
  -> MP4
```

The new experimental production path is:

```text
Canvas
  -> getImageData RGBA
  -> same-origin localhost POST
  -> ordered bounded receiver in Node
  -> ffmpeg stdin rawvideo
  -> MP4
```

Nothing about scene timing, geometry, typography, deterministic RNG, book payloads or creative recipes changes between the two paths.

## Why the localhost receiver exists

A raw ffmpeg stream has to receive frames in strict order. Framewright normally renders with several Chromium pages, and those pages do not finish frames in order.

`render-raw.mjs` therefore uses an acknowledgement/backpressure rule:

1. each Chromium worker renders one frame;
2. it POSTs the RGBA bytes to the local render server;
3. Node buffers the frame by frame number;
4. Node writes consecutive frames to ffmpeg only when the next required frame is available;
5. the HTTP request is acknowledged only after that frame has been written;
6. only then can that worker request another frame.

This keeps the reorder buffer bounded to roughly:

```text
tabs * width * height * 4 bytes
```

For 1920x1080 RGBA with five workers that is about 39.6 MiB of frame payload, rather than an unbounded queue.

## Commands

Generic raw render:

```bash
HTML=examples/ris-tv/index.html \
node .agents/skills/framewright/scripts/render-raw.mjs \
  out/ris-raw.mp4 7 1920 5
```

Book ad through the Newboo adapter:

```bash
npm run book-ad -- video-raw \
  --book-json ./book.json \
  --width 1080 \
  --tabs 5 \
  --out out/book-ad-raw.mp4
```

The existing reference command is still available:

```bash
npm run book-ad -- video \
  --book-json ./book.json \
  --width 1080 \
  --tabs 5 \
  --out out/book-ad-reference.mp4
```

## Benchmark harness

Run both paths on the same HTML, seed, range, width, worker count and x264 settings:

```bash
npm run bench:render -- \
  examples/ris-tv/index.html \
  300 \
  720 \
  5
```

Arguments are:

```text
html frames width tabs outBase
```

Every run gets a unique directory under `.bench/render/` and writes:

```text
png-frames/
reference.mp4
raw.mp4
reference-render.json
raw-render.json
benchmark.json
```

`benchmark.json` contains wall-clock timing for reference frame rendering, reference ffmpeg build, direct raw render+encode, effective FPS, intermediate PNG bytes, MP4 sizes, speedup, PSNR and SSIM.

The encoder settings are intentionally shared by both paths and can be changed with the same environment variables:

```bash
PRESET=medium CRF=22 MAXRATE=14M npm run bench:render -- examples/ris-tv/index.html 300 720 5
```

Do not use a faster preset in only one side of the comparison; that would mix renderer transport speed with encoder speed.

## Asset handling

The raw renderer serves the render page from localhost instead of `file://` so the browser can POST binary frames to the same origin without CORS hacks.

When `FW_QUERY` contains a staged `file://` book cover, `render-raw.mjs` exposes that exact file as a same-origin local asset route before frame 0. S3 credentials still stay in the Node orchestration process and never enter browser code.

## Current limit

This removes PNG encoding, base64/CDP transfer, temporary PNG writes and the separate post-render encode phase. It does **not** solve Framewright's expensive full-frame JavaScript effects.

RIS TV's CRT still performs full-frame `getImageData`/sampling/`putImageData` work inside the scene renderer before the raw transport step. If the benchmark shows that CRT dominates after transport is removed, the next target is the post backend (GPU shader / native filter), not a rewrite of scene timing and layout logic.

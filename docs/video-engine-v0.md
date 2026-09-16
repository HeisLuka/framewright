# Video Engine v0

Goal: evolve Framewright from a one-file procedural-video template into a deterministic motion-design runtime suitable for mass book advertising.

## Vertical slices

### `technical-print-v0`

`examples/technical-print-v0/index.html` is a 9:16 procedural reference inspired by technical-print motion graphics. It deliberately uses only cheap scene primitives and deterministic math:

- circuit traces
- pseudo-3D cards
- line portrait reveal
- seeded particle dissolve
- kinetic title
- chip/grid diagram

The point is not visual parity with the supplied reference yet. The point is to validate the language boundary:

```text
RenderPlan
  -> compiled scene timeline
  -> recipe(frame, params)
  -> Canvas compositor
  -> optional post layer
  -> encoder
```

### `book-ad-v0`

`examples/book-ad-v0/index.html` is the first product-oriented slice:

```text
Newboo BookResponse / BookRepositoryRow
  -> deterministic BookRenderPayload
  -> immutable book-render-job
  -> Pretext typography compilation
  -> variable-width layout around an obstacle
  -> precompiled glyph home positions
  -> deterministic scene recipes
  -> frame-addressable Canvas render
```

It contains four scenes over 15 seconds:

1. kinetic hook
2. body/excerpt flowing around a cover region
3. cover/title reveal
4. CTA

No text or visual content is AI-generated at render time. Missing ad text is filled only by deterministic reuse of existing book fields; campaign copy can be supplied explicitly as human-authored inputs.

`src/book-render.mjs` now maps the actual Newboo book shapes into the renderer. It accepts a public `BookResponse`, a repository-style row, or an admin wrapper shaped as `{ book: ... }`.

## Motion Core

`src/motion-core.mjs` introduces:

- `compileRenderPlan()`
- `createFrameState()`
- deterministic seeded RNG
- easing and windowed progress
- partial polyline stroking
- `createMotionRuntime()`
- a compatibility `window.RISO` bridge with `render`, `frame`, `contact`, `total`, `fps`, and `plates`

The runtime is frame-addressable. A frame is still a pure function of plan + frame number + seed.

`window.RISO.render()` is the non-PNG seam used by the raw renderer. `window.RISO.frame()` remains the PNG reference/QA path.

## Layout Core

`src/layout-core.mjs` is intentionally independent of Pretext. It contains reusable geometry for:

- rectangular and circular obstacles
- blocked interval merging
- free line-slot carving
- line bands
- variable-width text flow through those slots

The text engine enters through callbacks. This keeps the scene/layout contract independent from the future choice of browser Canvas, HarfBuzz/Skia, or another measurement backend.

## Typography Compiler

`src/typography.mjs` is the first Pretext adapter. It provides:

- `fitTextBlock()` — binary-searches the largest usable font size under width/height/line-count constraints
- `compileTextFlow()` — compiles text around obstacles using Pretext line ranges
- `buildGlyphHomes()` — turns compiled lines into stable grapheme home positions for kinetic motion
- `drawCompiledText()` — draws already-compiled fixed text blocks

Typography is compiled before frame rendering; the renderer does not rerun line breaking on every frame.

## Asset boundary

`src/assets.mjs` introduces stable asset identity separately from transport.

For Newboo covers it follows the existing image-worker contract:

```text
source:
raw/books/{book_id}/covers/{cover_id}/source

processed:
public/books/{book_id}/covers/{cover_id}/{target}.webp
```

A RenderPlan/job keeps stable asset identity. It does not persist AWS/Yandex credentials or an expiring presigned URL.

Production flow now exists in `.agents/skills/framewright/scripts/book-ad.mjs`:

```text
Newboo book record
  -> stable cover descriptor when cover_id is available
  -> render orchestrator resolves source S3 object or public cover_url
  -> stage local asset before frame 0
  -> browser preloads + decodes once
  -> all frames reuse decoded image via drawImage()
```

The current Newboo public `BookResponse` exposes `cover_url` but not `cover_id`. The adapter does not fabricate a cover ID: it retains the public URL as transport fallback. An admin/repository row can provide the canonical `cover_id` and therefore the source object identity.

The browser-side layer contains no storage credentials. For raw rendering, staged file assets are served from the renderer's localhost origin.

## Render paths

Two paths now exist intentionally.

Reference path:

```text
Canvas
  -> toDataURL(PNG)
  -> base64 over CDP
  -> Node decode
  -> PNG files
  -> ffmpeg
  -> MP4
```

Production experiment:

```text
Canvas
  -> getImageData RGBA
  -> localhost binary POST
  -> ordered/backpressured frame sink
  -> ffmpeg rawvideo stdin
  -> MP4
```

`.agents/skills/framewright/scripts/ordered-frame-sink.mjs` is a small testable primitive that accepts out-of-order frames from parallel Chromium workers and acknowledges each producer only after that frame has been written in sequence. This keeps reorder memory bounded by roughly the number of workers rather than the whole video.

The raw path propagates encoder failures back through pending frame requests so workers do not remain blocked on dead POSTs after ffmpeg exits.

The existing PNG renderer remains untouched conceptually and now emits machine-readable metrics. `build.sh` and the raw renderer share configurable encoder settings (`PRESET`, `CRF`, `MAXRATE`, `BUFSIZE`, `VIDEO_CODEC`) so performance comparisons do not accidentally benchmark different encoders.

## Benchmark harness

`.agents/skills/framewright/scripts/bench-render.mjs` runs both render paths with the same HTML, seed, actual frame range, width, worker count and encoder configuration.

Example:

```bash
npm run bench:render -- examples/ris-tv/index.html 300 720 5
```

Each run writes a unique directory under `.bench/render/` containing:

```text
png-frames/
reference.mp4
raw.mp4
reference-render.json
raw-render.json
benchmark.json
```

The summary includes reference render time, reference encode time, raw render+encode time, effective FPS, intermediate PNG bytes, final MP4 sizes, speedup, PSNR and SSIM.

The harness records the actual clamped range returned by the renderer. Asking for more frames than the video contains no longer makes the summary pretend those extra frames existed.

No fresh benchmark result is claimed by this document. The harness is committed so the same workload can be measured on a known machine/cloud SKU.

## Running the first book-ad slice

Install dependencies first:

```bash
npm install
```

Inspect a real or exported Newboo book:

```bash
npm run book-ad -- info --book-json ./book.json
```

Render a contact sheet:

```bash
npm run book-ad -- sheet \
  --book-json ./book.json \
  --cells 16 \
  --cell-width 270 \
  --out shots/book-ad-v0-sheet.png
```

Render the final MP4 without frame PNGs:

```bash
npm run book-ad -- video-raw \
  --book-json ./book.json \
  --width 1080 \
  --tabs 5 \
  --out out/book-ad-v0.mp4
```

Or fetch directly from a running Newboo backend with `--book-id`, `NEWBOO_API_BASE`, and the appropriate auth cookie/header.

The old `video` command remains available for reference comparison.

## Implemented v0 layers

- deterministic scene/runtime API
- layout geometry independent of renderer backend
- compiled typography adapter
- stable asset identity and decoded browser cache
- real Newboo book -> BookRenderPayload adapter
- immutable book render job
- source/public cover staging in the CLI
- product-shaped `book-ad-v0` template
- raw RGBA -> ffmpeg render path without temporary PNG frames
- ordered parallel-frame sink with backpressure/failure propagation
- PNG-vs-raw benchmark harness with machine-readable metrics

## Next layers

1. Split composition pixels from per-frame post metadata so grain, blur, halftone, chromatic aberration, distortion and bloom can leave JavaScript without changing scene semantics.
2. Build a parity harness around the real RIS TV CRT: structural mode first (noise/flicker disabled), then stochastic/perceptual comparison.
3. Prototype the exact CRT math as a custom GPU shader/native post backend rather than approximating it with unrelated standard filters.
4. Add versioned Style + Template + Variant compilation above `BookRenderPayload`, preserving human-authored creative systems and deterministic parameter expansion.
5. Add pinned project fonts so typography is reproducible across render workers.
6. Add a first-class campaign/variant data source for human-authored hook/excerpt/CTA choices instead of passing overrides only through CLI flags.
7. Benchmark source-cover staging versus a dedicated high-resolution `video` derivative in Newboo's image-worker.
8. Once renderer timings are known on a concrete compute SKU, attach cloud price and calculate render dollars per video / 1k videos / 100k videos.

## Non-goals for v0

- no Rust/C++ rewrite of the whole scene engine
- no new editor
- no AI generation in the production pipeline
- no attempt to merge all of Newboo into Framewright
- no claim that raw transport solves expensive JavaScript post effects

The milestone is now a complete product-shaped path from Newboo book data and real cover assets through deterministic layout/motion into either a reference MP4 or a no-temp-PNG raw render. The next optimization target is the post backend, not the scene language.

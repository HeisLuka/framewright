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
curated book payload
  -> Pretext typography compilation
  -> variable-width layout around an obstacle
  -> precompiled glyph home positions
  -> deterministic scene recipes
  -> frame-addressable Canvas render
```

It contains four scenes over 15 seconds:

1. kinetic hook
2. excerpt flowing around a cover region
3. cover/title reveal
4. CTA

The example uses a fictional payload in `examples/book-ad-v0/book-data.mjs`; no text or visual content is AI-generated at render time.

## Motion Core

`src/motion-core.mjs` introduces:

- `compileRenderPlan()`
- `createFrameState()`
- deterministic seeded RNG
- easing and windowed progress
- partial polyline stroking
- `createMotionRuntime()`
- a compatibility `window.RISO` bridge with `frame`, `contact`, `total`, `fps`, and `plates`

The runtime is frame-addressable. A frame is still a pure function of plan + frame number + seed.

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

## Running the first book-ad slice

Install dependencies first:

```bash
npm install
```

Inspect the plan:

```bash
HTML=examples/book-ad-v0/index.html node .agents/skills/framewright/scripts/look.mjs info
```

Render a contact sheet:

```bash
HTML=examples/book-ad-v0/index.html node .agents/skills/framewright/scripts/look.mjs sheet 16 270 7 shots/book-ad-v0-sheet.png
```

Render selected frames:

```bash
HTML=examples/book-ad-v0/index.html node .agents/skills/framewright/scripts/look.mjs shot 30,120,240,360,440 540 7
```

The existing PNG renderer can also render the whole prototype for visual validation. Production transport is still a separate optimization track.

## Intended next layers

1. Replace the procedural placeholder cover with a first-class asset descriptor and image-worker-produced raster derivatives.
2. Add Newboo-style rich-inline runs and more obstacle types without coupling the motion runtime to reader DOM code.
3. Split style/post metadata from composition pixels so grain, blur, halftone, distortion and similar full-frame work can move to GPU/FFmpeg/native paths.
4. Replace PNG/base64 transport with ordered raw-frame streaming for production rendering.
5. Add versioned `Book + Template + Style + Variant -> immutable RenderPlan` compilation above the generic motion runtime.
6. Add pinned project fonts so typography is reproducible across render workers.

## Non-goals for v0

- no Rust rewrite
- no new editor
- no GPU post-processing yet
- no attempt to merge all of Newboo into Framewright
- no AI generation in the production pipeline

The milestone is now larger than a generic motion demo: we have a first product-shaped path from structured book data through Pretext layout into deterministic video frames.
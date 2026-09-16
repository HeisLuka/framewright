# Video Engine v0

Goal: evolve Framewright from a one-file procedural-video template into a deterministic motion-design runtime suitable for mass book advertising.

## First vertical slice

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

## Motion Core

`src/motion-core.mjs` introduces:

- `compileRenderPlan()`
- `createFrameState()`
- deterministic seeded RNG
- easing and windowed progress
- partial polyline stroking
- `createMotionRuntime()`
- a compatibility `window.RISO` bridge so existing Framewright tooling can still inspect/render the new runtime

The runtime is frame-addressable. A frame is still a pure function of plan + frame number + seed.

## Intended next layers

1. Import the useful pure pieces from Newboo's Pretext-based scene/layout kernel rather than rebuilding typography.
2. Add asset descriptors and precompiled raster assets produced by an image-worker-derived asset compiler.
3. Split style/post metadata from composition pixels so grain, blur, halftone, distortion and similar full-frame work can move to GPU/FFmpeg/native paths.
4. Replace PNG/base64 transport with ordered raw-frame streaming for production rendering.
5. Add a book-oriented RenderPlan compiler above the generic motion runtime.

## Non-goals for v0

- no Rust rewrite
- no new editor
- no GPU post-processing yet
- no attempt to merge all of Newboo into Framewright
- no AI generation in the production pipeline

The first milestone is a small, testable generic motion core with at least one expressive reference video.

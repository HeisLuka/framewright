# Frame controls v0

A render backend needs more than pixels when visual post-processing is driven by scene code.

Framewright now has a small per-frame control contract in `src/motion-core.mjs`.

A modern scene recipe may return controls without mutating the global runtime:

```js
function recipe(g, S) {
  // draw composition

  return {
    controls: {
      post: {
        grain: 0.8,
        vignette: 0.25,
        bloom: 0.35,
        chromaticAberration: 0.002,
      },
      cue: "cover-lock",
    },
  };
}
```

`createMotionRuntime()` normalizes that result and returns a frame state containing `controls`.

`installRisoBridge()` keeps a compact serializable snapshot as `window.RISO.lastFrame`:

```js
{
  frame,
  localFrame,
  progress,
  time,
  localTime,
  fps,
  seed,
  sceneId,
  controls: {
    post: { /* effect parameters */ },
    /* optional small control values */
  }
}
```

The compact snapshot intentionally excludes:

- Canvas/context objects
- full RenderPlan data
- recipe functions
- RNG functions
- decoded assets

That makes the long-term renderer boundary explicit:

```text
render composition(frame)
        |
        +----> RGBA / surface
        |
        +----> compact frame controls
                      |
                      v
              post-processing backend
              (Canvas / shader / native)
```

## Why this exists

The RIS TV reference already changes CRT parameters from scene code on individual frames (`bloom`, `vig`, `flick`, grain multiplier, wobble and skip behavior). Moving the expensive CRT math out of JavaScript while keeping only a pixel stream would lose those creative decisions.

The intended migration is therefore not:

```text
JS pixels -> external effect with fixed settings
```

It is:

```text
JS composition + deterministic control metadata
                 -> external post backend
```

## Compatibility

Recipes that return nothing keep working. Their normalized controls are simply:

```js
{ post: {} }
```

The existing PNG reference renderer and raw RGBA renderer do not change visual output because of this contract. `window.RISO.render()` still renders the frame exactly as before; `lastFrame` is metadata only.

## Next wiring step

The raw renderer can now export `RISO.lastFrame` beside each raw frame without serializing the full scene state. For the legacy RIS TV example, the equivalent compact metadata can be derived from the `S` object returned by `renderFrame()` (`S.post`, `S.grain`, `S.wobble`).

Once that sidecar is wired, the exact CRT migration can be benchmarked as two synchronized streams:

```text
composition RGBA frame N
post controls frame N
        |
        v
exact shader/native CRT
        |
        v
encoder
```

This keeps scene semantics in JS/TS and isolates the part that is actually expensive: full-frame pixel processing.

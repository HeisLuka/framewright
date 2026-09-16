# E11 — post-processing boundary proof

E11 proves the renderer boundary before any native/GPU CRT rewrite.

The product boundary is:

```text
scene composition RGBA + compact per-frame controls
                    -> post backend
                    -> encoder
```

The important constraint is that RGBA and controls are one ordered frame packet. A JSONL file may be emitted later for debugging or benchmarking, but transport must not let metadata for frame N drift away from pixels for frame N.

## Legacy RIS TV control mapping

`examples/ris-tv/index.html` already returns an `S` state from `renderFrame()`. The exact legacy CRT depends on:

- global frame `S.f` and `S.seed` for deterministic flicker/grain RNG;
- `S.post` for barrel, chromatic aberration, vignette, gain, flicker, grain and bloom overrides;
- `S.grain` as the scene grain multiplier;
- `S.wobble` for line wobble;
- `S.post.skip` to bypass CRT entirely.

E11 serializes those values into the same compact metadata shape used by modern `RISO.lastFrame`. Canvas objects, RNG functions and full scene state stay outside the contract.

## Boundary benchmark

The benchmark leaves the RIS TV reference file unchanged. It temporarily replaces the global `crt()` call at runtime in two ways:

1. `delegated`: a wrapper captures the boundary and calls the original CRT unchanged;
2. `composition`: the wrapper copies the composition surface directly to the output canvas.

For representative frames the script renders the original path and the delegated boundary path, compares every RGBA byte, and requires zero mismatches. This isolates architecture correctness from optimization.

Run locally on a machine with Puppeteer/Chrome:

```bash
AR=9:16 ROUNDS=2 node .agents/skills/framewright/scripts/bench-ris-post-boundary.mjs \
  artifacts/e11-ris-post-boundary.json 720 90 7
```

The result reports full legacy throughput, composition-only throughput, an estimate of CRT wall-time share, the theoretical speedup ceiling if post-processing were free, and exact boundary parity samples.

## Exit criteria

E11 is complete when:

- delegated boundary parity is byte-exact on representative frames;
- composition-only RIS TV can be measured independently from legacy CRT;
- every sampled frame exposes compact controls sufficient to reconstruct the current CRT;
- the Chromium runner records a real 720x1280 result.

Only after that should E12 implement an external CRT backend. E12 must compare its output against the unchanged legacy CRT, not against a visually approximate FFmpeg filter chain.

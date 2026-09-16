# R46 — adopt the proven deterministic text-fit cache into the canonical FAST renderer

## Why this exists

C25 found a real renderer bug while testing typography: `fitBlock` linearly repeated `measureText` / wrapping searches on every frame even though text and fit constraints are invariant within a video.

C25 fixed it with a per-document deterministic cache and proved **40/40 MP4 files byte-for-byte SHA-256 identical** before versus after the cache. Its strict pre-cache run produced 603.89 videos/hour; the canonical cached run produced 724.24 videos/hour. But that cache lived only inside the C25 experimental transform and was never adopted into the `examples/book-ad-systems/index.html` renderer from which the current R42/R44/R45 FAST-path fixtures are derived.

R46 tests that integration debt on the current shared-lab base before changing the canonical renderer.

## Candidate

Memoize only `fitBlock(text, fit-affecting options)` inside one document runtime.

Key fields are exactly those read by `fitBlock`:

- text;
- `maxW`;
- `maxH`;
- `maxLines`;
- starting size;
- minimum size;
- weight;
- line height.

On a hit the cache restores the same final canvas font state left by the original fitter and returns a defensive copy of the line array. Position, alignment, color, animation state and other drawing inputs are deliberately excluded because they do not affect the fitted result.

Full document navigation remains the job boundary, so the map is naturally discarded between heterogeneous jobs and cannot leak one book's layout into another.

## Current-base verification

The experiment builds two otherwise identical current C18 responsive templates:

- baseline: current renderer;
- candidate: baseline plus only the R46 fit cache.

Correctness:

- 3 books × 3 delivery profiles × 12 semantic/stress frames = 108 exact PNG SHA comparisons;
- every cached fixture must report nonzero entries and `hits > misses`;
- R42's existing sampled-Canvas state fingerprint must stay green;
- every timed artifact must keep exact frame/audio validation with zero job failures.

Performance:

- baseline and candidate each run the current production-shaped R42 c2 path;
- vertical, square and landscape;
- 12 heterogeneous jobs/profile;
- same Baseline/realtime/3 Mbps WebCodecs, cached AAC, stream-copy mux and synchronous artifact validation.

## Predeclared adoption gate

This is a tiny pure memoization primitive, not an architectural rewrite, so the value threshold is intentionally lower than the 10% gate used for Worker/pipeline changes.

Correctness is mandatory. Then R46 must show at least one of:

- >=5% equal-mix end-to-end throughput gain; or
- >=7.5% CPU/video reduction; or
- >=10% draw/video reduction.

Costs must remain bounded:

- aggregate p95 regression <=5%;
- aggregate peak RSS regression <=10%;
- videos/hour/GiB regression no worse than 2%;
- no delivery profile throughput regression worse than 3%;
- no profile p95 regression worse than 8%;
- no profile RSS regression worse than 12%.

If these gates pass, the exact same cache implementation earns a follow-up integration into the canonical renderer. If they fail, C25 remains valid evidence for its typography workload but the optimization is not generalized to FAST merely because it once helped a stress case.

R46 does not change typography policy, creative layout, codec policy, concurrency, page lifecycle or delivery semantics.

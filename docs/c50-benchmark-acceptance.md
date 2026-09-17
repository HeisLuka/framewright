# C50 benchmark acceptance

C50 is accepted as an experiment when the physical round-trip job proves the analyzer is sealed from hidden program provenance and reports measured recovery rather than assumed recovery.

Hard gates:

- every observed MP4 SHA-256 equals the canonical factory artifact SHA-256;
- delivery geometry/fps/duration are recovered for every item;
- unsupported axes remain explicitly unresolved;
- inferred JSON contains no hidden SceneProgram or TemplateVariant identity;
- inferred motion candidates are members of the current C40 registry only.

Diagnostic metrics (reported, not forced green):

- C40 motion top-1 recovery;
- C40 motion top-3 recovery;
- mean reciprocal rank;
- per-video candidate confidence and model error.

A low diagnostic score is a valid benchmark outcome. It is evidence that the current ObservationIR feature surface is insufficient and should drive the next observer pass.

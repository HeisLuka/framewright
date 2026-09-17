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

## Physical ecological baseline

The first six-video physical benchmark completed successfully through the canonical C49/C19/FAST path.

Hard-gate result:

- source MP4 hash exact: 6/6;
- delivery recovery exact: 6/6;
- unsupported axes honestly unresolved: 6/6;
- hidden SceneProgram/TemplateVariant identity leakage: 0 violations.

Motion diagnostic result:

- top-1: 0/6;
- top-3: 2/6;
- mean reciprocal rank: 0.166667.

This is not treated as a failed experiment. It establishes that global frame-difference energy alone is not a sufficient inverse representation for the current physical C40 motion families.

The ecological sample is also not a balanced six-class classifier benchmark: C49 selection intentionally optimizes production macro diversity rather than one-example-per-motion-family coverage. Other template axes vary together with motion.

## Controlled one-factor benchmark

C50 therefore also runs a second physical benchmark with one controlled factor:

- same C27 narrative;
- same book and cover;
- same visual system;
- same structural layout;
- same typography;
- same asset staging;
- same graphic device set;
- exactly one physical video for each current C40 motion family.

Only `motion_grammar` varies. The six ScenePrograms are still rendered through the normal C19 -> FAST route, and observer/inferer remain sealed from ground truth.

The controlled result answers a narrower question: can the current pixel observations distinguish C40 motion when other template axes are held constant? If controlled recovery is also weak, the next pass should add spatial motion observations rather than tune global-energy weights against the ecological sample.

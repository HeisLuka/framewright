# I16 — generalized experiment publication attribution

Canonical task identity for the work historically merged as PR #105 under the conflicting label I10.

I16 provides one semantic-preserving publication/export attribution envelope for multiple experiment sources:

- C34 selector arms retain lane and requested planning-bps semantics;
- I15 blocked publication opportunities retain treatment/block/slot context and do **not** acquire a fake selector lane.

The shared flow is:

`source experiment plan -> I16 assignment set -> partial/complete publication manifest -> platform-specific C31 join -> unchanged C30 evidence + observation attribution sidecar`.

The compatibility audit requires the C34 path to produce canonical C30 evidence equivalent to historical I14/I08 evidence while the blocked path round-trips independently across multiple platform exports.

## Compatibility

The canonical entrypoints are:

- `.agents/skills/framewright/scripts/i16-general-publication-attribution.mjs`
- `.agents/skills/framewright/scripts/i16-general-publication-attribution-audit.mjs`

They intentionally delegate to the historical `i10-*` implementation/wire schemas so PR #105 and its CI artifact remain reproducible. Task/roadmap references must use I16 going forward.

No behavior changes in the namespace repair.

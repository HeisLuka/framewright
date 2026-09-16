# I14 — arm-aware publication attribution round-trip

Canonical task identity for the work historically merged as PR #101 under the conflicting label I08.

I14 preserves C34 selector `arm / lane / requested_bps` provenance through publication mapping and C31 ingestion while keeping canonical C30 evidence unchanged. The same control CreativeSpec/RenderSpec may be published separately as holdout and exploration; attribution therefore survives by publication/observation identity rather than creative ID alone.

Critical boundary: C34 basis points are **requested planning metadata**, not observed organic viewer delivery. Actual delivery/outcomes require a real platform export.

## Compatibility

The canonical entrypoints are:

- `.agents/skills/framewright/scripts/i14-publication-attribution-roundtrip.mjs`
- `.agents/skills/framewright/scripts/i14-publication-attribution-roundtrip-audit.mjs`

They intentionally delegate to the historical `i08-*` implementation/wire schemas so PR #101 and its CI artifact remain reproducible. Task/roadmap references must use I14 going forward.

No behavior changes in the namespace repair.

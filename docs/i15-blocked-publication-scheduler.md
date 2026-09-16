# I15 — blocked publication-opportunity scheduler

Canonical task identity for the work historically merged as PR #104 under the conflicting label I09.

I15 compiles the exact C37 screening treatments into deterministic complete publication blocks. The randomized/control unit is the **publication opportunity**, not the viewer. Every treatment appears exactly once per block, cyclic replicate rotation balances treatment against slot position, and platform-specific canonical RenderSpecs survive into each assignment.

The canonical C37 audit used 8 treatments × 8 complete blocks = 64 synthetic publication opportunities. Each treatment appeared 8 times total, 4 times per fixture platform, and exactly once in every slot position 0–7. Those are schedule-mechanics checks only; there is no campaign-performance or viewer-randomization claim.

## Compatibility

The canonical entrypoints are:

- `.agents/skills/framewright/scripts/i15-blocked-publication-scheduler.mjs`
- `.agents/skills/framewright/scripts/i15-blocked-publication-scheduler-audit.mjs`

They intentionally delegate to the historical `i09-*` implementation/wire schemas so PR #104 and its CI artifact remain reproducible. Task/roadmap references must use I15 going forward.

No behavior changes in the namespace repair.

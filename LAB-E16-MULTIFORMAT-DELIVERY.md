# E16 — multi-format delivery probe

## Product question

Can a finished semantic book-ad creative be delivered automatically as 9:16, 1:1 and 16:9 without a manual template fork, or does useful landscape/square output require responsive semantic reflow before rasterization?

E16 deliberately tests the cheapest post-raster baselines first rather than immediately rewriting all three visual systems.

Representative sources:

- `river-station` / Paper;
- `city-seven` / Swiss;
- `long-title` / Newspaper.

Each source uses the routed-primary system, E12 active motion and E14 `hook-first` structure at 1080x1920 / 12 seconds.

## Raster-only adapters

For each source E16 creates:

- square 1080x1080 `contain` — keep 100% of the vertical frame, pad unused area;
- square 1080x1080 `cover` — fill the frame, crop the vertical source;
- landscape 1920x1080 `contain`;
- landscape 1920x1080 `cover`.

The point is not to declare either adapter beautiful. The point is to quantify the geometry tradeoff before spending engineering effort on responsive scene semantics.

## Guardrails

A delivery strategy is considered geometrically acceptable only if it retains at least 80% of the source content and uses at least 55% of the destination frame area.

For a 9:16 source, pure geometry predicts:

- 1:1 contain: 100% source retention, ~56.25% destination utilization;
- 1:1 cover: ~56.25% source retention, 100% utilization;
- 16:9 contain: 100% source retention, ~31.64% utilization;
- 16:9 cover: ~31.64% source retention, 100% utilization.

So square contain may barely clear the baseline, while neither raster-only landscape strategy should satisfy both constraints. CI verifies actual output dimensions/durations and generates visual compare sheets for all three systems.

## Decision rule

If landscape has no raster-only strategy that clears both retention and utilization, the next layer must be semantic responsive layout: aspect-ratio-aware safe areas, typography, cover placement and plate composition before rasterization. Do not try to fix a semantic-layout problem with increasingly clever FFmpeg crops.

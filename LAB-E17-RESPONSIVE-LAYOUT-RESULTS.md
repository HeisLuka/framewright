# E17 — responsive semantic layout results

Canonical GitHub Actions run: `35123954004`.

## Product question

Can the same semantic creative be rendered natively as vertical, square and landscape output by reflowing composition before rasterization, while keeping BookPayload, routed visual system, motion grammar and RNG seed stable?

E17 tests three representative routed-primary hook-first creatives:

- Paper / `river-station`;
- Swiss / `city-seven`;
- Newspaper / `long-title`.

Each is rendered under three delivery profiles:

- vertical: `1080x1920`;
- square: `1080x1080`;
- landscape: `1920x1080`.

Square and landscape have their own safe areas and semantic placement of hook/title/cover/author/CTA. They are not scaled/cropped copies of the vertical raster.

## Canonical result

- complete videos: `9/9`;
- layout warning groups: `0`;
- exact dimensions: pass for all nine outputs;
- visual system stays constant across profiles for each book: pass;
- RNG seed stays constant across profiles for each book: pass;
- peak Node+FFmpeg RSS across the mixed-profile batch: `704.6 MiB`;
- aggregate mixed-profile batch: `767.24 videos/hour` (not a useful single production rate because profiles have different pixel counts).

Per-profile sequential rates on this runner:

| delivery profile | resolution | mean video time | videos/hour | mean MP4 |
|---|---:|---:|---:|---:|
| vertical | 1080x1920 | 5.666 s | 635.32/h | 501.2 KiB |
| square | 1080x1080 | 3.420 s | 1052.72/h | 346.9 KiB |
| landscape | 1920x1080 | 4.926 s | 730.75/h | 454.5 KiB |

Performance is secondary here; the main E17 result is layout quality.

## Manual review

Review sheets sample hook / book / CTA moments for all three profiles.

### Paper / river-station

- square uses the full square canvas with a large readable hook, cover/title split and full-width CTA rather than E16 side padding;
- landscape becomes a real wide two-column composition with hook and cover sharing the frame;
- the Paper tape/collage identity remains recognizable across profiles.

### Swiss / city-seven

- square preserves the hard-grid/poster hierarchy without cropping the hook or CTA;
- landscape uses the width for text/cover separation and a wide CTA instead of enlarging/cropping the vertical poster;
- Swiss rails/grid/accent language survives the profile change.

### Newspaper / long-title

- the long-title stress fixture remains readable in square and landscape;
- landscape becomes a natural editorial spread rather than a small vertical newspaper page inside a widescreen frame;
- masthead/rule/editorial grammar remains recognizable.

The visual review directly resolves the E16 failure mode: native layouts use the destination frame rather than choosing between dead padding and destructive crop.

## Decision

E17 passes the responsive-layout contract probe.

1. Useful multi-format delivery belongs on the semantic scene/layout layer before rasterization.
2. `vertical`, `square` and `landscape` should be explicit delivery profiles with their own safe areas and composition constraints.
3. BookPayload, visual-system choice, structural-variant semantics, motion grammar and seed can remain stable across delivery profiles.
4. `creative_id` should remain the semantic creative identity; `delivery_profile` belongs in render/delivery provenance and therefore changes `render_id` / exact output identity.
5. Do not maintain three unrelated template forks. Extract shared profile primitives and let each visual grammar provide profile-aware composition rules.

## Next product layer

Apply the responsive contract to the bounded E15 package rather than only three representative creatives. The next useful experiment is a delivery-package expansion that takes selected campaign creatives and emits requested profile variants with stable parent `creative_id`, per-profile `render_id`, hashes and QA evidence — without multiplying every reserve candidate unnecessarily.

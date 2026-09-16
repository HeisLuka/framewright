# E17 — responsive semantic layout

## Product question

Can the same semantic creative be rendered natively as vertical, square and landscape output by reflowing composition before rasterization, while keeping BookPayload, routed visual system, motion grammar, seed and hook-first dramaturgy stable?

E16 showed that raster-only adaptation is not good enough. E17 therefore moves aspect-ratio handling into the scene/layout layer.

## Scope

Representative stress creatives:

- Paper / `river-station`;
- Swiss / `city-seven`;
- Newspaper / `long-title`.

Delivery profiles:

- `vertical`: 1080x1920;
- `square`: 1080x1080;
- `landscape`: 1920x1080.

The same book/style/seed is used across the three delivery profiles. Only layout profile and output dimensions change.

## Semantic reflow

Square and landscape are not coordinate-scaled copies of the vertical frame. E17 chooses profile-specific safe areas and repositions semantic regions before drawing:

- hook text block;
- cover;
- eyebrow/brand/header grammar;
- title and author;
- supporting hook/excerpt;
- CTA button;
- page/plate markers.

The three visual grammars remain recognizable through their own backgrounds/header treatments and the existing E12 motion wrapper.

## Acceptance

- 3 systems x 3 profiles = 9 complete 12-second videos;
- exact expected dimensions for every profile;
- zero text/layout warnings;
- same seed and visual system across delivery profiles for a given book;
- manual hook/book/CTA review confirms square and landscape use the frame natively rather than reproducing E16 letterbox/crop failure modes;
- long-title Newspaper stress fixture remains legible in all three profiles.

E17 is a contract probe, not yet a universal responsive-layout DSL. If it passes across the three different visual grammars, the next step is to extract the repeated profile/safe-area primitives into reusable template APIs and apply them across the bounded E15 campaign package.

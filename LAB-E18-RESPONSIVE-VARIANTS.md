# E18 — responsive structural variants

## Why this exists

E17 proved native responsive layout for the ordinary hook/book/CTA path, but E15's selected campaign set also contains E14 `cover-first`, `title-first` and `hook-title` structural variants. The E14 custom title plate was still authored only for the vertical coordinate system.

Expanding E15 directly to three delivery profiles would therefore create a false multi-format contract: some selected variants would still contain vertical-only semantic layout.

## Experiment

E18 closes that gap before campaign-package expansion.

Representative routed-primary books:

- Paper / `river-station`;
- Swiss / `city-seven`;
- Newspaper / `long-title`.

Matrix:

- four structural variants: `hook-first`, `cover-first`, `title-first`, `hook-title`;
- three delivery profiles: `vertical`, `square`, `landscape`;
- total: `3 x 4 x 3 = 36` full 12-second videos.

The ordinary hook/book/CTA plates use the E17 responsive semantic layouts. E18 makes the special E14 title plate profile-aware as well.

## Acceptance

- 36/36 outputs;
- zero layout warnings;
- exact dimensions per profile;
- same visual system and RNG seed across the 12 renders for one book;
- all four variant IDs exist in all three profiles;
- manual first-plate review confirms `title-first` and the other opening semantics remain visually distinct and usable in square/landscape;
- long-title Newspaper remains readable.

If E18 passes, the next campaign delivery package can safely expand the bounded E15 selected creatives to requested profiles without hidden vertical-only variant semantics.

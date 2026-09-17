# C39 — Structural layout families v2

C39 adds six genuinely reusable structural layout recipes on top of the C38 axis registry. They are not six copied HTML templates. Each family resolves into the same normalized 1000×1000 safe-space contract and can therefore be combined later with independent motion, typography, staging and graphic-device axes.

## Families

- `layout_type_led_poster_v2` — type-first poster with secondary cover stage.
- `layout_split_editorial_v2` — explicit copy/cover split.
- `layout_cover_dominant_stage_v2` — cover is the dominant central object.
- `layout_modular_card_stack_v2` — modular text/cover/card regions.
- `layout_quote_wall_v2` — large editorial quote field with corner book payoff.
- `layout_centered_cinematic_v2` — centered cover and lockup hierarchy.

Every family has a distinct composition grammar, reading order and book-reveal structure. C39 deliberately does not own animation/easing; that remains C40.

## Responsive contract

`resolveStructuralLayout()` accepts:

- one family ID;
- `vertical | square | landscape`;
- authoritative copy used only to derive `short | medium | long` density.

It returns bounded slots inside normalized safe space:

- `primary_text`;
- `secondary_text`;
- `cover`;
- `cta`;
- `meta`.

C27 semantic roles are bound to those slots without reordering or rewriting narrative semantics. Geometry never depends on a book-specific manual patch.

The normalized geometry is delivery-agnostic. Runtime safe-zone projection remains downstream; C39 does not put a DeliveryProfile into template identity.

## C38 integration

`extendRegistryWithStructuralLayouts()` derives a new content-addressed C38 registry snapshot and appends the six C39 options to `structural_layout`. These new families have no visual-system lock, so each can compose with the settled `swiss`, `newspaper` and `paper` systems while the other legacy axes keep their existing compatibility requirements.

The acceptance therefore proves 18 valid template combinations before C40–C42 add more independent axes.

## Acceptance corpus

The C39 gate covers:

- 6 families;
- 3 aspect classes;
- 3 copy-density classes;
- 54 deterministic resolved layouts;
- normalized safe-space containment;
- zero overlap among primary text, secondary text, cover and CTA critical slots;
- deterministic replay;
- text-area capacity against the fixed short/medium/long corpus;
- pairwise geometric distance between every family in every aspect;
- all 6 layouts combined with all 3 settled visual systems;
- stable template identity while the same variant is checked against three downstream aspect contexts.

The pairwise distance is descriptive geometry evidence, not a creativity score.

## Non-goals

C39 does not add motion families, font/type systems, asset-staging variants, campaign selection, codec changes or a second renderer. Physical 40-video proof remains C45 after the independent axes are composed by C43/C44.

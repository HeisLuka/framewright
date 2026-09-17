# C41 — Typography + graphic-device library v2

C41 turns the proven C25 typography experiment into a reusable, typed visual vocabulary and separates graphic devices into their own bounded axis.

## Typography continuity

C25 proved that typography can be an independent deterministic creative axis without changing copy, cover, composition, pacing, motion or seed. It used one pinned DejaVu Sans family and varied hierarchy, scale, weight, measure, line-height and tracking across four systems: `baseline`, `display-led`, `editorial`, and `compact-dense`.

C41 keeps those four systems explicitly traceable and adds two more bounded systems. It does not reduce typography to a font-name switch.

The six v2 type systems are:

- `type_neutral_grotesk_v2` — C25 `baseline` continuity.
- `type_display_led_v2` — C25 `display-led` continuity.
- `type_editorial_hierarchy_v2` — C25 `editorial` continuity.
- `type_compact_dense_v2` — C25 `compact-dense` continuity.
- `type_mono_dossier_v2` — bounded mono/dossier hierarchy.
- `type_oversized_display_v2` — aggressive display-led hierarchy with reduced measure.

The wire contract contains only stable `font_stack_id` values and numeric tokens. Font files, font URLs and arbitrary CSS are not accepted.

## Deterministic fitting

`fitTypography()` is a deterministic layout model for pre-render validation. It uses:

- server-owned font-stack metric class;
- bounded glyph-width factor;
- role-specific scale and weight;
- measure scale;
- line-height;
- tracking;
- minimum font size;
- C39 target slot geometry.

It emits wrapped lines, final font size, weight, line height, tracking, measured width/height and a content-addressed `fit_id`. The model is intentionally a contract-level deterministic fit oracle, not a claim of pixel-perfect browser font measurement. Physical typography remains verified by the real renderer in C45.

## Graphic devices

Nine bounded devices are separate from typography:

- `device_rule_pair_v2`
- `device_solid_block_v2`
- `device_label_chip_v2`
- `device_counter_badge_v2`
- `device_quote_marks_v2`
- `device_underline_bar_v2`
- `device_corner_brackets_v2`
- `device_stamp_ring_v2`
- `device_side_panel_v2`

Each device declares:

- stable ID/version;
- primitive kind;
- C39 anchor slot;
- layer behavior;
- total normalized-area budget;
- overlay occlusion budget where applicable.

`resolveGraphicDevice()` materializes only deterministic rectangles/segments inside the selected C39 anchor slot. There is no SVG path, CSS, canvas callback or arbitrary drawing code in the creative contract.

## C38/C39/C40 composition

C41 derives a new C38 registry snapshot after C39 structural layouts and C40 motion grammars are installed. The six new typography options and nine new graphic devices are cross-compatible by default; incompatibility must be declared explicitly in a future version rather than inferred from style names.

The current cross-axis acceptance proves single-device combinations across:

`6 typography × 9 devices × 3 settled visual systems × 3 aspects = 486` validated template contexts.

The context role set remains the honest C38 legacy intersection `hook + book_reveal + cta`; C41's typography fitter itself supports all C27 roles.

## Acceptance

The C41 gate requires:

- six materially distinct bounded typography token sets;
- explicit continuity to all four proven C25 systems;
- at least eight graphic devices; v2 ships nine distinct primitive kinds;
- deterministic typography replay;
- no overflow on a fixed Russian / English / mixed long-copy corpus across all six C39 layouts and all three aspect classes;
- six distinct typography states for the same fixed copy and box after removing system identity from the comparison;
- deterministic graphic-device geometry across all layouts/aspects;
- every device segment contained by its anchor and normalized safe space;
- declared area/occlusion budgets respected;
- cross-axis C38 variant validation;
- rejection of raw CSS, font URLs and arbitrary draw code.

## Ownership and non-goals

C41 owns typography tokens, deterministic pre-render fitting and decorative primitive selection. C39 still owns structural slots. C40 owns choreography. C27 owns semantic copy/order/timing. Delivery remains downstream. C41 does not ship font binaries, invent book imagery, add executable style blobs, score creativity or fork the renderer.

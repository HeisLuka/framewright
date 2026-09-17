# C38 — Template variability contract + axis registry v1

## Decision

Template variability is a bounded creative contract, not a directory of unrelated HTML templates and not arbitrary styling input.

One visual variant is represented as six explicit axes:

1. `structural_layout`
2. `visual_system`
3. `typography`
4. `motion_grammar`
5. `asset_staging`
6. `graphic_devices`

The server-owned registry supplies the only valid option IDs. Options declare their supported semantic roles, durations, aspect classes, trusted asset requirements and declarative compatibility requirements. The external creative side selects IDs; it never supplies CSS, HTML, JS, file paths, asset URLs or renderer code.

## Identity

The materialized registry is content-addressed as:

`nbtvr1_<sha256(canonical registry semantics)>`

A selected variant is content-addressed as:

`nbtv1_<sha256(schema + registry_id + normalized axis selection)>`

Registry option order, JSON key order and graphic-device input order do not alter identity. A visible axis selection is part of template identity.

Delivery is deliberately absent from `template_variant_id`. The same semantic visual variant can be validated later against vertical, square or landscape execution context without acquiring a new template identity. Delivery geometry continues to belong to `DeliveryProfile -> RenderSpec`.

## Semantic ownership

`NarrativePlan` continues to own narrative role order and semantic timing. Template variability owns how those roles are presented visually. It cannot add, remove or rewrite hook, tension, payoff, book reveal or CTA semantics.

A variant can declare that it does not support a role or duration. The downstream context validator fails closed before physical rendering rather than silently changing the NarrativePlan.

## Compatibility model

Each registry option may contain declarative `requires` clauses. Example:

```json
{
  "id": "type_paper_shadow_display_v1",
  "requires": [
    {"axis": "visual_system", "any_of": ["paper"]}
  ]
}
```

C38 intentionally seeds the registry with the three settled visual systems already present in the renderer: `swiss`, `newspaper`, and `paper`. Their current structure, typography treatment, choreography, cover staging and graphic devices are represented as three legacy-compatible tuples.

This does **not** pretend the old implementation already had six freely interchangeable axes. Those legacy options remain coupled through explicit compatibility requirements. C39–C42 expand the registry with genuinely cross-compatible layout, motion, typography/device and staging families.

## Context validation

`validateTemplateVariantForContext()` validates, without changing variant identity:

- aspect class: `vertical | square | landscape`;
- duration: `3 | 5 | 7 | 9 | 12 | 15` seconds;
- semantic roles required by the current NarrativePlan;
- trusted asset kinds available to the runtime.

A missing cover, unsupported role, unsupported aspect or unsupported duration is a deterministic rejection.

## Trust boundary

The C38 wire surface contains stable IDs and bounded metadata only. Unknown fields fail closed. In particular, registry/variant objects have no place for:

- CSS or style strings;
- raw HTML or script;
- file-system paths;
- asset URLs;
- arbitrary animation/easing code;
- delivery profile selection;
- factual or narrative copy.

Assets remain authoritative server-owned inputs. Copy/truth remains governed by the existing C32/C33/C35/C36 boundaries.

## Current registry

The v1 seed registry contains three options on each axis, corresponding to the settled legacy systems:

| visual system | structural layout | typography | motion | cover staging | graphic device |
| --- | --- | --- | --- | --- | --- |
| swiss | `layout_swiss_editorial_v1` | `type_swiss_sans_scale_v1` | `motion_swiss_slide_fade_v1` | `stage_swiss_cover_v1` | `device_swiss_grid_rules_v1` |
| newspaper | `layout_newspaper_editorial_v1` | `type_newspaper_hierarchy_v1` | `motion_newspaper_staged_fade_v1` | `stage_newspaper_framed_cover_v1` | `device_newspaper_masthead_rules_v1` |
| paper | `layout_paper_collage_v1` | `type_paper_shadow_display_v1` | `motion_paper_tape_slide_v1` | `stage_paper_tilted_cover_v1` | `device_paper_tape_marks_v1` |

The registry names describe observed settled behavior in `examples/book-ad-systems/index.html`; C38 does not change renderer output.

## Acceptance gates

The C38 contract regression requires:

- all six axes present and versioned;
- content-addressed registry and template identities;
- key/order-invariant replay;
- all three legacy tuples accepted and distinct;
- incompatible cross-system selections rejected;
- unknown options and duplicate devices rejected;
- forged variant identity rejected;
- vertical/square/landscape context validation preserving one template identity;
- missing required assets and unsupported semantic roles rejected;
- delivery ownership injection rejected;
- raw CSS and asset URL injection rejected.

## Non-goals

C38 does not create the six new layout/motion/staging families, does not fork the renderer, does not modify C27 narrative grammar, does not tune codec/runtime behavior, does not pick campaign winners, and does not invent a scalar creativity score.

Follow-up sequence is `C39/C40/C41/C42 -> C43 composer -> C44 batch anti-repeat -> C45 40-video physical acceptance`.

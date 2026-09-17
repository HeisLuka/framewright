# I18 — delivery ownership cleanup

## Decision

Creative authorship and delivery selection are separate identities.

`newboo-creative-ingress-v2` removes concrete `delivery_profile` from the LLM-authored `presentation`. The server-owned `ContextPack.capabilities.delivery_profiles` remains the authority for which outputs are allowed, while the factory/campaign request chooses the requested profiles later.

```text
ContextPack capabilities
        ↓
LLM creative ingress v2
(duration / fps / visual system / seed)
        ↓
profile-independent creative program
        ↓
factory request: requested_delivery_profile_ids
        ↓
DeliveryProfile expansion
        ↓
RenderSpec per profile
```

## Migration from v1

The v1 contracts remain reproducible for historical artifacts. V2 is intentionally strict: an authored `presentation.delivery_profile` is rejected rather than silently ignored. This prevents two distinct authored JSON documents from collapsing onto one creative identity.

The v2 adapter does not introduce a second narrative/compiler implementation. Each trust mode delegates to the existing C31/C36/C33 compiler. Because those legacy validators still require a delivery field, the adapter injects one deterministic **server-owned validation profile** from the ContextPack capability list. That value exists only at the legacy adapter boundary and is removed from the canonical v2 program before identity is minted. Downstream requested delivery profiles never affect the canonical input/program/ingress IDs.

## Trust modes

The rule applies uniformly to:

- `trusted_atoms`
- `verified_composition`
- `external_copy_review_required`

External-copy review remains server-owned. V2 approval binds the profile-independent draft/program/copy manifest, so approving copy does not implicitly approve or lock one aspect ratio.

## Delivery gate

`validateRequestedDeliveryProfiles(pack, ids)` is the downstream capability boundary. Empty, duplicate, or ContextPack-disallowed delivery requests fail closed. Supported profile IDs are normalized deterministically before factory expansion.

## Proof

`node contracts/check-creative-ingress-v2.mjs` proves:

- all three modes compile without `delivery_profile` in authored or canonical program presentation;
- legacy authored `delivery_profile` is rejected under v2;
- object-key order does not change input/program/ingress identity;
- external approval changes only the decision receipt, not render-program or ingress identity;
- ContextPack allows vertical, square, and landscape profile IDs while an unsupported profile fails closed;
- the same semantic creative identity combined with different Delivery objects produces distinct `render_spec_id` values.

## Non-goals

I18 does not make the physical executor multi-aspect. That is I19. It does not prove the full queue/render/cache round trip across all formats; that is I20. It does not tune codec, bitrate, Chromium lifecycle, concurrency, or visual quality policy.

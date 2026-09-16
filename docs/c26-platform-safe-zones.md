# C26 — Platform-safe semantic layout policy

Retrieved/defined: **2026-09-17**.

## What this file does and does not claim

YouTube Shorts, Instagram Reels and TikTok all place viewer UI over vertical video. Current official guidance supports the **safe-zone principle**, but it does not give us one eternal organic-video rectangle in 1080×1920 pixels that is guaranteed across app versions, devices, caption lengths and interactive surfaces.

Therefore C26 separates two things:

1. **documented platform behavior** — viewer UI can occlude content; editors/checkers/simulators should be used;
2. **Framewright policy** — versioned conservative rectangles used by our semantic layout engine and QA.

The numeric values in `examples/book-ad-systems/platform-ui-profiles.v1.json` are **our policy**, not a statement that a platform officially requires those exact pixels.

## Current authoritative evidence

### YouTube Shorts

Official YouTube Help: <https://support.google.com/youtube/answer/16215842>

YouTube's Shorts editor exposes visual guides while positioning text/stickers. The guides show where like/comment/description viewer elements may appear. Moving an overlay too close to an edge can produce a non-safe warning, and YouTube notes that content may be partially hidden on some devices.

Implication: safe placement is interface/device dependent. We keep a conservative right-side action-rail reserve and preserve our already-large top/bottom margins.

### TikTok

Official Effect House preview guidance: <https://effecthouse.tiktok.com/learn/guides/publishing/preview-in-effect-house>

TikTok provides a UI simulation specifically to test the safe-zone area and also supports different phone-resolution simulation.

Official TikTok Creative Center guidance: <https://ads.tiktok.com/business/creativecenter/quicktok/online/tiktok_creative_accelerator/pc/en>

TikTok states that fixed For You Page UI elements can block creative and important elements should remain in the safe zone. We use this only as evidence for UI topology/occlusion, not as an official organic pixel specification.

Implication: the profile must be versioned and should be validated against current app/device previews periodically. C26 uses the widest right-side reserve of the three platform profiles.

### Instagram Reels

Official Meta for Business Reels guidance: <https://www.facebook.com/business/ads/facebook-instagram-reels-ads>

Meta recommends vertical 9:16 Reels with key creative elements in the safe zone and provides a Reels safe-zone checker. The public text does not expose one permanent organic 1080×1920 rectangle.

Implication: C26 uses a conservative policy rectangle and records the evidence/source date. The numeric inset is ours, not Meta's claimed organic requirement.

## v1 policy at 1080×1920

| Profile | Safe rect `x,y,w,h` | Main change vs generic |
| --- | --- | --- |
| generic | `76,288,928,1248` | existing Framewright control |
| youtube_shorts | `76,288,814,1248` | reserve 190 px right rail |
| instagram_reels | `76,288,834,1248` | reserve 170 px right rail |
| tiktok | `76,288,804,1248` | reserve 200 px right rail |

All three platform profiles also visualize the already-existing 288 px top and 384 px bottom conservative margins as UI-exclusion policy zones.

The policy intentionally does **not** globally scale the entire composition down. `SAFE.w` becomes narrower before semantic layout functions run, so text measures, columns and cover/text relationships are recomputed inside the available area.

## QA contract

C26 captures real text bounding boxes from the C25 typography instrumentation and adds cover bounding boxes. For sampled frames across every semantic plate, critical captured boxes must remain inside the active profile's `safeRect` (within a small rendering tolerance).

Review sheets additionally render the policy overlay so a human can see whether the result still uses the frame well instead of merely passing an automated inset check.

## Refresh policy

Create a new version rather than silently editing `c26-ui-safe-v1-2026-09-17` when:

- platform UI materially changes;
- current official editor/checker/simulator guidance changes;
- publishing tests show systematic occlusion on real devices;
- caption/interaction policies require a distinct publishing profile.

Existing rendered artifacts keep the profile version in provenance so they remain auditable.

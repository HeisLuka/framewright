# C26 — Platform-safe semantic layouts for organic short video

## Question

Can the current Creative/Product stack adapt organic vertical video for YouTube Shorts, Instagram Reels and TikTok viewer UI **before rasterization**, while preserving visual-system character and avoiding a dumb global shrink-to-center workaround?

## Evidence boundary

C26 intentionally separates documented platform behavior from our numeric layout policy.

Current platform guidance supports the safe-zone problem itself: viewer UI can obscure content and current editors/checkers/simulators should be used. Public guidance does not give us one permanent organic 1080×1920 pixel rectangle that is guaranteed across all devices, app versions, caption lengths and interaction states.

Therefore:

- `platform-ui-profiles.v1.json` is a **versioned Framewright policy**;
- its numeric rectangles are **not claimed official platform pixel requirements**;
- source URLs and retrieval date live with the policy;
- a future UI change creates a new profile version instead of silently mutating old artifact provenance.

Policy version: `c26-ui-safe-v1-2026-09-17`.

## Canonical run

- GitHub Actions: `35147014543`
- head SHA: `8cde2c94c3c4ac738ade5d6f3f1fadfab4f81657`
- artifact: `10466524223`
- artifact digest: `sha256:ff2af3365dc49e81d698ef02bd27816f8257b9f87bc92e777e3bc00a745ab076`
- matrix: 3 visual systems × short/long copy × `generic / youtube_shorts / instagram_reels / tiktok` = **24 videos**
- result: **24/24 rendered, 0 layout warnings, 0 safe-zone violations, 0 audit errors**

C24 remained active, so the short fixtures rendered as **5s** and the long stress fixtures as **15s**. C25 typography instrumentation remained active and supplied actual text bounding boxes.

## Policy rectangles at 1080×1920

| Profile | Safe rect `x,y,w,h` | Safe frame area |
| --- | --- | ---: |
| generic | `76,288,928,1248` | 55.85% |
| YouTube Shorts policy | `76,288,814,1248` | 48.99% |
| Instagram Reels policy | `76,288,834,1248` | 50.19% |
| TikTok policy | `76,288,804,1248` | 48.39% |

All three platform policies preserve the existing conservative top/bottom margins and reserve additional right-side width for the viewer action rail. These are our current conservative policy values, not official permanent platform dimensions.

## What the audit actually checks

For every fixture C26 boots the generated semantic template and samples each active semantic plate at 18%, 50% and 82% progress.

C25 supplies actual text boxes; C26 additionally captures cover boxes. The audit validates title/hook/CTA/brand/text/cover geometry against the active safe rectangle with a 12 px rendering tolerance.

Final audit counts:

- generic: 6/6 profiles, 0 violations
- YouTube Shorts: 6/6, 0 violations
- Instagram Reels: 6/6, 0 violations
- TikTok: 6/6, 0 violations

## Useful failure before the pass

The first C26 audit failed with **66 real violations**. The gate was not weakened.

It exposed two semantic debts:

1. Swiss CTA was centered on `CX=540` — the whole canvas — even when a platform profile reserved a right-side UI rail. Long-copy YouTube/TikTok CTA content therefore crossed the active safe boundary.
2. Paper text blocks historically used widths near the full generic safe width, while motion nudges could push their measured box a few pixels beyond the current safe boundary.

The production fix was semantic:

- vertical `CX` is now the center of the active `safeRect`;
- `textBlock` / `label` maximum width is clamped to the real safe boundary after alignment/motion context;
- the safe-zone validator remains strict.

This was more valuable than simply adding a red overlay: the platform pass found and repaired generic layout debt.

## Runtime impact

The safe-aware semantic layout has no measurable throughput penalty against the generic control in this matrix.

Platform wall-time ratios vs generic:

| Profile | mean | p50 | p95 | max |
| --- | ---: | ---: | ---: | ---: |
| YouTube Shorts | 0.9643× | 0.9748× | 0.9983× | 1.0218× |
| Instagram Reels | 0.9651× | 0.9903× | 0.9969× | 1.0264× |
| TikTok | 0.9616× | 0.9728× | 0.9934× | 1.0136× |

Whole mixed batch throughput: **1368.04 videos/hour** on the CI runner. Peak combined Node + FFmpeg RSS: **745.3 MiB**.

Files were also slightly smaller on average because the usable composition width is narrower; that is an incidental observation, not an encoder conclusion.

## Manual overlay review

Six review sheets were inspected: short/long × Swiss/Newspaper/Paper. Each sheet contains rows for generic, YouTube Shorts, Instagram Reels and TikTok, with red policy-occlusion areas and the active safe rectangle in green.

Manual verdict:

- platform variants do **not** collapse into a tiny center box;
- right-side UI reserve is visibly respected;
- Swiss long-copy CTA remains balanced after moving to safe-rect center;
- Paper retains its loose collage character after safe-width clamping;
- Newspaper remains structurally intact under the narrower profiles;
- 5s hook→book and 15s long-copy C24 timelines remain coherent.

## Architectural consequence

Platform UI belongs to the semantic delivery/layout contract, not to post-raster repair:

```text
CreativeSpec
  -> duration / pacing
  -> typography / art direction / motion
  -> DeliveryProfile
       -> aspect ratio
       -> platform_ui_profile + version
       -> semantic safe rect / occlusion policy
  -> scene layout
  -> renderer
```

`platform_ui_profile` and its version must be included in render provenance / RenderSpec identity because changing the policy can change the pixels even when the creative idea is unchanged.

## Decision

**Confirmed.** Organic 9:16 output should use a versioned platform UI profile before semantic layout. Keep `generic` as a neutral control/fallback; use platform-specific profiles when the target surface is known.

Do not encode today's numeric rectangles as timeless platform facts. Revalidate against current app/editor/checker/device behavior and create a new profile version when the UI materially changes.

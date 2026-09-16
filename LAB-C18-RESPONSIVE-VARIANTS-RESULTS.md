# C18 — Responsive structural variants

Historical GitHub experiment alias: **E18** (`lab/e18-responsive-variants`, PR #29).

## Question

E17 proved semantic responsive layout for the standard hook/book/CTA path. C18 closes the remaining contract hole before campaign delivery packaging: do **all four structural variants** (`hook-first`, `cover-first`, `title-first`, `hook-title`) work across `vertical`, `square`, and `landscape`, including the custom title plate used by `title-first` / `hook-title`?

## Canonical run

GitHub Actions run: `35127861148`.

Matrix:

- 3 representative routed-primary books / visual systems:
  - Paper — `river-station`
  - Swiss — `city-seven`
  - Newspaper — `long-title`
- 4 structural variants
- 3 delivery profiles
- **36 full 12-second videos**

Canonical batch result:

- outputs: **36/36**
- layout warning groups: **0**
- batch wall time: **167.388 s**
- aggregate sequential throughput: **774.25 videos/hour**
- peak Node + FFmpeg RSS: **756.5 MiB**

Approximate per-profile mean render time / sequential rate on this runner:

| profile | resolution | mean/video | derived sequential rate |
|---|---:|---:|---:|
| vertical | 1080×1920 | 5.420 s | 664.25/h |
| square | 1080×1080 | 3.392 s | 1061.24/h |
| landscape | 1920×1080 | 5.075 s | 709.42/h |

These rates are runner-specific and are not a new renderer benchmark. C18 is a semantic coverage / QA experiment.

## Useful failure before the canonical run

Run `35124579056` rendered all 36 MP4s successfully with zero layout warnings, then failed validation with:

`river-station: missing vertical/hook-first`

The renderer had received `variant` from the manifest, but `node-canvas-profile-batch.mjs` did not preserve that semantic field in `batch.json`. The validator and review generator therefore looked for metadata that the report had dropped.

We fixed the **report contract**, not the validator with filename parsing: profile batch results now preserve `variant`. The E18/C18 workflow also explicitly watches the shared profile-batch reporter so future report-contract changes trigger CI.

This failure is important for the factory contract: semantic identity fields must survive every handoff and report layer; a valid pixel output is not enough if provenance is lossy.

## Manual review

Review sheets cover the representative Paper / Swiss / Newspaper creatives across all profiles and variants.

- `title-first` uses a native square / landscape title composition rather than vertical coordinates scaled into another aspect ratio.
- `hook-title` shares the opening hook with `hook-first` by design; its later title plate uses the same responsive title implementation proven by `title-first`.
- `cover-first` and `title-first` remain visibly distinct from the hook opening.
- The long-title Newspaper stress fixture remains readable in square and landscape title compositions.
- No clipping / overflow regression was reported by the strengthened text-layout gate.

## Decision

Responsive layout coverage now includes the complete structural-variant vocabulary used by the bounded campaign package.

The product identity model remains:

```text
creative_id
  = semantic advertising idea
    (book + visual system + structural variant + motion/seed/assets semantics)

 delivery_profile
  = vertical | square | landscape

 render_spec_id
  = creative_id + delivery_profile + renderer/encoder configuration

 output_sha256
  = exact produced artifact bytes
```

C18 does **not** choose the production FAST encoder. It only proves that Creative/Product can hand a complete semantic creative to the runtime in any supported delivery profile without hidden vertical-only structural semantics.

## Next

1. Mark C18 done in Video Factory HQ.
2. Freeze the small shared `CreativeSpec / DeliveryProfile / RenderSpec / Artifact` v1 contract (I01).
3. Build C19: expand only the bounded selected campaign creatives into requested delivery profiles, preserving parent `creative_id` and QA/provenance.
4. Renderer/Runtime proceeds independently with R28 WebCodecs productionization.
5. Only after C19 + R28, run I02 apples-to-apples FAST backend comparison on one identical production workload.

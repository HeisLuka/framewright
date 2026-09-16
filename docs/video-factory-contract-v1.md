# Video Factory Contract v1

This document freezes the smallest shared machine contract between the Creative/Product (`C`) and Renderer/Runtime (`R`) tracks.

It is deliberately not a platform-wide schema. It only defines the boundary needed by the current factory:

```text
Book / BookPayload
  -> CreativeSpec
  -> DeliveryProfile
  -> RenderSpec
  -> Renderer/Runtime
  -> Artifact + QA/provenance
```

Schema: `contracts/video-factory-v1.schema.json`.
Identity helper: `contracts/factory-identity-v1.mjs`.
Example: `contracts/examples/video-factory-v1.example.json`.

## 1. Ownership boundary

Creative/Product owns semantic advertising decisions:

- book identity and normalized payload semantics;
- visual system;
- structural variant;
- verified hook text/source;
- motion profile;
- art direction / palette semantics;
- seed;
- semantic assets such as cover and pinned fonts;
- template identity.

Renderer/Runtime does **not** re-route or reinterpret these fields. It receives the semantic creative and a DeliveryProfile, produces the requested Canvas scene, then performs the selected runtime / encoder / mux path.

Renderer/Runtime owns execution policy:

- FAST vs SPECIAL runtime class;
- renderer implementation/version;
- pinned render environment identity;
- encoder and mux settings;
- post pipeline for SPECIAL;
- retry/cache execution mechanics;
- artifact validation and metrics.

## 2. CreativeSpec

`CreativeSpec` is the semantic ad idea before output format and backend choice.

`creative_id` is a canonical SHA-256 identity over the CreativeSpec with the `creative_id` field omitted and asset locations stripped. Asset **content hashes** remain part of identity; storage paths do not.

Prefix: `nvc1_`.

The v1 contract explicitly reserves first-class semantic fields for the current high-value C-track work:

- `art_direction`: template-default or cover-derived palette/art-direction algorithm and resulting palette;
- `hook`: verified/payload-derived text plus provenance;
- `motion`: versioned motion profile and optional deterministic beat-map hash.

This lets C20/C21/C22 improve the creative without teaching the runtime business logic.

### Asset rule

A cover moving from one S3 key to another must not create a new creative if bytes are identical. Therefore identity uses `role + sha256 + media_type`, not `uri`.

## 3. DeliveryProfile

Aspect ratio is semantic delivery layout, not post-render crop.

A DeliveryProfile carries:

- stable profile id/version through the `id` string;
- width / height;
- fps;
- duration;
- optional platform safe-area profile.

The same `creative_id` can be rendered into several DeliveryProfiles. Delivery profile is not part of `creative_id`; it is part of `render_spec_id`.

## 4. RenderSpec

`RenderSpec` is the exact executable render intention.

It links one `creative_id` to:

- one DeliveryProfile;
- one scene contract version;
- one immutable/pinned runtime environment id;
- one renderer/version;
- one encoder policy;
- optional muxer and SPECIAL post pipeline;
- non-creative output assets such as soundtrack by content hash.

`render_spec_id` is the canonical SHA-256 identity over the RenderSpec with `render_spec_id` and `artifact_policy` omitted and asset locations stripped.

Prefix: `nvr1_`.

`artifact_policy` is intentionally excluded from identity because choosing cache reuse vs force-render does not change the requested output semantics.

### Important consequence

Two backends that render the same `creative_id + delivery` have different `render_spec_id` when renderer/environment/encoder settings differ. That is intentional. I02 can compare them apples-to-apples because they share the same CreativeSpec and DeliveryProfile while remaining separate executable specs.

## 5. Artifact and determinism

The artifact contract follows the R28 / WebCodecs finding: deterministic semantic frames do **not** imply byte-identical lossy H.264 on every re-encode.

Therefore:

- `render_spec_id` identifies the requested deterministic render semantics + runtime policy;
- `output.sha256` identifies one exact produced MP4;
- a completed canonical artifact is stored by `render_spec_id`;
- a repeated request should normally reuse that stored artifact rather than re-encode merely to reproduce the same SHA.

Storage URI is operational metadata and is not part of render identity.

## 6. QA belongs to the artifact

A file existing is not sufficient for factory success. Artifact QA carries explicit checks such as:

- layout overflow/warnings;
- exact dimensions;
- decoded frame count;
- audio stream presence/sync when required;
- later: safe-area, contrast/readability, corruption and policy checks.

A failed QA artifact may remain as evidence, but must not become the canonical publishable artifact for the RenderSpec.

## 7. What is intentionally not in v1

- campaign ranking or CTR/CPA prediction;
- provider queue implementation;
- object-storage vendor details;
- retry taxonomy internals;
- worker concurrency;
- cloud price fields;
- publication platform credentials;
- AI generation fields.

Those are either upstream/downstream concerns or execution metadata, not part of the shared C↔R semantic boundary.

## 8. Relation to existing evidence

This contract reconciles two already-proven lines of work instead of inventing a new model:

- E15 established semantic `creative_id`, content-addressed assets and a distinction between semantic creative identity, render identity and exact MP4 SHA.
- C18 proved the same semantic creative can be reflowed into vertical/square/landscape without changing the creative idea.
- R28 established a production-shaped WebCodecs path with `render_id` keyed canonical artifact reuse and confirmed that final H.264 bytes should not be treated as deterministic identity.

The new v1 names make that boundary explicit for both FAST candidates and future SPECIAL paths.

## 9. Near-term workflow

Parallel work is now safe:

```text
C20/C21/C22
  improve CreativeSpec semantics
       |
       v
I01 contract v1  <----  R28 production FAST path already exists
       |
       v
C19 campaign delivery package
       |
       +----> R backend A
       +----> R backend B
                 |
                 v
          I02 apples-to-apples
```

Once a creative experiment changes a semantic field, it creates a new `creative_id`. Changing only delivery profile or runtime backend leaves `creative_id` stable but creates a different `render_spec_id`.

# C22 — Motion quality v2: finite choreography

## Question

Can the STANDARD creative layer feel more deliberately directed without adding heavy post effects, continuous decorative wobble, or meaningful render cost?

C22 Phase A compares the canonical E12 `active` motion mode against a new `choreography-v2` mode while keeping the rest of the creative fixed:

- same book payload and verified copy;
- same routed visual system;
- same seed;
- same hook-first structure;
- same `hook-led` opening grammar;
- same C20 cover-adaptive art direction;
- same vertical delivery profile;
- same renderer/encoder profile.

Only `motion_density` changes.

Beat/onset synchronization is intentionally excluded from this phase so its contribution can be measured independently later.

## Motion model

E12 `active` proved that element-level motion is cheap, but much of its energy comes from continuous ambient drift, wobble and looping rails.

C22 v2 replaces that with finite semantic events:

```text
entrance
  -> settle
  -> one focal emphasis
  -> settle
```

The implementation keeps system-specific character:

- Swiss: finite rail/cover entrance plus one focus mark;
- Newspaper: finite editorial rule movement plus one focus rule;
- Paper: finite tactile entrance plus one focal print accent;
- CTA: separate bounded emphasis event.

Text/labels/covers use staged eased entrances and then stop moving. No continuous loop is supposed to survive into planned settle windows.

## Canonical run

GitHub Actions run: `35137597265` — SUCCESS.

Artifact: `10463293720` (`c22-motion-quality`).

Artifact digest: `37870a83e395d64dfc025476c958239353aac681186e1c0fdff0d72df6b3b058`.

Workload:

- 10 routed-primary books;
- Newspaper / Paper / Swiss represented;
- strict E12-active vs C22-v2 pair per book;
- **20 full 12-second videos**.

## Temporal audit

The audit samples the exact same creatives at 10 fps / 54×96 grayscale and measures frame-difference energy inside pre-registered semantic windows.

C22 / E12 ratios:

| metric | ratio |
|---|---:|
| settle energy | **0.012684** |
| settle active fraction | **0** |
| hook entrance | **1.173535** |
| CTA entrance | **1.150996** |
| hook focus | **2.166667** |
| book focus | **26.095213** |
| CTA focus | **1.456710** |
| focus-to-settle contrast gain | **237.514506** |

The result is not merely “less motion.” Idle motion collapses almost completely during deliberate settle windows, while entrance and focal-event energy stays equal or becomes stronger.

The very large book-focus ratio mostly reflects that E12 had little deliberately localized motion in that exact focus window; it should not be read as a perceptual quality score.

## Full-render QA and cost

- outputs: **20/20**
- layout warning groups: **0**
- aggregate sequential throughput on this runner: **808.21 videos/hour**
- peak Node + FFmpeg RSS: **733.6 MiB**

C22 / E12 end-to-end wall ratio:

| metric | ratio |
|---|---:|
| mean | **1.0084** |
| p50 | **0.9959** |
| p95 | **1.0511** |
| max | **1.0529** |

So choreography v2 costs about **+0.8% mean wall time** on this run, with p95 about **+5.1%**.

MP4 byte ratio:

| metric | ratio |
|---|---:|
| mean | **0.9923** |
| p50 | **0.9490** |
| p95 | **1.0496** |
| max | **1.0641** |

The more deliberate motion does not increase average encoded size; in this sample it is slightly smaller on average because continuous ambient motion has been removed.

These numbers are runner diagnostics, not cloud-provider cost measurements.

## Manual review

All ten paired review sheets were inspected at twelve moments spanning hook entrance/focus/settle, book entrance/focus/settle and CTA entrance/focus/settle.

The sheets confirm the intended change across all three visual systems:

- entrances still visibly develop rather than appearing as static first frames;
- after entrance, v2 holds are materially calmer than E12 instead of continuously drifting;
- cover/book focus remains visible as a deliberate event rather than background wobble;
- CTA still receives a distinct emphasis and remains readable;
- Swiss retains its hard-grid rhythm, Newspaper retains editorial restraint, and Paper retains tactile character;
- no reviewed sample looked like a broken/dead scene, and no layout/readability regression was observed.

The diagnostic audit and manual review therefore agree: motion energy has been **redistributed**, not simply deleted.

## Decision

**C22 Phase A passes.**

For STANDARD creatives, motion quality should be modeled as semantic choreography rather than continuous activity:

```text
meaningful event
  -> readable settle
  -> focal event
  -> readable settle
```

This is effectively free in the current renderer and slightly improves compression behavior relative to continuous E12 activity.

C22 does **not** prove advertising lift. “Feels more directed” is a manual creative-quality judgment backed by temporal diagnostics; CTR/CPA requires campaign data.

## Next

If music synchronization is pursued, make it a separate controlled experiment rather than silently adding it to choreography-v2:

- deterministic beat/onset extraction from a fixed track;
- compare free-timed choreography vs beat-aligned choreography;
- keep scene/layout/copy/art direction identical;
- measure alignment, readability, wall/bytes and manual perceived-quality review;
- only promote beat sync if it adds value beyond the already-passing finite choreography.

# C24 — Adaptive organic duration + pacing

## Product correction

The fixed 12-second duration used by earlier lab work was a benchmark control, not a product requirement. These outputs are intended to be posted as organic short-form videos, so C24 tests a bounded duration policy instead of forcing every creative to 12 seconds.

C24 does **not** claim an optimal platform duration or a universal human reading speed. It tests whether a deterministic, explainable policy can choose a shorter or longer timeline from the semantic copy load while preserving a coherent creative grammar.

## Canonical run

- GitHub Actions: `35144806802`
- Head SHA: `ea76a452177d311eeb1e87a93728a13c3c12fe48`
- Matrix: 3 visual systems × 6 copy profiles × `baseline12 / adaptive` = **36 videos**
- Result: **36/36 rendered; 0 layout warnings; 0 audit errors**
- Artifact: `c24-organic-duration`

## Duration policy v1

Allowed profiles:

```text
3 / 5 / 7 / 9 / 12 / 15 seconds
```

The selected profile is a deterministic design policy over title/hook/author/CTA text load. Selection reasons and the resulting plate frame budgets are written into `P.pacing` / render metadata.

Creative grammar changes intentionally at the shortest profiles:

- `3s` → hook-only teaser
- `5s` → hook + book
- `>=7s` → hook + book + CTA

This is important: short organic clips are not compressed 12-second ads. They are different semantic structures.

## Exact canonical allocations

| Copy fixture | Selected duration | Hook | Book | CTA | Load score |
| --- | ---: | ---: | ---: | ---: | ---: |
| micro EN | 3s | 90f | 0f | 0f | 35.40 |
| short EN | 5s | 74f | 76f | 0f | 94.90 |
| medium EN | 7s | 81f | 90f | 39f | 128.65 |
| medium RU | 9s | 105f | 106f | 59f | 137.60 |
| long RU | 12s | 126f | 155f | 79f | 270.80 |
| long EN | 15s | 150f | 197f | 103f | 288.00 |

The same text profile selected the same duration and frame allocation across Swiss / Newspaper / Paper. A second fresh boot reproduced the same plan for every adaptive fixture.

Duration distribution in the audit was exactly three renders in each of the six buckets.

## Runtime impact

Adaptive duration itself has no meaningful per-second renderer penalty:

- mean adaptive duration: **8.5s**
- p50 adaptive duration: **7s**
- normalized render-ms-per-second ratio vs fixed 12s: mean **1.0151×**, p95 **1.0916×**
- total wall ratio vs fixed 12s: mean **0.7319×**
- peak combined Node + FFmpeg RSS: **784,388,096 bytes** (~748 MiB)

The p95 total-wall ratio is >1 only because the 15-second profile intentionally contains 25% more frames than the 12-second control.

Bytes per second are somewhat noisier than the fixed-duration control (mean `1.0676×`, p95 `1.3506×`), but there is no structural file-size failure and this experiment was not a bitrate-policy test.

## Manual review

Normalized timeline sheets and explicit first/last-frame loop sheets were reviewed, with special attention to the risky boundary cases.

### 3 seconds

The hook-only teaser reads as a distinct organic grammar rather than a truncated full ad. Newspaper and Paper maintain a stable hook through the ending. Swiss fades toward a sparse neutral state near the tail and starts from a similarly sparse state, producing a soft loop rather than a hard semantic cut. The usable hook remains visible through the middle of the clip.

Verdict: acceptable as a teaser profile. Do not promise book-title exposure or CTA in this grammar.

### 5 seconds

All three systems coherently execute `hook -> book` with no CTA. The transition does not feel like an arbitrary truncation, and the cover/title plate receives enough dwell to register.

Verdict: strong short organic profile.

### 15 seconds

The long-English stress case uses the extra duration for genuinely heavier hook/title/book/CTA copy rather than an empty hold. Swiss, Newspaper and Paper retain rhythm and readable hierarchy through the longer timeline.

Verdict: valid upper profile for copy that actually needs it; not a default.

## Architectural consequence

Duration belongs to the semantic creative/render specification, not to the renderer as a global constant.

```text
BookPayload
  -> CreativeSpec
       -> duration_policy / duration_profile
       -> semantic grammar
       -> pacing plan
  -> DeliveryProfile
  -> RenderSpec
  -> renderer
```

The renderer should receive an explicit total duration / frame count from the semantic layer. Runtime must not independently decide how long a creative should be.

## Decision

**Confirmed.** Replace the implicit `12s` product assumption with a bounded organic-duration policy. Keep `12s` as a useful benchmark/control profile, not as the universal output duration.

Next quality work should build on this contract rather than reintroducing a fixed timeline. Strong candidates: typography as a first-class creative axis, platform UI safe zones, catalog-fatigue scoring, and beat/onset alignment as a separate controlled experiment.

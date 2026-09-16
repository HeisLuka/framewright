# E02 — production-like book ad template v0

## Question

Can Framewright's deterministic scene model become a mass book-ad renderer when the authoring-time idea of “one HTML per video” is replaced with `Template + BookAdPayload`, and what does that cheap workload actually cost before any renderer rewrite?

## Product constraints

- no AI in the render path;
- one versioned template renders many books;
- local/versioned image assets are allowed and expected;
- first production format is vertical `9:16`;
- output must tolerate Cyrillic and Latin copy, long titles/authors and ordinary 2:3-ish book covers;
- deterministic `payload + template + seed + renderer version + output profile`;
- no full-frame JavaScript pixel loop in this cheap baseline.

## Workload

`examples/book-ad-v0/index.html`

- 12 seconds;
- 30 fps;
- 360 frames;
- logical canvas 1080×1920;
- plates: `hook:90`, `book:150`, `cta:120`;
- platform-safe content zone leaves roughly 15% top and 20% bottom free for vertical-app UI;
- editorial / Swiss-inspired composition: typography, geometry, cover art, deterministic decorative marks;
- `post()` is deliberately trivial (`drawImage`) so the benchmark mostly measures composition + PNG/transport/encode rather than a synthetic expensive effect.

## BookAdPayload v0

Schema: `examples/book-ad-v0/payload.schema.json`

Required product data:

- `book_id`
- `title`
- `author`
- `hook`
- `cta`
- `cover_url`

Optional visual/text controls:

- `eyebrow`
- `brand`
- `accent`
- `background`
- `ink`

The renderer injects JSON as `window.FRAMEWRIGHT_PAYLOAD` before any template script executes. The template contains a fallback demo payload only for direct browser preview.

This is intentionally different from upstream Framewright: production does **not** rewrite `index.html` for each book.

## Asset contract

The cover is a normal image input. E02 includes `cover-demo.svg` only as a repository fixture. PNG/JPEG/WebP/SVG are expected to be ordinary cached/versioned assets in a production worker.

No photo → polygons conversion is required for the normal book-ad path.

## Render command

```bash
HTML=examples/book-ad-v0/index.html \
PAYLOAD=examples/book-ad-v0/payload.example.json \
node .agents/skills/framewright/scripts/render-payload.mjs frames 7 1080 5
```

Then encode with the existing baseline build path:

```bash
bash .agents/skills/framewright/scripts/build.sh book-ad-v0.mp4 frames
```

## Profile command

```bash
HTML=examples/book-ad-v0/index.html \
PAYLOAD=examples/book-ad-v0/payload.example.json \
PROFILE_OUT=e02-profile.json \
node .agents/skills/framewright/scripts/profile-render.mjs frames 7 1080 5
```

The E01 profiler records the payload file and its SHA-256 in the report.

## CI benchmark matrix

GitHub Actions workflow: `.github/workflows/lab-e02-book-ad.yml`

Stage profiles:

| output | tabs |
|---|---:|
| 720×1280 | 1 |
| 720×1280 | 5 |
| 1080×1920 | 1 |
| 1080×1920 | 5 |

Canonical end-to-end run:

- 1080×1920;
- 5 tabs;
- all 360 frames;
- existing `build.sh` / libx264 baseline;
- MP4 + ffprobe metadata + render profile + contact sheet are uploaded as the Actions artifact `e02-book-ad-v0`.

## Stress fixtures

- `payload.example.json` — ordinary Cyrillic example.
- `payload.long.json` — deliberately long Cyrillic title/author/hook.
- `payload.latin.json` — Latin-script copy and a different palette.

The CI workflow performs a full low-resolution long-copy smoke render and creates a contact sheet.

## Acceptance criteria

E02 is successful when:

1. the same template renders at least the sample and stress payloads without source changes;
2. local cover assets load through the deterministic worker path;
3. no scene requires a per-pixel JavaScript post pass;
4. the canonical render produces a valid H.264 MP4 with the expected frame count/duration;
5. stage timings clearly separate scene composition from PNG/CDP/base64/disk overhead;
6. 1-tab vs 5-tab results tell us whether browser parallelism still buys useful throughput on a cheap visual system;
7. contact sheets show no obvious title/author/CTA overflow for the fixture set.

## Decision after results

Do not optimize E02 by instinct. Use the measurements to choose the next experiment:

- if `sceneEngineMs` is small and PNG/CDP dominates → E03 should remove the PNG/base64 transport path;
- if scene composition is unexpectedly expensive → profile text/image drawing before changing transport;
- if 5 tabs barely improve throughput → investigate page/process contention and memory before increasing concurrency;
- if encode dominates end-to-end wall time → move encoder preset/hardware encode matrix earlier;
- if long-copy contact sheets fail → fix the template/layout contract before performance work.

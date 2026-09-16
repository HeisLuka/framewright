# Newboo -> Framewright book ad

This is the first end-to-end deterministic integration for `video-engine-v0`.

The boundary is intentionally small:

```text
Newboo BookResponse / BookRepositoryRow
        |
        v
newbooBookToRenderPayload()
        |
        v
BookRenderPayload + stable cover identity
        |
        v
createBookAdV0Job()
        |
        v
book-ad-v0 browser template
        |
        v
Framewright look/render/build
```

No model generates copy or creative decisions. The default text rules only reuse fields already present on the book:

- hook: explicit override -> subtitle -> first sentence of description -> title
- quote/body: explicit excerpt -> description -> release note -> subtitle -> title
- genre: explicit override -> first genre -> catalog section -> first tag -> `BOOK`
- CTA: explicit override -> `READ NOW`

For real campaigns the explicit fields can come from a human-authored campaign/variant record without changing the renderer.

## One-command paths

With a local Newboo backend:

```bash
NEWBOO_API_BASE=http://127.0.0.1:8000/api/v1 \
NEWBOO_COOKIE='session cookie value' \
npm run book-ad -- sheet \
  --book-id '<book-id>' \
  --out shots/book-sheet.png
```

Render an MP4:

```bash
NEWBOO_API_BASE=http://127.0.0.1:8000/api/v1 \
NEWBOO_COOKIE='session cookie value' \
npm run book-ad -- video \
  --book-id '<book-id>' \
  --width 1080 \
  --tabs 5 \
  --out out/book-ad.mp4
```

The same path can be exercised without a running Newboo service:

```bash
npm run book-ad -- sheet \
  --book-json ./book.json \
  --out shots/book-sheet.png
```

`book.json` may contain a public `BookResponse`, a full repository-style book row, or an admin moderation response shaped as `{ "book": { ... } }`.

## Cover identity vs transport

Newboo has two useful cover representations and they must not be conflated.

A repository row can include `cover_id`. That gives Framewright a stable source identity:

```text
raw/books/{book_id}/covers/{cover_id}/source
```

When that identity is available, `src/book-render.mjs` puts it into the immutable render payload. The CLI can fetch it from Yandex Object Storage using environment credentials and stage it to a local file before Chromium renders frame 0.

Supported environment names:

```text
S3_BUCKET_NAME
S3_ENDPOINT              default https://storage.yandexcloud.net
S3_REGION                default ru-central1
AWS_ACCESS_KEY_ID         or YC_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY     or YC_SECRET_ACCESS_KEY
AWS_SESSION_TOKEN         optional
```

The public Newboo `BookResponse` currently exposes `cover_url` but not `cover_id`. In that case Framewright does not invent a fake cover identity. The CLI downloads the public URL into the local asset cache and uses that staged file as render transport.

Order used by the CLI:

```text
--cover-file
    -> --cover-url
    -> S3 source from cover_id
    -> Newboo public cover_url
    -> procedural development fallback
```

Use `--strict-assets` when a missing cover should fail the job rather than use the fallback.

The browser template never receives S3 credentials. It only receives the immutable render job plus a local/resolved `coverUrl`.

## Render job

`src/book-render.mjs` defines the v1 job boundary:

```js
{
  kind: "book-render-job",
  version: 1,
  template: "book-ad-v0",
  payload: { /* book-render-payload */ },
  plan: { /* compiled deterministic render plan */ }
}
```

The job is transported to the browser as base64url JSON. This is deliberately simple for v0: the payload is small, reproducible, inspectable and does not require a service boundary yet.

Use `--job-out <path>` to persist the JSON used for a render.

## Useful commands

```bash
npm run book-ad -- info  --book-json ./book.json
npm run book-ad -- sheet --book-json ./book.json --cells 16 --cell-width 270
npm run book-ad -- shot  --book-json ./book.json --frames 0,90,240,360,449
npm run book-ad -- render --book-json ./book.json --width 1080 --tabs 5
npm run book-ad -- video  --book-json ./book.json --width 1080 --out out.mp4
```

Human-authored copy overrides are ordinary deterministic inputs:

```bash
npm run book-ad -- sheet \
  --book-json ./book.json \
  --hook '...' \
  --quote '...' \
  --genre '...' \
  --cta '...'
```

## What this does not solve yet

This vertical slice still uses Framewright's existing PNG frame transport and `build.sh`. It deliberately does not mix the Newboo integration with the renderer-performance work. The next rendering milestone remains replacing the PNG/base64/disk production path with a measured raw-frame/encoder path while preserving this same `BookRenderPayload -> RenderPlan` contract.

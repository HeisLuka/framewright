# I09 — Local JSON operator console

## Goal

Turn the existing bounded creative + deterministic renderer stack into a local operator product:

`paste CreativeProposal JSON -> validate -> compile -> enqueue -> render -> QA-passing MP4`

The UI is intentionally thin. It does not introduce a new renderer, queue, creative grammar, or trust model.

## Trust boundary

The pasted JSON is the semantic body of `newboo-creative-proposal-v1`. `proposal_id` may be omitted (or set to `"auto"`); the local console computes the canonical ID before the existing C32 validator runs.

It may select IDs and bounded presentation values already exposed by a trusted `ContextPack`. It may not carry raw copy, prompt text, HTML, JavaScript, shell commands, file paths, template identities, encoder settings, or URLs. Existing C31/C32 validation remains the authority.

Trusted local state lives outside the pasted JSON:

- `.local-video-console/context-packs/*.json` — backend/exported `ContextPack v1` snapshots;
- `.local-video-console/assets/<sha256>.<ext>` — content-addressed cover assets (`png`, `jpg`, `webp`);
- `.local-video-console/runtime/index-c27.html` — automatically built current C20–C27 renderer template;
- `.local-video-console/queue/` — existing I07 resumable queue;
- `.local-video-console/jobs/` — exact proposal, accepted program, payload and C19 request receipts.

A `ContextPack` is matched by `context_pack_id` and its existing `context_hash` is validated before any proposal is accepted. An asset is resolved by the SHA declared in the trusted ContextPack and re-hashed before use.

## Runtime path

```text
trusted ContextPack + pasted CreativeProposal
            |
            v
C31/C32 fail-closed validation
            |
            v
accepted program / C27 NarrativePlan
            |
            v
I09 trusted physical binding
(template + content-addressed cover + payload)
            |
            v
canonical C19 campaign request
            |
            v
I07 resumable local queue/worker
            |
            v
I03/FAST Chromium + WebCodecs renderer
            |
            v
MP4 + render receipt + canonical artifact manifest
```

I09 copies the current C27 template and selected cover into a per-program binding sandbox. The Chromium renderer therefore serves only files inside that prepared binding directory rather than exposing arbitrary laptop paths.

## Start

From the repository root:

```bash
npm run local:console
```

Open `http://127.0.0.1:4317`.

Optional paths:

```bash
node .agents/skills/framewright/scripts/local-video-console.mjs \
  --port 4317 \
  --state .local-video-console \
  --contexts .local-video-console/context-packs \
  --assets .local-video-console/assets
```

The server binds only to `127.0.0.1`.

## Install trusted inputs

A future Newboo exporter should write ContextPacks and asset blobs directly into the local state directory. Until that exporter exists, files can be copied there manually.

For each ContextPack cover asset:

```text
ContextPack asset sha256 = abc...123
media_type = image/webp
-> .local-video-console/assets/abc...123.webp
```

The filename is not trusted by itself: I09 hashes the bytes before rendering.

## Operator flow

1. Paste a `CreativeProposal v1` JSON.
2. **Validate** checks ContextPack identity, allowlisted atoms/assets/capabilities, spoiler/body budgets, asset SHA, and runtime template availability.
3. **Render MP4** materializes a deterministic C19 request and enqueues it into I07.
4. The page polls the local queue and shows the final MP4 path, output SHA and QA status.
5. The exact raw pasted JSON is retained in the job directory for audit.

## Deliberate v1 omissions

- no Electron/Tauri packaging yet;
- no free-text or `external-creative-draft-v1` mode;
- no publication/upload workflow;
- no server render plane;
- no arbitrary filesystem browser;
- no editing of runtime/encoder/template values from the JSON field.

Desktop packaging should wrap this same localhost API after the end-to-end operator flow is proven. It must not create a second execution path.

## Verification

`npm run check:i09` covers the trust boundary, canonical C19 request binding and I07 queue semantics without invoking Chromium. `npm run check:i09:render` is the full smoke: it generates a trusted fixture cover, compiles a bounded proposal, runs the existing local worker and FAST Chromium/WebCodecs renderer, and requires a QA-passing MP4.

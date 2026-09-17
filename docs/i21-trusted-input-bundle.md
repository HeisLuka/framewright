# I21 — Trusted input bundle installer

## Decision

I09 already has the correct local trust boundary:

```text
untrusted proposal JSON
        |
        v
C35 / I18 creative ingress
        |
        +------------------------------+
                                       |
trusted ContextPack store              |
trusted content-addressed asset store  |
        |                              |
        +------------> render <---------+
```

The missing integration is not another creative schema and not another renderer. It is a deterministic transport/install boundary that can move authoritative Newboo state into the two trusted stores I09 already consumes.

I21 defines that consumer-side boundary as `newboo-video-trusted-input-bundle-v1`.

## Bundle layout

A transport directory contains:

```text
bundle.json
assets/
  <sha256>.<derived-extension>
  ...
```

`bundle.json` contains only:

- the exact validated `ContextPack v1`;
- an exact descriptor for every asset declared by that ContextPack;
- byte length and SHA-256 for every asset blob;
- the fixed `sha256-filename-v1` layout;
- a content-derived `bundle_id`.

There is no proposal, prompt, delivery-profile choice, renderer configuration, arbitrary destination path, URL, shell command, or executable content in the transport contract.

This keeps I18 ownership intact: creative identity is delivery-independent. The ContextPack may expose server-owned delivery capabilities, but the trusted-input bundle does not choose a delivery profile.

## Bundle identity

`bundle_id = nbtib1_<sha256>` over canonical JSON containing:

- schema and asset-layout version;
- `context_pack_id`, `context_hash`, and ContextPack revision;
- the sorted asset descriptor set (`asset_id`, `book_id`, role, SHA-256, media type, byte length).

The ContextPack's existing `context_hash` already binds all server-owned facts, creative atoms, capabilities, constraints, CTA registry, account scope, book scope, and asset declarations.

Asset bytes are independently bound by their declared SHA-256.

## Consumer validation

The installer is fail-closed and revalidates trust on the receiving machine. It does not assume that a file is safe merely because it came from Newboo.

Before touching local trusted state it verifies:

1. exact bundle schema/fields and content-derived bundle identity;
2. the embedded ContextPack with the existing C32 validator;
3. one bundle descriptor for every ContextPack asset, with exact book scope, role, hash and media type;
4. supported deterministic filename mapping from media type;
5. every source asset is a regular non-symlink file;
6. exact byte length and SHA-256 for every source blob.

Only after the complete bundle passes does installation begin.

## Install transaction

The default target is the existing I09 state root `.local-video-console`:

```text
.local-video-console/
  context-packs/
  assets/
  trusted-input-receipts/
```

The install order is deliberate:

1. acquire one local installer lock;
2. verify any existing ContextPack with the same `context_pack_id`;
3. reject revision rollback and same-revision/different-hash conflict;
4. add or verify all content-addressed assets;
5. atomically write/replace the ContextPack **last**;
6. write a content-addressed install receipt.

Because asset installation is additive and the ContextPack switches last, a reader sees either the previous complete trusted state or the new complete trusted state. A failed asset verification cannot publish a ContextPack that refers to missing/tampered bytes.

A second install of the same bundle is idempotent: the ContextPack and already-correct assets are reused.

If one existing manually installed ContextPack has the same ID, I21 updates that exact file path atomically. If multiple files already claim the same `context_pack_id`, installation fails instead of guessing which one is authoritative; I09 would consider that state ambiguous too.

## CLI

```bash
node .agents/skills/framewright/scripts/install-trusted-input-bundle.mjs \
  --bundle /trusted/newboo-export/bundle.json
```

An alternate I09 state root can be supplied with `--state`.

The CLI emits a machine-readable receipt with bundle/context identity, revision, asset counts, context action (`installed`, `updated`, `reused`) and the installed context path.

After a successful install, the existing I09 `loadContextPackForProposal()` discovers the ContextPack without any console changes, and its existing per-render asset SHA check remains in force.

## What this closes — and what it does not

I21 closes the **video-factory consumer half** of the Newboo -> local trusted-input gap. Manual copying/renaming of ContextPack and asset files is no longer part of the contract: a producer only has to emit one versioned bundle directory.

It deliberately does **not** modify the Newboo production backend in this PR. The Newboo repository requires an active task with explicit `Allowed files` plus its Gortex impact/guard/contract workflow before backend changes. No active exporter task was available during this pass, so bypassing that boundary would be the wrong integration.

The remaining producer-side task is therefore narrow and explicit:

```text
Newboo authoritative read model
  -> ContextPack v1
  -> collect exact owned asset bytes
  -> emit newboo-video-trusted-input-bundle-v1
```

That exporter must not invent a second book/account truth model. It should adapt an existing Newboo application/read service and emit this frozen transport contract. Once that producer exists, transport can be local filesystem, authenticated download, object storage, or another controlled channel without changing I09/C35/I18/render semantics.

## Gate

`node contracts/check-i21-trusted-input-bundle.mjs` covers:

- first install into an empty I09 trusted store;
- direct compatibility with I09 ContextPack lookup;
- idempotent reinstall;
- monotonic revision update at the same context path;
- rollback rejection;
- same-revision/different-hash conflict rejection;
- bundle identity tamper;
- missing asset descriptor;
- asset size/hash tamper before context switch;
- source symlink rejection;
- corrupt already-installed content-addressed asset rejection;
- ambiguous pre-existing ContextPack rejection;
- install receipts for accepted bundles.

The existing C32 ContextPack/CreativeProposal gate also reruns in I21 CI.

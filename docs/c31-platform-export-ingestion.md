# C31 — explicit platform export ingestion

## Question

C30 defines an immutable campaign-evidence contract, but the repository still has no trustworthy bridge from a raw platform export into that contract.

C31 asks the narrower boundary question:

> Can an external export be transformed into canonical C30 observations without allowing raw column names, row order, manual IDs, or denominator ambiguity to rewrite campaign history?

This pass does **not** claim that real YouTube, Instagram, TikTok, or other platform data has been ingested. The repository currently contains no real platform export fixture. C31 builds and audits the ingestion machinery needed before live data can be admitted.

## Trust boundary

A raw export is untrusted input.

It may contain platform-native creative/video IDs, campaign names, manually edited columns, repeated rows, ratios without reconstructable counts, or fields whose semantics changed between export versions.

Therefore C31 does not let a source row provide canonical `creative_id` or `render_spec_id` directly.

Canonical identity comes only from a separate publication join manifest:

`platform + campaign_id + placement_id + source_creative_key -> creative_id + render_spec_id`

The export row supplies the left side. The publication manifest supplies the canonical right side. Missing or ambiguous joins are fatal.

## Adapter contract

Every accepted source format requires an explicit versioned adapter with:

- `platform`;
- `source_schema`;
- `adapter_id` and `adapter_version`;
- exact source fields for row identity, campaign, placement, source creative key, and observation window;
- for every admitted C30 metric: an explicit numerator field, denominator field, and `denominator_kind`.

C31 intentionally accepts integer count evidence only. A source that exposes only a rounded rate such as `42.7%` cannot be converted into fake numerator/denominator counts. That source needs a different evidence treatment or a richer export.

## Raw-byte provenance

The ingestion call receives the original export bytes and a declared SHA-256. The computed SHA must match before any row is accepted.

The output ingestion receipt preserves:

- platform/export identity;
- source schema;
- raw SHA-256;
- adapter identity/version;
- row count;
- deterministic observation IDs;
- resulting C30 `evidence_batch_id`.

Both observation IDs and the ingestion receipt are content-addressed. Reordering parsed rows while preserving the same raw export bytes produces the same canonical evidence.

## Failure policy

C31 rejects rather than guesses when it sees:

- raw-byte hash mismatch;
- duplicate source row keys;
- unknown publication binding;
- duplicate/ambiguous publication binding;
- missing adapter fields;
- missing denominator semantics;
- non-integer count evidence;
- numerator greater than denominator;
- invalid observation windows;
- platform/source-schema mismatch between export and adapter.

The source export is also not allowed to inject canonical identity through conveniently named `creative_id` or `render_spec_id` columns. Such columns are ignored; the publication manifest remains authoritative.

## Synthetic audit

The CI audit uses a tiny source-shaped CSV fixture represented as immutable raw bytes plus parsed rows. It proves only mechanics:

- raw export SHA binding;
- explicit adapter/schema/version binding;
- publication-manifest identity resolution;
- parsed-row order independence;
- acceptance by the canonical C30 evidence validator;
- explicit denominator semantics;
- rejection of seven deliberately bad ingestion cases.

The fixture is synthetic. Passing C31 therefore makes no claim about retention, completion, sharing, CTA behavior, downstream opens, or any platform-specific effectiveness.

## What remains before live learning

The next evidence step is external, not another synthetic benchmark: attach at least one actual platform export and the publication manifest that generated those placements, then write a source adapter from the observed export schema rather than from memory or documentation guesses.

Only after real rows survive this boundary should C30 posterior snapshots be treated as live campaign evidence. A selector experiment should then preserve explicit exploration and holdout traffic; C31 itself does not choose winners or alter rendering.

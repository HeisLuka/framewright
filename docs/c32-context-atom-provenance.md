# C32 — honest ContextPack atom provenance

## Problem

The first bounded external-LLM contract correctly prevents raw untrusted copy from entering C27, but its compile bridge reused C27's legacy `human_verified` copy-source kind for every trusted ContextPack atom.

That label is stronger than the ContextPack contract actually proves. A creative atom is server-scoped, content-addressed, tied to one or more source facts, and accepted by the deterministic C32 validator. It may be human-approved, machine-derived upstream, or produced by another future verification process. Calling all of those atoms `human_verified` would make the provenance record lie.

This follow-up fixes the representation without changing rendered semantics.

## C27 source kind: `context_atom`

C27 now accepts an additional literal copy source:

```json
{
  "kind": "context_atom",
  "text": "Every evening, a letter arrives from tomorrow.",
  "context_pack_id": "ctx_example_account_revision_1",
  "context_hash": "...sha256...",
  "atom_id": "atom_hook",
  "source_fact_ids": ["fact_premise"]
}
```

C27 validates that:

- `text` is present;
- `context_pack_id` is present;
- `context_hash` is lowercase SHA-256;
- `atom_id` is present;
- at least one non-empty `source_fact_id` is present.

C27 does not independently re-open the ContextPack or claim that those facts are true. That trust decision already belongs to the upstream ContextPack/CreativeProposal boundary. C27's responsibility is to preserve the exact provenance it was given while deterministically resolving display text.

Legacy `human_verified` remains valid for genuinely human-verified sources already used elsewhere.

## Canonical C32 compiler

`contracts/compile-creative-proposal-v1.mjs` is the canonical C32 compile entrypoint.

It deliberately reuses the already-tested v1 validator/compiler first. Then, for legacy bridge atoms whose verification ID points into the exact accepted ContextPack, it replaces only the provenance object with `context_atom` metadata from that pack.

The adapter refuses to convert if:

- the referenced atom no longer exists;
- compiled text differs from the ContextPack atom text;
- no ContextPack atom was present in an otherwise accepted proposal.

After conversion it recomputes `narrative_plan_id`, runs C27 `assertNarrativePlan()`, and recomputes `program_id`. Content IDs therefore record the provenance correction rather than pretending the old and new programs are identical.

## Non-regression gate

The C32 provenance audit compiles the same accepted proposal through both paths and requires exact equality of the render-relevant semantic projection:

- book and angle selection;
- every role name;
- every role start/end/frame count;
- every displayed atom text;
- duration/fps/reveal/CTA/seed;
- checkpoints;
- presentation;
- selected assets.

At the same time it requires:

- every selected ContextPack creative atom to emerge as `context_atom`;
- zero ContextPack atoms mislabeled `human_verified`;
- exact `context_pack_id`, `context_hash`, `atom_id`, and `source_fact_ids` lineage;
- deterministic replay of the corrected IDs;
- rejection of malformed `context_atom` sources;
- changed NarrativePlan and accepted-program IDs because provenance is part of identity.

This is a provenance correction, not a creative-policy change and not a new free-text mode.

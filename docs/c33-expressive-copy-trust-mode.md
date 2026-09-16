# C33 — expressive external-LLM copy with a separate publish trust boundary

## Why C33 exists

C32 solved the safe machine-contract problem by allowing an external LLM to compose only server-minted creative atoms. That is appropriate for a fully automatic publish path, but it is intentionally narrow: if the ContextPack contains one hook, one tension line, and one payoff, the LLM is mostly arranging already-written copy.

The larger product goal is different:

> Let a user-side LLM perform real creative writing, while keeping the renderer and execution path deterministic.

Those two requirements are compatible once two different questions stop being conflated:

1. **Can the program deterministically render this exact JSON?**
2. **Do we trust this newly written copy enough to publish automatically?**

C33 answers the first question with deterministic code and answers the second with a separate server-owned review artifact.

## Two trust modes

### C32: trusted-atom mode

C32 remains the conservative automatic path. The LLM selects server-owned atom IDs. The display text already exists inside the canonical ContextPack and retains `context_atom` provenance.

### C33: expressive-copy mode

C33 accepts literal hook/tension/payoff text from the external LLM. That text becomes part of a content-addressed accepted draft and then enters C27 as `external_llm_copy`.

The copy is **not** labeled `human_verified`, `context_atom`, or otherwise trusted by implication.

Every external copy source retains:

- exact display text;
- ContextPack ID and hash;
- accepted `draft_id`;
- semantic role;
- cited `supporting_fact_ids`;
- SHA-256 of the exact copy.

The renderer displays those exact bytes as text. It does not ask another model to reinterpret or repair them.

## LLM-facing JSON: ExternalCreativeDraft v1

Schema: `newboo-external-creative-draft-v1`.

The LLM may provide:

- account/book binding to the supplied ContextPack;
- a permitted C27 angle type;
- literal `hook`, optional `tension`, and optional `payoff` copy;
- supporting fact IDs for each copy block;
- reveal timing;
- CTA treatment plus a server-owned CTA ID when the treatment requires one;
- duration/fps/visual system/delivery profile/seed;
- server-owned asset IDs.

The LLM may **not** provide any approval or publish authority. Fields such as `approval`, `approved`, `approval_id`, `publish_allowed`, `review_status`, or `autopublish` are explicitly rejected even before ordinary unknown-field validation.

CTA text, book title/author, assets, capabilities, and the ContextPack itself remain server-owned.

## What deterministic validation proves

The validator can prove structural facts such as:

- the proposal binds to the exact server ContextPack revision;
- the selected book, assets, CTA, delivery profile, visual system, duration, and angle are allowed;
- every cited fact ID exists on the selected book;
- the C27 3s/5s/7s+ grammar remains feasible;
- copy is bounded plain display text rather than a URL, executable URI, control-character payload, or executable markup;
- the same accepted semantics produce the same content IDs;
- a copy change produces a different `draft_id`, copy manifest, NarrativePlan, and program identity.

The validator **does not** prove that an arbitrary sentence is entailed by the cited facts. A model can cite a real fact and still write a misleading paraphrase. `supporting_fact_ids` are therefore provenance and review context, not a truth certificate.

That is exactly why this mode is review-required.

## Accepted draft and render program

A valid LLM payload is converted server-side into `newboo-accepted-external-creative-draft-v1` with:

- `trust_mode = external_llm_review_required`;
- canonical normalized supporting-fact sets;
- `draft_id = nbd1_<sha256>`.

The accepted draft is revalidated if it ever re-enters the compiler. Merely recomputing a valid content hash does not bypass the original validation boundary.

Compilation produces `newboo-review-required-creative-program-v1` and a normal C27 NarrativePlan. The program carries `publication_class = review_required` and a deterministic copy-manifest hash. It is safe to preview-render before approval because rendering authority and publication authority are separate.

## Approval is not a content hash trick

Schema: `newboo-creative-approval-v1`.

An approval binds:

- exact `draft_id`;
- exact render `program_id`;
- exact copy-manifest SHA-256;
- decision (`approved` or `rejected`);
- review-policy version;
- issuer identity;
- `authority = server_owned`.

A content-addressed `approval_id` proves artifact identity, **not authentication**. A client could calculate SHA-256 too. Therefore the publish endpoint must never accept an approval JSON from the same untrusted request that supplied the creative draft.

`evaluatePublishEligibility()` accepts the parameter name `trusted_approval` deliberately: production code must load that object from a server-owned approval store or another authenticated trust source. If approvals ever cross an untrusted transport boundary as self-contained artifacts, they need a server signature/MAC or equivalent authentication; a plain SHA-256 is not enough.

## Publish behavior

Without a trusted approval:

```text
preview_render_allowed = true
publish_allowed = false
reason = review_required
```

With a matching server-owned approval:

```text
preview_render_allowed = true
publish_allowed = true
reason = approved
```

A rejected, stale, mismatched, malformed, or client-supplied approval cannot publish.

Approval never changes the creative program or render identity. If one character of copy changes, the draft/program/copy-manifest identities change and the old approval becomes stale automatically.

## Why this is still deterministic

The LLM is nondeterministic while *authoring the JSON*. That does not make the factory nondeterministic.

Once one JSON payload is accepted:

```text
ExternalCreativeDraft
  -> deterministic validation
  -> content-addressed accepted draft
  -> deterministic C27 NarrativePlan
  -> deterministic downstream compiler / RenderSpec
  -> preview artifact
```

The model may produce a different proposal next time. That is creative variation, not execution nondeterminism. Each accepted proposal has its own immutable identity.

## C33 test gate

`node contracts/check-external-creative-draft-v1.mjs` covers:

- valid free copy -> accepted draft -> real C27 NarrativePlan;
- exact external copy provenance for hook/tension/payoff;
- object-key order invariance;
- supporting-fact set-order normalization;
- one-character copy change -> different draft/program identity;
- preview allowed but publish denied without approval;
- matching server approval -> publish allowed;
- approval does not mutate render identity;
- old approval rejected after copy change;
- recalculated content hash cannot bypass accepted-draft revalidation;
- self-approval attempts rejected;
- URL/control-character/oversize copy rejected;
- unknown/cross-book facts and assets rejected;
- 3s/5s/7s grammar constraints retained;
- malformed/non-server approval rejected.

C32 trusted-atom validation and the existing C27/C29 regression workflows must remain green on the same head.

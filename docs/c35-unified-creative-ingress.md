# C35 — one deterministic creative ingress for user-side LLM output

## Product boundary

C32, C36, and C33 now cover three distinct creative trust classes. C35 turns them into one product-shaped JSON boundary:

```text
server builds ContextPack (+ CopyLanguage when needed)
        |
        v
user-side LLM writes one CreativeIngress JSON
        |
        v
server reloads canonical resources by ID
        |
        +--> trusted_atoms --------------------> C32 compiler
        |
        +--> verified_composition ------------> C36 compiler
        |
        `--> external_copy_review_required ---> C33 compiler
                                                   |
                                                   v
                                    immutable creative program
                                                   |
                                                   v
                                     deterministic video factory
```

There is no LLM call inside C35, C27, the renderer, or the factory.

The model may be nondeterministic while authoring candidate JSON. Once one candidate is accepted, its canonical IDs and compiled program are deterministic.

## LLM-facing envelope

Schema: `newboo-creative-ingress-v1`.

The top-level object contains only:

- `schema`;
- `mode`;
- `context_pack_id`;
- `context_hash`;
- `payload`.

Supported modes:

| Mode | Creative freedom | Copy authority | Creative publication trust |
|---|---|---|---|
| `trusted_atoms` | choose existing hook/tension/payoff atom IDs | server-owned ContextPack atoms | satisfied after deterministic validation |
| `verified_composition` | choose server-owned fact surface forms and rhetorical templates | server-owned CopyLanguage + ContextPack facts | satisfied after deterministic validation |
| `external_copy_review_required` | write literal hook/tension/payoff text | untrusted external LLM copy with fact provenance | unsatisfied until matching trusted server approval |

The payload contains only creative choices. The LLM does **not** provide:

- a ContextPack object;
- a CopyLanguage object;
- `proposal_id`, `draft_id`, `program_id`, or ingress IDs;
- any approval artifact;
- any render/factory receipt.

Those are server-derived or server-owned objects.

## Server-minted content IDs

Content-addressed identities are useful inside the factory but should not be cryptographic homework for a language model.

In `trusted_atoms` mode C35 reconstructs the canonical C32 `CreativeProposal`, computes its `proposal_id`, then calls the canonical C32 compiler.

In `verified_composition` mode the external proposal omits `proposal_id`; C36 validation/materialization computes the canonical composed proposal identity on the server.

In `external_copy_review_required` mode C33 accepts the external draft first, then mints `draft_id` and the review-required program identity.

Content addressing therefore remains strict while the LLM-facing contract stays ergonomic.

## ContextPack is server authority

The envelope references `context_pack_id` and the hash seen by the LLM. It never carries the ContextPack itself as authority.

`processCreativeIngress()` requires a server-owned `loadContextPack(id)` resolver. The returned pack must:

- be a valid ContextPack;
- have exactly the referenced ID;
- have exactly the referenced canonical hash.

Consequences:

- stale LLM context fails closed;
- a client cannot edit facts/capabilities/assets and submit the modified pack with the creative;
- one ingress cannot silently bind to a later ContextPack revision;
- server-context corruption is distinguishable from invalid creative input.

## CopyLanguage is server authority in verified-composition mode

C36 adds a second server-owned resource: CopyLanguage.

The ingress payload may reference only `copy_language_id` and `copy_language_hash`. C35 calls `loadCopyLanguage(id)` and requires exact ID/hash agreement before compiling.

The LLM therefore chooses among trusted forms/templates but cannot add a new form, rewrite a template, alter spoiler metadata, or smuggle literal copy into the compositional language.

The canonical C36 adapter in `contracts/compile-composed-creative-proposal-v1.mjs` intentionally routes the derived internal proposal through the honest C32 compiler. Server-composed hook/tension/payoff text therefore reaches C27 as `context_atom`, not the misleading legacy `human_verified` source kind.

The provenance regression gate requires the legacy and corrected paths to render the same materialized text, role timing, presentation, and assets while the provenance-sensitive content IDs change.

## Exact adapters, not a fourth creative implementation

C35 does not implement creative grammar of its own.

- `trusted_atoms` constructs the canonical C32 proposal and calls `compile-creative-proposal-v1.mjs`.
- `verified_composition` constructs the canonical C36 proposal and calls `compile-composed-creative-proposal-v1.mjs`.
- `external_copy_review_required` constructs the canonical C33 draft and calls `compileExternalCreativeDraft()`.

The C35 audit requires exact program equality against direct calls to those canonical entrypoints from the same semantics.

C35 is routing, server-authority enforcement, and receipt generation — not another narrative planner.

## Approval lookup is server-side

Expressive-copy ingress contains no approval field.

After C33 has produced exact draft/program/copy-manifest identities, C35 may ask a server-owned `loadTrustedApproval()` resolver for an approval bound to those exact identities.

Without a trusted approval:

```text
preview_render_allowed = true
publication_trust_satisfied = false
reason = review_required
```

With a matching server-owned approval:

```text
preview_render_allowed = true
publication_trust_satisfied = true
reason = approved
```

Changing one character of copy changes draft/program/ingress identity and makes an old approval stale.

Approval changes the **decision receipt**, never the render program or creative ingress identity.

## `publication_trust_satisfied` is not final publisher authorization

C35 reports a creative-content trust gate, not permission to post to an external account.

`publication_trust_satisfied = true` means only:

- C32 trusted server atoms passed their contract; or
- C36 server-owned composition passed its contract; or
- C33 free copy has a matching trusted review approval.

A production publishing endpoint must still enforce account ownership, credentials, platform permissions, campaign state, scheduling, quotas/rate limits, and any other delivery policy. C35 must not replace those checks.

## Stable identities

Every successful ingress receives:

- canonical C32/C36 `proposal_id` or C33 `draft_id`;
- canonical creative `program_id`;
- `ingress_id = nbi1_<sha256>` over mode + ContextPack identity + canonical input identity + program identity;
- `decision_id = nbid1_<sha256>` over ingress identity + current creative gate.

Reordering JSON object keys does not change the program or ingress identity.

For C33, an approval arriving later leaves `program_id` and `ingress_id` unchanged but changes `decision_id` because trust state changed.

## Fail-closed behavior

C35 rejects rather than guesses when it sees:

- unknown modes;
- unknown top-level or payload fields;
- client-supplied ContextPack;
- client-supplied CopyLanguage;
- client-supplied content IDs;
- client-supplied approval;
- missing ContextPack or CopyLanguage server resolvers;
- unknown or stale ContextPack;
- unknown or stale CopyLanguage;
- raw-copy injection into trusted-atom or verified-composition mode;
- any downstream C32/C36/C33 contract failure.

Downstream validation paths are prefixed under `/payload` so the UI/API can return deterministic machine errors without guessing what the LLM intended.

## What this unlocks

This contract directly matches the intended product workflow:

1. backend constructs a ContextPack from authoritative product data and optionally exposes the matching CopyLanguage;
2. prompt/instructions tell the user's LLM to emit one `CreativeIngress v1` JSON;
3. the user pastes that JSON into one field or sends it to one endpoint;
4. server reloads authoritative resources and deterministically validates/content-addresses the creative;
5. C32/C36/C33 compile into the existing C27/I05 creative stack;
6. the resulting immutable program can be handed to the existing physical factory;
7. C33 free copy can preview immediately while its publish trust remains separately review-gated.

The next meaningful integration pass is physical rather than semantic: take one accepted C35 ingress from each mode through the existing I05/RenderSpec boundary and I07/I03 render worker, prove deterministic replay/cache identity, and prove that an unapproved C33 ingress cannot enter the publish queue even though it can produce a preview artifact.

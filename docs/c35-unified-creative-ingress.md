# C35 — one deterministic creative ingress for user-side LLM output

## Product boundary

C32 and C33 proved two useful creative contracts, but they were still separate APIs. C35 turns them into the actual product-shaped boundary:

```text
server builds ContextPack
        |
        v
user-side LLM writes one CreativeIngress JSON
        |
        v
server loads canonical ContextPack by ID
        |
        +--> trusted_atoms --------------------> C32 compiler
        |
        `--> external_copy_review_required ---> C33 compiler
                                                   |
                                                   v
                                    immutable creative program
                                                   |
                                                   v
                                     deterministic video factory
```

There is no LLM call inside this ingress, C27, the renderer, or the factory.

The model may be nondeterministic while authoring candidate JSON. Once one candidate is accepted, its IDs and compiled program are deterministic.

## LLM-facing envelope

Schema: `newboo-creative-ingress-v1`.

The top-level object contains only:

- `schema`;
- `mode`;
- `context_pack_id`;
- `context_hash`;
- `payload`.

Supported modes:

- `trusted_atoms` — C32 safe composition from server-owned atom IDs;
- `external_copy_review_required` — C33 literal hook/tension/payoff copy with separate review approval.

The payload contains the creative choices only: account/book scope, narrative, presentation, and server-owned asset IDs.

The LLM does **not** provide:

- a ContextPack object;
- `proposal_id`;
- `draft_id`;
- `program_id`;
- any approval artifact;
- any render/factory receipt.

Those are server-derived objects.

## Why the server mints content IDs

C32's canonical `CreativeProposal` contains `proposal_id = nbp1_<sha256>`. That is useful for identity, but asking a language model to calculate a SHA-256 correctly is a needless interface bug.

In C35 trusted-atom mode the LLM omits `proposal_id`. The server reconstructs the exact canonical C32 proposal, computes `proposal_id`, and then invokes the existing C32 validator/compiler unchanged.

C33 already followed the better pattern: the external draft is accepted first and `draft_id` is minted by deterministic server code. C35 exposes the same ergonomic rule to both modes.

Therefore content addressing remains strict without making cryptographic bookkeeping part of the creative prompt.

## ContextPack is server authority

The envelope references `context_pack_id` and the hash the LLM saw. It never carries the ContextPack itself as authority.

`processCreativeIngress()` requires a server-owned `loadContextPack(id)` resolver. It calls that resolver with the referenced ID only, validates the returned ContextPack, and requires its canonical hash to equal the ingress `context_hash`.

Consequences:

- stale LLM context fails closed;
- a client cannot modify facts/capabilities/assets and send the modified pack alongside the proposal;
- the same JSON cannot silently bind to a later ContextPack revision;
- server context corruption is distinguishable from invalid user creative input.

## Exact adapters, not a third creative implementation

C35 deliberately does not implement a third narrative compiler.

For `trusted_atoms` it constructs the canonical C32 `CreativeProposal`, server-mints its ID, and calls `contracts/compile-creative-proposal-v1.mjs`.

For `external_copy_review_required` it constructs the canonical C33 `ExternalCreativeDraft` and calls `compileExternalCreativeDraft()`.

The C35 audit requires the resulting programs to be exactly equal to programs produced by the canonical C32/C33 entrypoints from the same semantics.

This makes C35 routing glue, not another source of creative behavior.

## Approval lookup is also server-side

Expressive-copy ingress contains no approval field.

After the exact draft/program identities are known, C35 may ask a server-owned `loadTrustedApproval()` resolver for an approval bound to:

- ContextPack ID/hash;
- draft ID;
- program ID;
- copy-manifest SHA-256.

Without one, expressive copy is preview-renderable but its creative publication trust is unsatisfied.

With a valid server-owned approval, the creative publication-trust gate is satisfied.

Changing copy changes draft/program/ingress identity and makes a prior approval invalid.

Approval changes the **decision receipt**, never the render program or creative ingress identity.

## `publication_trust_satisfied` is not the final publisher authorization

C35 reports a creative trust gate, not permission to post to an external account.

`publication_trust_satisfied = true` means only that the creative-content trust policy is satisfied:

- trusted server atoms in C32, or
- matching trusted review approval in C33.

A production publishing endpoint must still enforce ordinary account ownership, credentials, platform permissions, rate limits, campaign state, scheduling rules, and any other delivery policy. C35 must not be used as a replacement for those checks.

## Stable identities

Every successful ingress receives:

- canonical C32 `proposal_id` or C33 `draft_id`;
- canonical creative `program_id`;
- `ingress_id = nbi1_<sha256>` over mode + ContextPack identity + canonical input identity + program identity;
- `decision_id = nbid1_<sha256>` over ingress identity + current creative gate.

The same creative JSON with object keys reordered yields the same program and ingress identity.

An approval arriving later leaves `program_id` and `ingress_id` unchanged, but changes `decision_id` because publication trust state changed.

## Fail-closed behavior

C35 rejects:

- unknown modes;
- unknown top-level or payload fields;
- client-supplied ContextPack;
- client-supplied content IDs;
- client-supplied approval;
- missing server ContextPack resolver;
- unknown ContextPack ID;
- stale ContextPack hash;
- all downstream C32/C33 validation failures with paths prefixed under `/payload`.

This means the UI/API can return deterministic machine errors without guessing what the LLM intended.

## What this unlocks

This is the first contract that directly matches the intended user workflow:

1. backend constructs a ContextPack from authoritative product data;
2. prompt/instructions tell the user's LLM to emit `CreativeIngress v1`;
3. user pastes that JSON into one field or sends it to one endpoint;
4. server validates and content-addresses it;
5. accepted creative compiles to the already-proven C27/I05/factory stack;
6. expressive copy can render a preview immediately while publish approval remains separate.

A later integration pass can connect the accepted C35 program to the existing I07 resumable render worker and I03 physical factory request. That is orchestration work; the creative meaning should no longer need another contract layer.

# C32 — Verified compositional copy language v1

## Decision

C31 proved a hard external-LLM boundary, but its creative space is finite because the model may only select pre-written creative atoms. C32 widens that space without adding an AI judge to runtime.

The boundary becomes:

```text
server facts -> ContextPack v1
server-owned surface forms + templates -> CopyLanguage v1
                         |                     |
                         +------ user LLM -----+
                                   |
                         ComposedCreativeProposal v1
                                   |
                        deterministic materializer
                                   |
                       derived trusted copy atoms
                                   |
                         existing C31 validator
                                   |
                       existing C27 NarrativePlan
                                   |
                         I05 -> RenderSpec -> video
```

The external model still never gets authority to inject arbitrary display text.

## Why this is more expressive than C31

A C31 atom stores the whole rendered phrase. C32 separates trusted copy into two server-owned layers:

1. **Surface forms** are verified renderable forms of a known fact, for example `a message arrives from their future self`.
2. **Templates** are verified rhetorical structures with typed slots, for example `What if {premise}?`.

The LLM chooses a template and binds allowed surface-form IDs into its slots. The server, not the model, concatenates the final string.

That means the final sentence can be new even though every factual fragment and every connective/literal came from trusted server state.

Example:

```json
{
  "template_id": "tpl_hook_what_if",
  "bindings": [
    {"slot_id": "premise", "form_id": "form_premise_alt_clause"}
  ]
}
```

materializes deterministically to:

```text
What if a message arrives from their future self?
```

The full sentence is not stored as a C31 creative atom.

## CopyLanguage v1

Schema: `newboo-copy-language-v1`.

`CopyLanguage` is server-owned and cryptographically bound to an exact C31 ContextPack revision through `context_pack_id + context_hash`. It contains per-book:

- trusted `surface_forms`;
- trusted `templates`;
- typed template slots;
- allowed C27 angle types;
- maximum output length;
- spoiler levels;
- optional composition groups used to prove that facts are allowed to appear together.

Each surface form references an existing `fact_id` from the bound ContextPack. It also declares a `surface_type` such as `clause`, `question_body`, or `noun_phrase`.

Each template slot declares accepted fact kinds and accepted surface types. This prevents syntactically valid IDs from being composed into a semantically wrong slot class.

Multi-slot templates can set `require_shared_group=true`. Then all selected surface forms must share at least one server-owned composition group. This is the deterministic replacement for asking an LLM whether two facts are safe to combine.

`copy_language_hash` is SHA-256 over canonical JSON with only `copy_language_hash` omitted.

## ComposedCreativeProposal v1

Schema: `newboo-composed-creative-proposal-v1`.

The user-side LLM may choose:

- book/account scope;
- angle type;
- hook/tension/payoff template IDs;
- slot -> surface-form bindings;
- reveal timing and CTA treatment;
- duration, fps, visual system, delivery profile, seed;
- owned asset IDs.

It may not provide raw copy, URLs, file paths, HTML, scripts, or arbitrary nested fields.

### Important identity change from C31

The external LLM is **not required to calculate `proposal_id`**.

The server canonicalizes the accepted JSON and mints:

```text
proposal_id = nbcp1_<sha256>
```

If a client includes `proposal_id`, it is treated only as an optional integrity assertion and must match the server result.

This keeps cryptographic work out of the model prompt while preserving replay/cache identity.

Binding order and selected-asset order are canonicalized where order has no semantics, so equivalent proposals receive the same ID.

## Deterministic materialization

For each expression the validator:

1. resolves the scoped template;
2. requires exactly the template's slot IDs;
3. resolves every scoped surface form;
4. follows each surface form to its ContextPack fact;
5. verifies allowed fact kind and surface type;
6. rejects same-fact reuse unless the template explicitly allows it;
7. enforces shared composition groups when required;
8. takes the maximum selected spoiler level and checks the ContextPack budget;
9. concatenates server-owned literal/template parts and trusted form text;
10. enforces `max_output_chars`;
11. mints a deterministic `newboo-copy-program-v1` identity with full fact/form/template provenance.

No language model participates in these steps.

## C31 compatibility bridge

C32 deliberately does not fork the settled creative compiler.

After materialization it constructs an internal derived ContextPack containing the generated copy as deterministic derived creative atoms. It then constructs an internal C31 CreativeProposal and runs the existing `validateCreativeProposal()` and `compileCreativeProposal()` path.

Therefore C31 remains authoritative for:

- account/book scope;
- asset scope and required cover;
- exposed capabilities;
- duration/fps/visual/delivery constraints;
- 3s/5s/7s+ grammar rules;
- reveal/CTA cross-field rules;
- C27 compilation.

The accepted C32 program records both the original context/language identities and the internal C31 bridge identities.

## Threat boundary

C32 accepts that an untrusted LLM may hallucinate template IDs, slot IDs, surface forms, cross-book references, stale hashes, unsupported capabilities, or raw copy.

Those are ordinary deterministic validation failures.

C32 still does **not** claim to prove arbitrary natural-language entailment. New language enters the trusted surface only when the backend adds a surface form or template to CopyLanguage. The runtime only composes those approved pieces.

This keeps the hard rule intact:

> if a proposal is accepted, every rendered factual phrase is traceable to server-owned facts and every connective/rhetorical structure is traceable to a server-owned template.

## User-side LLM instruction contract

The product prompt can now be extremely mechanical:

```text
Return exactly one JSON object matching newboo-composed-creative-proposal-v1.
Use only IDs present in ContextPack and CopyLanguage.
Do not write display copy yourself.
Do not add text, copy, prompt, URL, URI, file/path, HTML, script, or unknown fields.
Choose templates and bind their slots only to compatible surface-form IDs.
Echo the provided context_pack_id/context_hash and copy_language_id/copy_language_hash exactly.
Do not calculate proposal_id; the server assigns it after validation.
```

The model can still reason creatively about which facts, rhetorical shape, pacing, reveal and visual system fit the desired video. It simply cannot cross the factual authority boundary.

## Test gate

`node contracts/check-compositional-copy-v1.mjs` proves:

- machine-readable schemas/examples parse;
- CopyLanguage hash/context binding;
- valid external proposal -> deterministic materialized copy -> real C31 -> real C27 NarrativePlan;
- generated hook/payoff text is not merely selection of an existing C31 atom;
- multi-fact template composition;
- binding-order and object-key-order identity invariance;
- server-minted optional proposal identity;
- semantic changes alter program identity;
- stale context/language rejection;
- unknown template/slot/form rejection;
- fact-kind and surface-type gates;
- shared composition-group gate;
- spoiler budget and max-copy-length gates;
- raw text and URL injection rejection;
- C31 duration grammar remains authoritative;
- cross-book surface-form rejection;
- invalid server CopyLanguage rejection;
- deterministic ordered errors;
- C31 regression gate still passes.

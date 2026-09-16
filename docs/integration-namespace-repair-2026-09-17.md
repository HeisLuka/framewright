# Integration namespace repair — 2026-09-17

## Decision

The campaign-learning integration work that was historically merged under task labels I08/I09/I10 is canonically renumbered to **I14/I15/I16**.

Canonical HQ task namespace already reserves:

- I08 — semantic sidecar / rendered-visibility contract;
- I09 — local JSON operator console;
- I10 — canonical warm c2 executor wiring;
- I11 — delivery ownership cleanup;
- I12 — canonical FAST multi-profile executor;
- I13 — multi-format end-to-end parity.

The conflicting labels were a coordination mistake: the campaign work checked GitHub PR numbering but did not first reserve against the full Notion Task DB namespace.

## Canonical mapping

| Canonical task | Historical task label | Historical PR | Purpose |
|---|---|---:|---|
| I14 | I08 | #101 | arm-aware publication attribution round-trip for C34 selector arms |
| I15 | I09 | #104 | blocked publication-opportunity scheduler for C37 DOE treatments |
| I16 | I10 | #105 | generalized experiment publication attribution for C34 + I15 sources |

## Compatibility rule

Historical implementation modules and wire schema strings keep their original `i08/i09/i10` names internally. They are evidence identities from already-merged, already-audited work and are not rewritten solely for coordination cosmetics.

Canonical I14/I15/I16 entrypoints re-export or re-run those historical implementations. Active docs/workflows use the canonical task numbers.

This means:

- task ownership and future roadmap references use I14/I15/I16;
- historical PRs, artifacts, schema strings and content-addressed IDs remain reproducible;
- canonical I08–I13 remain free for their pre-existing HQ tasks;
- no renderer, selector, publication, ingestion or evidence semantics change in this repair.

## Validation

The namespace-repair CI re-runs the unchanged historical I14/I15/I16 audits through the canonical entrypoints. A green result proves the aliases are coordination-only and did not alter the tested behavior.

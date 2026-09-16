# E15 — campaign-ready creative package results

Canonical GitHub Actions run: `35120074041`.

## Product question

Can the deterministic E14 factory be converted into a bounded, traceable campaign package with stable creative identity, exact render provenance, duplicate suppression and deterministic selection — without turning the pipeline into an uncontrolled Cartesian product?

E15 regenerates the canonical 40-candidate E14 pool (10 books x 4 structural variants), computes identity/provenance for every candidate, suppresses duplicates, then stages exactly three selected creatives per book while retaining the fourth as reserve metadata in the candidate catalog.

## Identity contract

E15 separates three identities:

- `creative_id` — hash of the semantic creative spec; independent of encoder implementation and asset storage path;
- `render_id` — creative spec plus renderer/environment/profile identity;
- `output_sha256` — exact MP4 bytes.

The canonical renderer environment is pinned in the package metadata: Linux x64, Node 20.20.2, `@napi-rs/canvas 1.0.9`, FFmpeg 6.1.1, pinned DejaVu Sans font hashes, 1080x1920 / 30 fps / 360 frames / x264 veryfast CRF22.

## Canonical package result

- books: `10`;
- input candidates: `40`;
- selected creatives: `30` (`3` per book);
- reserve candidates: `10` in the candidate catalog;
- exact creative-spec duplicate groups: `0`;
- exact output duplicate groups: `0`;
- near-visual suppressed candidates: `0` at fingerprint threshold `0.015`;
- all staged MP4 hashes match the manifest;
- creative IDs are unique across all candidates;
- render IDs are unique across all candidates;
- repeated package build is byte-identical for all JSON/hash manifests.

Selection policy: `hook-anchor-greedy-maximin-v1`.

For each book, `hook-first` is kept as an anchor, then the remaining two selected creatives are chosen greedily to maximize the minimum E14 timeline-diversity distance to the already selected set. This produces a bounded initial test set; it is not an ad-performance ranking.

## Package outputs

The canonical artifact contains:

- `campaign-manifest.json` — the 30 selected campaign creatives and full provenance;
- `candidate-catalog.json` — all 40 candidates, including 10 reserves;
- `dedupe-report.json` — exact/near-duplicate evidence;
- `campaign-manifest.sha256` — integrity hash for the manifest;
- `selected/*.mp4` — 30 staged MP4s named by stable creative/render IDs;
- E14 route/diversity/batch evidence used by the selector.

## Decision

E15 passes the campaign-packaging hypothesis:

1. the factory can emit a bounded, auditable campaign set instead of every possible combination;
2. semantic creative identity is cleanly separated from renderer identity and exact output bytes;
3. duplicate suppression and diversity selection are deterministic and reproducible;
4. the same rendered pool can be repackaged without changing creative identity;
5. synthetic diversity is only a starting allocation mechanism — CTR/CPA/conversion data must later drive pruning and budget allocation.

The next product question should move from creative generation to delivery. A useful E16 is multi-format adaptation: render the same semantic creative as 9:16, 1:1 and 16:9 while preserving identity/provenance and verifying that typography/layout reflow remains readable without manual template forks.

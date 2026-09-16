# R48 — semantic ROI comparator repeatability scout

## Question

R46/R47 showed non-monotonic WebCodecs pass/fail behavior and tiny x264-relative ROI deficits even at 4 Mbps. Before extending bitrate further or weakening the quality contract, determine whether those deficits are stochastic run noise or reproducible properties of the encoder/comparator pair.

## Method

Representative fixtures:

- `river-station / paper` — passing/control fixture;
- `letters / paper` — unresolved R47 failure;
- `long-title / newspaper` — unresolved R47 failure;
- `night-archive / newspaper` — unresolved R47 failure.

For each fixture:

- generate the same-raster x264 CRF22 reference twice;
- encode WebCodecs at 3 Mbps three times;
- encode WebCodecs at 4 Mbps three times;
- record raw H.264 and muxed MP4 SHA-256, bytes, every R31 ROI SSIM/PSNR, binary pass/fail and run-to-run metric spread.

The R31 comparator is unchanged: every semantic ROI must be at least its same-fixture x264 CRF22 SSIM.

## Canonical result

Canonical synced run: `35159806898`. Artifact: `10472770803`. Artifact digest: `sha256:07155531696811d0442ec750b08285d0caa9be339e8e49f13757f8feec38a339`.

The x264 CRF22 reference is bit-deterministic on all four fixtures: each pair of repeated references has one unique SHA-256 and identical bytes.

WebCodecs/OpenH264 is not bit-deterministic under the same input/config on this runner. Every three-repeat bitrate group produced three unique raw H.264 hashes and three unique muxed MP4 hashes. ROI metrics also move between repeats.

| fixture | bitrate | pass pattern | max ROI SSIM spread |
|---|---:|---|---:|
| river-station / paper | 3M | PASS, PASS, FAIL | 0.002483 |
| river-station / paper | 4M | PASS, PASS, PASS | 0.003061 |
| letters / paper | 3M | FAIL, FAIL, FAIL | 0.001208 |
| letters / paper | 4M | FAIL, FAIL, FAIL | 0.000288 |
| long-title / newspaper | 3M | FAIL, FAIL, FAIL | 0.000351 |
| long-title / newspaper | 4M | FAIL, FAIL, FAIL | 0.000590 |
| night-archive / newspaper | 3M | FAIL, FAIL, FAIL | 0.000548 |
| night-archive / newspaper | 4M | FAIL, FAIL, FAIL | 0.000940 |

The control fixture proves the current single-sample binary comparator is not repeatable: `river-station 3M`, the fixture behind the original R31 production choice, flips from PASS to FAIL under identical nominal input/config. The failing repeat misses only `hook` by `-0.000768` SSIM.

The heterogeneous failures are nevertheless not explained away by random run noise. At 4M, `letters` fails `book_hook` in all three repeats (`-0.000459` to `-0.000486`), `long-title` fails `cta_title` in all three (`-0.000769` to `-0.001359`), and `night-archive` fails `cta_title` in all three (`-0.000542` to `-0.000603`).

## Decision

Do not extend the bitrate ladder and do not promote 4 Mbps. R47 already showed that 4M is not a global robust floor, and R48 shows that a single WebCodecs encode cannot serve as a deterministic quality predicate.

Do not introduce an arbitrary SSIM tolerance from this run either. The observed WebCodecs run-to-run spread can be larger than several individual x264-relative deficits, while some fixture/ROI failures persist in every repeat.

The next quality-contract pass should be variance-aware: characterize repeated-encode distributions and define an acceptance/materiality rule from replicated evidence rather than `one WebCodecs sample >= x264 on every ROI`. The production runtime target remains 3 Mbps while that acceptance contract is investigated; it is not reclassified here as a catalog-wide proven quality floor.

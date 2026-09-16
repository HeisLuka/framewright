# R35 — WebCodecs profile/content-hint + encoder trace scout

## Question

R31 established that WebCodecs at 3 Mbps is the lowest tested fixed-bitrate point that clears every semantic ROI against the same-raster x264 CRF22 reference on the canonical vertical C18 fixture. Inspection of the actual R31 outputs then revealed a possible confounder: the WebCodecs bitstream was Constrained Baseline while the x264 reference was High Profile.

R35 tests that explanation directly and inspects the actual Chromium encode path before opening more complex codec work.

## Fixture

Use exactly the R31 fixture and semantic ROIs:

- `river-station`
- visual system `paper`
- structural variant `hook-first`
- profile `vertical`
- 1080x1920 / 30 fps / 12 seconds
- same Chromium Canvas raster for every codec candidate
- x264 reference explicitly constrained to High Profile / Level 4.0 / CRF22 / veryfast

Creative routing, layout, motion, cover and payload are unchanged.

## Support probe

Chrome 131 on the GitHub Actions runner reports all tested combinations as supported:

- H.264 Baseline `avc1.420028`
- H.264 Main `avc1.4D0028`
- H.264 High `avc1.640028`
- default vs `contentHint: "text"`
- `latencyMode: "realtime"` vs `"quality"`

Every produced MP4 is inspected with `ffprobe`; emitted profile is evidence rather than inferred from the requested codec string.

## Canonical result

Canonical scratch run: GitHub Actions `35144484482`, artifact `10466264458`.

| policy | emitted profile | bytes | encode wall | semantic ROI result |
|---|---|---:|---:|---|
| x264 High CRF22 | High | 0.56 MiB | 13.50 s | reference |
| Baseline / default / realtime / 3 Mbps | Constrained Baseline | 1.42 MiB | 2.88 s | PASS |
| Baseline / default / quality / 3 Mbps | Constrained Baseline | 1.42 MiB | 2.85 s | PASS |
| High / default / realtime / 3 Mbps | High | 1.43 MiB | 2.87 s | PASS |
| High / default / quality / 3 Mbps | High | 1.42 MiB | 2.88 s | PASS |
| High / text / realtime / 3 Mbps | High | 1.04 MiB | 5.24 s | FAIL |
| High / text / quality / 3 Mbps | High | 1.04 MiB | 5.31 s | FAIL |
| Main / text / quality / 3 Mbps | Main | 1.04 MiB | 5.31 s | FAIL |

### Profile hypothesis: rejected

High Profile does not materially improve bytes, wall time or semantic ROI quality over the Baseline production anchor on this OpenH264 software path. The earlier Baseline-vs-High mismatch therefore does **not** explain the large x264-vs-WebCodecs byte gap for this fixture.

### `latencyMode: quality`: rejected as an optimization

With default content mode, `quality` is effectively neutral against `realtime` here. It does not earn extra production complexity or a policy change.

### `contentHint: text`: rejected for STANDARD

`text` reduces the 3 Mbps output from roughly 1.42 MiB to 1.04 MiB, about a 27% reduction, but it fails the existing semantic ROI gate and roughly doubles encode wall. The file-size win is therefore not accepted.

Do not weaken the ROI gate to rescue this result.

## Fine bitrate scout on the production policy

The existing Baseline/default/realtime policy was tested at 2.00 / 2.25 / 2.50 / 2.75 / 3.00 Mbps.

| bitrate | bytes | encode wall | semantic ROI result |
|---:|---:|---:|---|
| 2.00 Mbps | 1.20 MiB | 2.93 s | FAIL |
| 2.25 Mbps | 1.28 MiB | 2.87 s | PASS |
| 2.50 Mbps | 1.33 MiB | 2.87 s | FAIL |
| 2.75 Mbps | 1.36 MiB | 2.85 s | FAIL |
| 3.00 Mbps | 1.42 MiB | 2.88 s | PASS |

The smallest passing point in this single run is 2.25 Mbps, but the pass/fail pattern is non-monotonic. Therefore **2.25 Mbps is not promoted to a production policy** from this evidence. A universal bitrate reduction would require stable multi-fixture/repeated evidence. The observed single-fixture size reduction versus 3 Mbps is only about 10%, below the runtime Gold Rush 20–25% byte-reduction deep-pass gate, so a broad codec deep pass is not justified now.

Keep 3 Mbps as the conservative validated software policy for the current STANDARD path.

## Actual Chromium path on the CI runner

`SystemInfo.getInfo` and a separate 60-frame trace of the production Baseline/default/realtime policy show:

- Chrome `131.0.6778.204`;
- ANGLE SwiftShader software renderer;
- `2d_canvas: unavailable_software`;
- `rasterization: disabled_software`;
- `video_encode: disabled_software`;
- no advertised hardware video encoders;
- `OpenH264::EncodeFrame` is the actual H.264 encode event.

Selected trace totals for 60 frames:

- `OpenH264::EncodeFrame`: 304.895 ms;
- `ConvertAndScale`: 47.725 ms;
- `CanvasResourceProviderBitmap::Snapshot`: 0.627 ms total across 142 events;
- SharedImage create/destroy bookkeeping is small in this trace.

Among the explicitly observed codec/conversion stages, OpenH264 encode time is about 6.4x the `ConvertAndScale` time. This is evidence for a software OpenH264 path on the hosted runner, **not** proof of zero-copy and not evidence about a real Intel/NVIDIA hardware machine.

## Decision

1. **KEEP** Baseline/default/realtime as the current software OpenH264 policy; 3 Mbps remains the conservative validated setting.
2. **KILL** High Profile as a byte-efficiency optimization on this path.
3. **KILL** `latencyMode: quality` as a meaningful optimization on this path.
4. **KILL** `contentHint: text` for STANDARD because it fails semantic quality despite smaller files.
5. **DO NOT promote 2.25 Mbps** from the non-monotonic single-fixture result.
6. Hardware encoder/provider economics remain a genuinely different experiment because this runner has no hardware video encode path.
7. The next runtime work should prioritize the R34-earned state-based recycle/reliability pass or real-provider hardware economics, not more software-profile micro-tuning.

## Coordination

R34 is merged. R35 can now occupy the single active Runtime PR slot and be merged into `lab/framewright-research` after its PR CI revalidates the canonical harness.
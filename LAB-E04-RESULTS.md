# E04 results — encoder quality / size / speed matrix

Canonical commit: `33573169e7ffb8096b64f51f93ca66fbd361e33f`

GitHub Actions run: `35046235210`

Workload: `book-ad-v0`, 1080×1920, 30 fps, 360 frames / 12 seconds.

Quality reference: the original PNG frame sequence rendered once at the start of the run. All SSIM/PSNR values below compare each encoded output against those source frames.

## Exact timing contract is fixed

The first WebCodecs prototype produced ~12.0066 s after raw H.264 stream-copy mux. No re-encode is required to fix this.

The production mux now applies packet-level timestamp normalization:

```text
setts=time_base=1/30:pts=N:dts=N:duration=1
```

and an explicit MP4 track timescale.

All final WebCodecs profiles in this experiment now report:

- `r_frame_rate = 30/1`
- `avg_frame_rate = 30/1`
- `nb_frames = 360`
- `duration = 12.000000`

The mux remains stream-copy.

## x264 matrix

Important: x264 times below are **encoder time only after the PNG source sequence already exists**. They are not comparable directly with WebCodecs full-process totals.

| preset | CRF | encode | bytes | SSIM | PSNR |
|---|---:|---:|---:|---:|---:|
| veryfast | 18 | 4.343 s | 653,967 | 0.998872 | 52.14 dB |
| veryfast | 22 | 3.806 s | 458,536 | 0.998330 | 48.94 dB |
| veryfast | 26 | 3.817 s | 319,995 | 0.997448 | 45.66 dB |
| fast | 18 | 5.277 s | 714,226 | 0.999333 | 55.09 dB |
| fast | 22 | 5.233 s | 518,628 | 0.998901 | 51.87 dB |
| fast | 26 | 5.175 s | 377,189 | 0.998358 | 48.53 dB |
| medium | 18 | 4.933 s | 702,934 | 0.999375 | 55.54 dB |
| medium | 22 | 4.872 s | 521,555 | 0.998977 | 52.25 dB |
| medium | 26 | 4.811 s | 385,494 | 0.998450 | 48.98 dB |
| slow | 18 | 5.507 s | 696,089 | 0.999398 | 55.73 dB |
| slow | 22 | 5.383 s | 515,571 | 0.998982 | 52.46 dB |
| slow | 26 | 5.333 s | 382,674 | 0.998518 | 49.14 dB |

All outputs are exactly 360 frames / 12.000 s.

### x264 conclusion

For this simple editorial book-ad workload, `slow` is not a sensible generic production default.

At CRF 22:

- `veryfast`: 458,536 B, SSIM 0.998330, 3.806 s encode
- `slow`: 515,571 B, SSIM 0.998982, 5.383 s encode

The slower preset buys a modest objective-quality improvement but is not even smaller in this workload. `medium`, `fast` and `slow` are tightly clustered compared with the extra compute.

If a PNG-based archival path is retained, `veryfast/CRF22` is a much stronger default candidate than upstream `slow/CRF22`. This does not make PNG transport a good mass-production architecture; it only improves that fallback path.

## WebCodecs matrix

WebCodecs totals include Chromium startup, page load, scene rendering, Canvas → VideoFrame, H.264 encoding, final encoded-stream transfer to Node and FFmpeg stream-copy mux.

| target bitrate | full process | MP4 bytes | SSIM | PSNR |
|---:|---:|---:|---:|---:|
| 0.6 Mbit/s | 3.057 s | 689,324 | 0.995886 | 43.01 dB |
| 0.9 Mbit/s | 3.029 s | 846,832 | 0.997034 | 45.42 dB |
| 1.2 Mbit/s | 3.121 s | 1,030,208 | 0.997514 | 46.81 dB |
| 1.8 Mbit/s | 3.506 s | 1,358,234 | 0.998377 | 49.87 dB |
| 2.5 Mbit/s | 3.074 s | 1,696,717 | 0.998784 | 51.91 dB |

All outputs are exactly 360 frames / 12.000 s.

Do not interpret the small timing differences between bitrate rows as bitrate → speed causality. GitHub Actions runner scheduling and encoder timing are noisy; the important result is that the whole WebCodecs path consistently stays around ~3–3.5 seconds in this run.

## Production interpretation

### Throughput-oriented upload profile

`WebCodecs 1.2–1.8 Mbit/s` is currently the strongest production candidate for ad-platform upload:

- no temporary PNG sequence;
- exact 30 fps / exact duration;
- full 1080×1920 video in about 3–3.5 s on this CI worker;
- ~1.0–1.36 MB for a 12-second ad;
- SSIM ~0.9975–0.9984 against the original rendered frames.

The 1.8 Mbit/s result has roughly the same objective-quality region as x264 veryfast/CRF22 while keeping the direct browser-side pipeline. Its file is larger, but upload platforms normally transcode input again, so storage/egress must be evaluated separately from visual quality.

### Small-file / archival fallback

`x264 veryfast/CRF22` gives a very small ~0.46 MB file with high quality. However, producing it from the current Framewright architecture still requires the PNG stage first.

In this canonical E04 run, rendering the 360 source PNGs itself took ~3.82 s inside the render loop plus browser/page startup. Adding the 3.81 s x264 encode puts the practical PNG+x264 path far above the ~3 s direct WebCodecs path.

### Storage at 100k videos

Approximate output storage for 100,000 copies of this exact 12-second workload:

- x264 veryfast/CRF22: ~45.9 GB
- WebCodecs 0.9 Mbit/s: ~84.7 GB
- WebCodecs 1.2 Mbit/s: ~103.0 GB
- WebCodecs 1.8 Mbit/s: ~135.8 GB
- WebCodecs 2.5 Mbit/s: ~169.7 GB

These are output bytes only, not cloud-cost estimates.

## Important limitation

This matrix uses a deliberately cheap, relatively flat editorial visual system. Compression behavior changes substantially for grain, halftone, CRT noise, glow and rapid texture.

Therefore the production bitrate should **not** be frozen globally from E04 alone. A style may define its own output profile, or a future automatic policy may select bitrate/quality class based on template family.

## E04 decision

1. Keep WebCodecs as the primary high-throughput path for the cheap book-ad style.
2. Use exact packet-level timestamp normalization during mux; the timing bug is closed without re-encoding.
3. Stop treating `libx264 -preset slow` as the default production encoder setting.
4. Keep x264 veryfast/CRF22 as a strong small-file/reference fallback.
5. Carry `WebCodecs 1.2 Mbit/s` and `1.8 Mbit/s` forward as the two production candidates until style diversity is tested.
6. Do not spend engineering time on Rust/C++ scene rendering yet.

## Next experiment

E05 must measure **worker economics**, not isolated frame speed:

- cold vs warm Chromium;
- 1 / 2 / 4 simultaneous complete video jobs on a 4-vCPU worker;
- videos/hour;
- p50/p95 per-video wall time;
- RAM peak / contention;
- output profile fixed to WebCodecs 1.2 Mbit/s first, with 1.8 Mbit/s as a quality tier.

After E05, map the measured videos/hour to current cloud instance prices and calculate $/video, $/1k and $/100k.

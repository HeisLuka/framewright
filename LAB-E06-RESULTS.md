# E06 results — reproducible render worker

Canonical successful CI run: `35085883166`

Commit under test: `73bfc5b0ff208010a58e69f1822d6e9e45845960`

Goal: turn the Book Ad / WebCodecs lab path into a repeatable worker environment so future cost and style benchmarks are not silently measuring different Chromium, FFmpeg, font or locale stacks.

## Pinned worker environment

Docker base:

`node:20.20.2-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0`

Built image ID in the successful run:

`sha256:da74283edb29215d7171b524ea1fa5842a3bc9b095e574136a941c57cff10c81`

Manifest captured inside the container:

- Debian 12 (bookworm), Linux x64;
- Node `v20.20.2`;
- Puppeteer `23.11.1`;
- Chrome for Testing `131.0.6778.204`;
- FFmpeg `5.1.9-0+deb12u1`;
- fontconfig `2.14.1`;
- DejaVu Sans and Liberation Sans installed in the worker image;
- `LANG=C.UTF-8`, `LC_ALL=C.UTF-8`, `TZ=UTC`.

The manifest also hashes `package.json`, `package-lock.json`, the canonical Book Ad v0 template and its payload schema.

## Golden-frame determinism

Two independent clean container runs rendered frames `0, 45, 90, 180, 240, 359` at 1080×1920 with seed 7.

`diff` of the manifests and `cmp` of every PNG both passed. SHA-256 values from run A:

| frame | SHA-256 |
|---:|---|
| 0 | `a7008c73c8e178756418419853a8fff4f809e7d9c47fb089d352be9cbcd0d6cc` |
| 45 | `d1c072ef842b1a896b9f063e33828467f3c95f27af3d917cbffd353cbf809c6e` |
| 90 | `6c2b09a1fdd279796950226cdfc3355e4265d32a459d6715ded06315e7550382` |
| 180 | `d12ca65cd6286333c2b9bfca0ad78d7e1e689546f77d552c25b0d664f18b6027` |
| 240 | `3f307e7ab7848c4b3a03eaa45e2b7c02229cefed98f420000c844f1492f770d1` |
| 359 | `91b44b97f561b956207b4a9829d447d6c547cbeb41dbf1f9e68e3c1f296d0620` |

For clean runs of this exact worker image and template/input, the sampled raster output is therefore byte-for-byte stable.

This does **not** claim that arbitrary future Chrome/OS/font versions will render identically; the point of E06 is precisely to freeze those versions and detect drift with golden frames.

## Container warm-worker smoke

Workload: Book Ad v0, 1080×1920, 12 s / 360 frames, WebCodecs H.264 at 1.2 Mbps, six complete videos, two warm pages on a 4-vCPU GitHub Actions host.

- setup: `434.886 ms` total;
- Chrome launch: `272.099 ms`;
- page init: `159.301 ms` and `162.565 ms`;
- 6/6 videos succeeded;
- batch wall: `13.947 s`;
- steady throughput: **1548.702 videos/hour**;
- amortized throughput including setup: **1501.872 videos/hour**;
- latency mean: `4.607 s`;
- p50: `4.616 s`;
- p95: `4.896 s`;
- peak RSS: **1.400 GB**;
- mean RSS: **1.309 GB**.

The E05 host benchmark measured a higher c2 throughput (~1904 videos/hour). Do not attribute the difference to Docker alone: E06 is only a six-job smoke run and executes in a different isolated software stack/run. Future performance comparisons should use this pinned image as the common baseline rather than mixing host and container measurements.

## E06 decision

1. The pinned worker image is now the canonical environment for performance and quality experiments.
2. Golden-frame CI is a practical determinism guard for the raster layer.
3. WebCodecs works inside the pinned container with warm-page concurrency 2.
4. Future provider/cost benchmarks should identify the worker image by immutable base digest plus the lab commit/image digest and should run the same golden-frame check before accepting performance numbers.
5. Do not optimize for cross-version bitwise rendering. Pin the version and detect intentional upgrades instead.
6. Next canonical experiment should move from renderer plumbing to product risk: benchmark representative cheap / medium / heavy book-ad visual systems in this same worker image, then classify templates by throughput, memory and suitable bitrate.
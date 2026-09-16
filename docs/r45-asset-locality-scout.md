# R45 — decoded asset cache / locality scout

## Question

After warm Chromium navigation, do catalog-shaped jobs still pay enough repeated cover/font/texture setup cost to justify either a custom decoded-asset cache or similarity-aware scheduling?

The null hypothesis is that Chromium's native HTTP/image/font caches already remove most reusable work. We measure that before adding another cache layer.

## Important benchmark correction

The existing R42 production harness serves static assets with `Cache-Control: no-store` to keep concurrency measurements isolated. That is useful for R42 but would bias an asset-cache experiment toward a false positive. R45 therefore treats asset cacheability as an explicit experimental variable.

Each profile runs three fresh-browser scenarios after warming all three cover identities once:

1. `no-store + random order` — benchmark-server control;
2. `cacheable + random order` — browser-native cache baseline;
3. `cacheable + grouped order` — locality/scheduler opportunity.

The HTML document itself remains `no-store`; only static assets receive the cache contract. Cover URLs remain stable inside each scenario.

## Measurements

For vertical, square and landscape profiles, record navigation-to-`window.__ready` mean/p50/p95, Resource Timing for the cover, observed server-side cover requests, zero-transfer cache-hit rate, and the delta between random and grouped ordering.

This is an opportunity scout, not a production throughput verdict. It intentionally avoids encode/mux so that a small reusable setup component can be bounded cheaply. Any follow-up implementation must translate the absolute saved milliseconds against the current full-job wall before claiming a >=10% E2E opportunity.

## Canonical result

GitHub Actions run `35155186739`, artifact `10470294580`, on head `6a20304d5a0bd46e95ccd5eb4bbf877a370b9270` passed the corrected request-telemetry gate.

Across the three delivery profiles, mean navigation-to-ready was:

- `no-store + random`: **33.77 ms**;
- `cacheable + random`: **32.03 ms** (`-4.9%` versus no-store at the setup-only layer);
- `cacheable + grouped`: **26.74 ms** (`-16.6%` versus cacheable random).

The server-side oracle confirms that this is a real browser-cache experiment rather than timing noise: every no-store scenario generated **63 cover requests** (3 warmup + 60 timed jobs), while cacheable random/grouped generated only **3** warmup requests per profile and then served timed cover loads from cache (`zeroTransferRate = 1`).

Grouping therefore saves only **5.28 ms/job** on average after assets are warm. Even against a deliberately optimistic full production job of just 2000 ms, that is an upper bound of **0.264% E2E** — roughly forty times smaller than the 10% Gold Rush gate. Current full jobs are in fact longer, so the real fraction is smaller still.

Per-profile grouping savings were 4.69 ms vertical, 5.48 ms square, and 5.69 ms landscape. The direction is consistent enough to show locality exists, but its absolute magnitude is economically irrelevant to renderer throughput.

## Decision

**KILL custom decoded-asset memory cache and similarity-aware renderer scheduling for the current FAST architecture.**

The useful production rule is simpler: keep reusable static assets content-addressed/cacheable and let Chromium's native cache do its job. Do not add another decoded-asset cache or scheduler branch merely to chase a few milliseconds of navigation setup.

Reopen only if the rendering architecture changes so radically that full-job wall falls by roughly an order of magnitude, or asset setup grows materially enough to become a double-digit share of E2E time.

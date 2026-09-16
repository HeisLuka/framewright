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

## Gate

Do not implement a custom decoded-asset memory cache unless the measured reusable asset/setup component has a credible >=10% end-to-end upper bound on the current FAST job wall. Do not implement locality-aware scheduling unless grouped cacheable ordering materially beats cacheable random ordering after all assets are warm.

Any later production candidate still requires sampled pixel parity, peak RSS <=30% worse, and neutral-or-better videos/hour/GiB.

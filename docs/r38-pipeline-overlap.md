# R38 — Pipeline overlap / stage concurrency scout

Question: can the current warm c2 runtime hide the serialized post-encode tail of job N under draw/encode/navigation of job N+1 without changing page/encoder concurrency?

Controlled variables: same 36-fixture C18 catalog, persistent Chromium, two reusable pages, full document navigation per job, WebCodecs H.264 at 3 Mbps, cached canonical AAC, FFmpeg stream-copy mux, and the current synchronous `ffprobe -count_frames` artifact gate.

Only changed axis: serial tail vs bounded overlap. In overlap mode at most two post-encode tails may be in flight. Job completion is counted only after mux, synchronous validation, artifact SHA-256 and cleanup complete.

Canonical ordering: serial -> overlap -> overlap -> serial, one complete 36-fixture catalog cycle per scenario occurrence.

Correctness gates: 36/36 jobs per cycle, stable sampled Canvas state fingerprints, valid video+audio artifact with exact video frame count and duration tolerance, artifact SHA-256, bounded tail backlog, zero silent validation bypass.

Measurements: realized videos/hour, p50/p95 completion wall, encode and tail stage wall, CPU/video, process-tree RSS peak, max in-flight encoded bytes/artifacts, encoder queue, mux/validation/hash wall.

Deep pass: >=10% realized throughput gain, or materially lower CPU/$ at effectively equal throughput. Otherwise pipeline overlap is killed and the simpler serialized tail remains the runtime contract.

R36 is evidence, not an implementation dependency: its cheaper normalized compressed-hash validator remains a separate integrity-policy question and is deliberately not mixed into R38.

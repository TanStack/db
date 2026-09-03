---
'@tanstack/db': patch
'@tanstack/db-ivm': patch
'@tanstack/db-sqlite-persistence-core': patch
'@tanstack/electric-db-collection': patch
'@tanstack/powersync-db-collection': patch
'@tanstack/query-db-collection': patch
---

Harden on-demand loading across core and adapters. Successful `loadSubset`
work now settles after its writes publish; exact requests are deduplicated
without inferring wider source coverage; ordered queries make bounded progress;
and truncate replay, cancellation, cleanup, and adapter ownership preserve the
last coherent result. Live-query truncate recovery now waits for work started
during the replay and keeps partial graph state private after failure until a
later complete replay succeeds, while retired demand cannot block unrelated
graph work. Failed unloads remain retryable cleanup debt without reviving
demand, while preserving the exact acquisition identity for later release.
Unsafe ordered boundaries fall back to full-source loading; an asynchronous
failure waits for a later truncate replay instead of starting duplicate work.
Finite multi-column prefixes revalidate after membership-changing updates.
Ready callbacks keep readiness established when a callback throws, and key
identity remains exact for NaN, binary, reference, function, and symbol values.

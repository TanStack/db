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
last coherent result. Truncate recovery now waits for work started during the
replay and keeps partial state private after failure until a later complete
replay succeeds. Ready callbacks keep
readiness established when a callback throws, and key identity remains exact
for NaN, binary, reference, function, and symbol values.

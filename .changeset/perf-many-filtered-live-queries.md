---
'@tanstack/db': patch
---

Speed up many small filtered live queries. Equality on same-type strings and booleans skips value normalization, eager subscriptions no longer allocate an abort controller per subset demand, and a filtered subscription skips a source batch that no change can match. With 240 `eq`-filtered live queries, mounting is about 30% faster without an index and a 50-row update batch is about 50% faster.

---
'@tanstack/db': patch
---

Use a custom-comparator index for exact lookup without selecting its order for an ordinary Collection `orderBy` read. Select a compatible ordinary index for ordered reads, including live-query window moves with cached rows. Eager indexing creates a compatible index when needed, including for equivalent value-left range predicates.

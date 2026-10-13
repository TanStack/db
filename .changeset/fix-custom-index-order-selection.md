---
'@tanstack/db': patch
---

Use a custom-comparator index for exact lookup without selecting its order for an ordinary Collection `orderBy` read. When a compatible ordinary index also exists, select it for ordered reads; eager indexing now creates one if needed, including for equivalent value-left range predicates.

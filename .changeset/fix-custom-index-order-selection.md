---
'@tanstack/db': patch
---

Use a custom-comparator index for exact lookup without selecting its order for an ordinary Collection `orderBy` read. Select a compatible ordinary index for ordered reads, including live-query window moves with cached rows. Eager indexing creates a compatible index when needed, including for equivalent value-left range predicates. Ordered indexes compare raw row values while exact lookup keeps normalized keys. This preserves custom collation of escaped strings. Default ordering compares native byte views by unsigned content and source-key ties. Equal-content replacements refresh custom index positions without publishing a value change. Changed byte content still publishes when a view shadows its own `length` property.

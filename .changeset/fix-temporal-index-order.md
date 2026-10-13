---
'@tanstack/db': patch
---

Order Temporal values by their calendar or instant semantics in indexed reads. Match ZonedDateTime equality across equivalent time-zone aliases while keeping distinct zones separate, including genuine subclasses. Preserve PlainMonthDay reference years in unindexed equality, and PlainYearMonth reference days and Duration fields in indexed equality, when default display strings collide. Keep Temporal equality when genuine values shadow display members, and reject ordinary objects with forged tags. Preserve custom index comparator operands and per-row order even when values share one query-equality class, including signed zero through updates and BTree ranges. Prevent one Temporal value from changing the comparator used for later values.

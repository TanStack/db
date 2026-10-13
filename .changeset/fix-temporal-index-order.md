---
'@tanstack/db': patch
---

Order Temporal values by their calendar or instant semantics in indexed reads. Match ZonedDateTime equality across equivalent time-zone aliases while keeping distinct zones separate, and preserve custom index comparator inputs. Prevent one Temporal value from changing the comparator used for later values.

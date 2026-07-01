---
'@tanstack/db': patch
---

Support Temporal values in `gt`/`gte`/`lt`/`lte` query operators, using `Temporal.*.compare()` for correct semantic ordering. `orderBy` now uses the same logic, fixing inconsistencies with `Duration` and `ZonedDateTime` values.

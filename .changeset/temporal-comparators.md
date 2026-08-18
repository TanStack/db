---
'@tanstack/db': patch
---

Support Temporal values in the `gt`/`gte`/`lt`/`lte` query operators. Comparisons now dispatch to the Temporal types' static `compare()` instead of the native relational operators, which throw on Temporal objects (`valueOf()` is designed to throw). `orderBy` uses the same logic, so filtering and ordering now agree — previously `orderBy` compared Temporal values lexicographically by their `toString()`, which mis-ordered equivalent `Duration` forms (`PT60M` vs `PT1H`) and same-instant `ZonedDateTime` values in different zones.

Note two intentional behavior changes for `orderBy` over Temporal columns:

- Ordering `Temporal.PlainMonthDay` values now throws a `TypeError`, since the type has no defined ordering (previously they were silently ordered by string).
- Ordering mixed Temporal types (e.g. `PlainDate` vs `PlainDateTime`) now throws a `TypeError` instead of comparing their string forms.

Equality (`eq`) is unchanged: `ZonedDateTime` equality still treats the zone as part of identity, and equivalent `Duration` forms remain unequal, mirroring Temporal's `.equals()` vs `.compare()` semantics.

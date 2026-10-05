---
'@tanstack/db': patch
'@tanstack/db-sqlite-persistence-core': patch
---

Preserve native `Temporal.Instant` and `Temporal.PlainDate` values in SQLite rows, metadata, replay, and expression indexes when Temporal constructors are registered globally. Retain nanosecond precision, calendar identity, and native literals in Collection index metadata.

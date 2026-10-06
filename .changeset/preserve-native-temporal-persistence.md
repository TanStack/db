---
'@tanstack/db': patch
'@tanstack/db-sqlite-persistence-core': patch
---

Preserve native `Temporal.Instant` and `Temporal.PlainDate` values in SQLite rows, metadata, replay, and expression indexes when Temporal constructors are registered globally. Retain nanosecond precision, calendar identity, and native literals in Collection index metadata.

Keep native index signatures distinct from ordinary tagged records, isolate mutable index metadata snapshots, and preserve NUL-bearing literals in SQLite expression indexes. Reuse each native query literal encoding for its order and identity.

Validate remote subset admission without constructing discarded wire snapshots, while preserving fresh coordinator snapshots and the existing wire-value restrictions.

Keep optional persisted index serialization failures inside existing warning boundaries so startup and ordinary reads remain available.

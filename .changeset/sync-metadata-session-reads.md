---
'@tanstack/db': patch
'@tanstack/db-sqlite-persistence-core': patch
'@tanstack/query-db-collection': patch
---

Fix sync metadata reads that missed committed sync writes while an optimistic transaction held them. A sync source now reads its own writes in commit order: `metadata.row.get`, `metadata.collection.get`, and `list()` include committed transactions that have not applied yet, then the open transactions. A transaction begun inside an open one is independent, and a hold no longer changes commit order. A source insert over a different source row is a duplicate even when a seed or a hold is present.

Persisted collections treat cached rows as seeds, so a later `DbClient` seed can replace them, also after another tab's notice makes the collection reload from storage. An insert in the persisted wrapper replaces the row it lands on and writes an `insert` mutation to storage. An equal re-insert keeps the row's metadata without writing it, and the wrapper no longer slows down quadratically with the size of a transaction.

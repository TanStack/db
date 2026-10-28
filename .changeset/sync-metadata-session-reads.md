---
'@tanstack/db': patch
'@tanstack/db-sqlite-persistence-core': patch
'@tanstack/query-db-collection': patch
---

Fix sync metadata reads that missed committed sync writes while an optimistic transaction held them. A sync source now reads its own writes in commit order: `metadata.row.get`, `metadata.collection.get`, and `list()` include committed transactions that have not applied yet, then the open transactions. A transaction begun inside an open one is independent, and a hold no longer changes commit order. A source insert over a different source row is a duplicate even when a seed or a hold is present.

Persisted collections treat cached rows as seeds, so a later `DbClient` seed can replace them, also after another tab's notice makes the collection reload from storage. A reload from another tab's notice keeps a seed accepted during a pending transaction, keeps row metadata of rows that do not exist, and keeps a seed's row metadata unless the notice names it. An update over a `DbClient` seed now stores the whole row the collection shows, so a reload or restart keeps the seed's fields. With `rowUpdateMode: 'full'`, an update now replaces its stored row, so a reload or restart no longer brings back fields the update dropped. A reload deletes rows that storage lacks also while a pending transaction holds them. A schema reset from another tab clears every row and its metadata; in on-demand mode it keeps the `DbClient` seeds the collection holds and still replays demand. An insert in the persisted wrapper replaces the row it lands on and writes an `insert` mutation to storage. An equal re-insert keeps the row's metadata without writing it, and the wrapper no longer slows down quadratically with the size of a transaction.

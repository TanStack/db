---
"@tanstack/db": patch
---

Fix live queries getting stuck during long-running sync commits by always
clearing the batching flag on forced emits, tolerating duplicate insert echoes,
and allowing optimistic recomputes to run while commits are still applying. Adds
regression coverage for concurrent optimistic inserts, queued updates, and the
offline-transactions example to ensure everything stays in sync.

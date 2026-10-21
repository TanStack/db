---
'@tanstack/db-sqlite-persistence-core': patch
---

Reloads no longer repeat setup that is already complete. A reopened persisted collection checks its tables, indexes, triggers, and bookkeeping rows in the same query that reads its registration, and runs its nine setup statements only when something is missing. Each adapter checks database-wide setup with one query and runs it only when a table, index, or migrated column is missing, instead of about 19 statements on every load. The write-only global `schema_version` row, which adapters with different schema versions overwrote on every load, is no longer created or written.

A tab no longer rereads all of a collection's rows after its own write. It used to record the write's stream position before that write's commit notice arrived, so the notice looked like a gap and triggered `pullSince` and a full row scan.

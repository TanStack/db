---
"@tanstack/db": minor
---

Add `$pendingOperation` virtual property to track optimistic mutation type

- New virtual property `$pendingOperation` on every collection row: `'insert' | 'update' | 'delete' | null`
- Items deleted in pending transactions can stay visible in query results when `$pendingOperation` is referenced in a `.where()` clause
- Works with live queries, `createEffect`, joins/subqueries, GROUP BY, and ordered/paginated queries

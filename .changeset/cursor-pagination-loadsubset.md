---
"@tanstack/db": patch
"@tanstack/electric-db-collection": patch
"@tanstack/query-db-collection": patch
---

Enhanced LoadSubsetOptions with separate cursor expressions and offset for flexible pagination.

**⚠️ Breaking Change for Custom Sync Layers / Query Collections:**

`LoadSubsetOptions.where` no longer includes cursor expressions for pagination. If you have a custom sync layer or query collection that implements `loadSubset`, you must now handle pagination separately:

- **Cursor-based pagination:** Use the new `cursor` property (`cursor.whereFrom` and `cursor.whereCurrent`) and combine them with `where` yourself
- **Offset-based pagination:** Use the new `offset` property

Previously, cursor expressions were baked into the `where` clause. Now they are passed separately so sync layers can choose their preferred pagination strategy.

**Changes:**

- Added `CursorExpressions` type with `whereFrom`, `whereCurrent`, and optional `lastKey` properties
- Added `cursor` to `LoadSubsetOptions` for cursor-based pagination (separate from `where`)
- Added `offset` to `LoadSubsetOptions` for offset-based pagination support
- Electric sync layer now makes two parallel `requestSnapshot` calls when cursor is present:
  - One for `whereCurrent` (all ties at boundary, no limit)
  - One for `whereFrom` (rows after cursor, with limit)
- Query collection serialization now includes `offset` for query key generation
- Added `truncate` event to collections, emitted when synced data is truncated (e.g., after `must-refetch`)
- Fixed `setWindow` pagination: cursor expressions are now correctly built when paging through results
- Fixed offset tracking: `loadNextItems` now passes the correct window offset to prevent incorrect deduplication
- `CollectionSubscriber` now listens for `truncate` events to reset cursor tracking state

**Benefits:**

- Sync layers can choose between cursor-based or offset-based pagination strategies
- Electric can efficiently handle tie-breaking with two targeted requests
- Better separation of concerns between filtering (`where`) and pagination (`cursor`/`offset`)
- `setWindow` correctly triggers backend loading for subsequent pages in multi-column orderBy queries
- Cursor state is properly reset after truncation, preventing stale cursor data from being used

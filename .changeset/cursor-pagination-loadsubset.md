---
"@tanstack/db": patch
"@tanstack/electric-db-collection": patch
"@tanstack/query-db-collection": patch
---

Enhanced LoadSubsetOptions with separate cursor expressions and offset for flexible pagination.

**Changes:**

- Added `CursorExpressions` type with `whereFrom`, `whereCurrent`, and `lastKey` properties
- `LoadSubsetOptions.where` no longer includes cursor expressions - these are now passed separately via `cursor`
- Added `offset` to `LoadSubsetOptions` for offset-based pagination support
- Electric sync layer now makes two parallel `requestSnapshot` calls when cursor is present:
  - One for `whereCurrent` (all ties at boundary, no limit)
  - One for `whereFrom` (rows after cursor, with limit)
- Query collection serialization now includes `offset` for query key generation

**Benefits:**

- Sync layers can choose between cursor-based or offset-based pagination strategies
- Electric can efficiently handle tie-breaking with two targeted requests
- Better separation of concerns between filtering (`where`) and pagination (`cursor`/`offset`)

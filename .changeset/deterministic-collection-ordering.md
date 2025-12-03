---
"@tanstack/db": patch
---

Ensure deterministic iteration order for collections and indexes.

**SortedMap improvements:**

- Added key-based tie-breaking when values compare as equal, ensuring deterministic ordering
- Optimized to skip value comparison entirely when no comparator is provided (key-only sorting)
- Extracted `compareKeys` utility to `utils/comparison.ts` for reuse

**BTreeIndex improvements:**

- Keys within the same indexed value are now returned in deterministic sorted order
- Optimized with fast paths for empty sets and single-key sets to avoid unnecessary allocations

**CollectionStateManager changes:**

- Collections now always use `SortedMap` for `syncedData`, ensuring deterministic iteration order
- When no `compare` function is provided, entries are sorted by key only

This ensures that live queries with `orderBy` and `limit` produce stable, deterministic results even when multiple rows have equal sort values.

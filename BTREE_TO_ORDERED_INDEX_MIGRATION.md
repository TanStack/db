# BTreeIndex → OrderedIndex Migration Summary

## Overview

The `BTreeIndex` class has been renamed to `OrderedIndex` to better reflect its actual implementation. Despite its name, the original `BTreeIndex` was not implementing a true B-tree data structure, but rather a sorted array-based index that provides ordered access and range queries.

## Changes Made

### 1. Core Files Renamed/Created

- **Created**: `packages/db/src/indexes/ordered-index.ts` (replaces `btree-index.ts`)
- **Deleted**: `packages/db/src/indexes/btree-index.ts`

### 2. Class and Interface Renames

- `BTreeIndex` → `OrderedIndex`
- `BTreeOptions` → `OrderedIndexOptions`

### 3. Export Updates

**Updated exports in `packages/db/src/index.ts`:**
- Exports `OrderedIndex` and `OrderedIndexOptions` 
- Provides backward compatibility aliases:
  - `BTreeIndex` (alias for `OrderedIndex`)
  - `BTreeOptions` (alias for `OrderedIndexOptions`)

**Updated index types in `packages/db/src/indexes/index-types.ts`:**
- Primary export: `IndexTypes.Ordered` 
- Backward compatibility: `IndexTypes.BTree` (alias for `OrderedIndex`)

### 4. Collection API Updates

**In `packages/db/src/collection.ts`:**
- Default index type changed from `BTreeIndex` to `OrderedIndex`
- Updated method calls to use unified `lookup()` method instead of deprecated `equalityLookup()` and `rangeQuery()` methods
- Removed unused optimization methods that were causing TypeScript warnings

### 5. Demo and Documentation Updates

**Updated `index-demo.ts`:**
- Shows both new `OrderedIndex` usage and backward compatibility with `BTreeIndex`
- Demonstrates the new `IndexTypes.Ordered` alongside `IndexTypes.BTree` for compatibility

### 6. Stub Files for Future Index Types

Created placeholder implementations for future index types:
- `trigram-index.ts` - for full-text trigram search
- `fulltext-index.ts` - for full-text search  
- `hash-index.ts` - for fast equality lookups

## Backward Compatibility

✅ **Full backward compatibility maintained**

Existing code using `BTreeIndex` will continue to work without any changes:

```typescript
// This still works (backward compatibility)
const index = collection.createIndex(row => row.age, {
  indexType: BTreeIndex,
  name: 'age_index'
})

// New recommended approach
const index = collection.createIndex(row => row.age, {
  indexType: OrderedIndex,
  name: 'age_index'  
})

// Also works with convenience types
const index = collection.createIndex(row => row.age, {
  indexType: IndexTypes.BTree,     // Still works
  indexType: IndexTypes.Ordered,  // New preferred way
})
```

## Implementation Details

The `OrderedIndex` maintains the same functionality as the original `BTreeIndex`:

- **Sorted storage**: Items stored in sorted order for efficient range queries
- **Range operations**: Supports `eq`, `gt`, `gte`, `lt`, `lte`, `in` operations
- **Binary search**: Uses binary search for O(log n) insertions and lookups
- **Memory efficient**: Maintains same memory usage patterns

## Migration Recommendation

While existing code will continue to work, new code should use:

1. `OrderedIndex` instead of `BTreeIndex`
2. `IndexTypes.Ordered` instead of `IndexTypes.BTree`
3. `OrderedIndexOptions` instead of `BTreeOptions`

## Future Plans

This change paves the way for adding a true B-tree index implementation in the future, which will provide better performance characteristics for certain use cases while avoiding naming conflicts.

## Tests

All existing tests pass without modification, confirming that:
- ✅ Functionality is preserved
- ✅ API compatibility is maintained  
- ✅ Performance characteristics are unchanged
- ✅ No breaking changes introduced
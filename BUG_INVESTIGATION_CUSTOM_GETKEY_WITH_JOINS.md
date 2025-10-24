# Bug Investigation: Custom getKey with Joined Queries

**Date:** 2025-10-24
**Issue:** CollectionOperationError and TransactionError when using custom `getKey` with joined queries

## User Report

A user reported the following errors after switching from a function-based constructor to an object-based constructor with a custom `getKey`:

```
client.ts:1032 Uncaught CollectionOperationError: Cannot insert document with key "693892a1-4d2e-4f8d-9c05-9e9c5c667ca1" from sync because it already exists in the collection "live-query-1"

client.ts:1032 Uncaught TransactionError: The pending sync transaction is already committed, you can't commit it again.
```

### User's Code Change

**Before (working):**
```typescript
export const mediaCollection = createLiveQueryCollection((q) =>
  q.from({ media: mediaCollectionBase })
    .orderBy(({ media }) => media.created_at, 'desc')
    .join({ metadata: metadataCollection }, ({ media, metadata }) => eq(media.id, metadata.id), 'left')
    .select(({ media, metadata }) => ({
      ...media,
      metadata,
    }))
);
```

**After (broken):**
```typescript
export const mediaCollection = createLiveQueryCollection({
  query: (q) => q.from({ media: mediaCollectionBase })
    .orderBy(({ media }) => media.created_at, 'desc')
    .join({ metadata: metadataCollection }, ({ media, metadata }) => eq(media.id, metadata.id), 'left')
    .select(({ media, metadata }) => ({
      ...media,
      metadata,
    })),
  getKey: (media) => media.id, // ⚠️ This causes the issue
});
```

## Root Cause Analysis

### Composite Keys in Joined Queries

When joining two collections, the internal differential dataflow system creates a **composite key** that combines keys from both collections:

**Code Reference:** `/home/user/db/packages/db/src/query/compiler/joins.ts:574`

```typescript
// We create a composite key that combines the main and joined keys
const resultKey = `[${mainKey},${joinedKey}]`
```

For example, if `media.id = "uuid1"` and `metadata.id = "uuid2"`, the composite key becomes `"[uuid1,uuid2]"`.

### How Default getKey Works

**Code Reference:** `/home/user/db/packages/db/src/query/live/collection-config-builder.ts:181-183`

```typescript
getKey:
  this.config.getKey ||
  ((item) => this.resultKeys.get(item) as string | number)
```

When no custom `getKey` is provided:
1. The composite key from the DD stream is stored in a `WeakMap` called `resultKeys`
2. The default `getKey` function retrieves this composite key from the `WeakMap`
3. This ensures consistency between the sync system and the collection

**Code Reference:** `/home/user/db/packages/db/src/query/live/collection-config-builder.ts:666`

```typescript
// Store the key of the result so that we can retrieve it in the
// getKey function
this.resultKeys.set(value, key)
```

### The Problem with Custom getKey

When a custom `getKey` is provided for a joined query:

1. **The sync system** uses the composite key `"[uuid1,uuid2]"` from the DD stream
2. **The collection** uses the custom key (e.g., `media.id = "uuid1"`)
3. **This creates a mismatch:**
   - Sync thinks item's key is `"[uuid1,uuid2]"`
   - Collection thinks item's key is `"uuid1"`
4. **Result:** When sync tries to insert with composite key, the collection may already have an entry with the simple key → **duplicate key error**

## Why This Cannot Be Fixed

Joined query results don't have a single "natural" primary key because:

1. **Multiple join results can share the same base key:** One media row could join with multiple metadata rows in different scenarios
2. **Uniqueness requires both keys:** The unique identity of a joined result is the **combination** of both collection keys
3. **Using just one key causes collisions:** Multiple different joined results could map to the same simple key

## Solution

**For joined queries, do NOT provide a custom `getKey`.** Use the default composite key behavior:

```typescript
// ✅ CORRECT
export const mediaCollection = createLiveQueryCollection({
  query: (q) => q.from({ media: mediaCollectionBase })
    .orderBy(({ media }) => media.created_at, 'desc')
    .join({ metadata: metadataCollection }, ({ media, metadata }) => eq(media.id, metadata.id), 'left')
    .select(({ media, metadata }) => ({
      ...media,
      metadata,
    })),
  // No getKey - uses default composite key
});
```

### Accessing Items by ID

If you need to find items by a specific field (like `media.id`), use:

1. **Array methods:** `mediaCollection.toArray.find(item => item.id === 'uuid1')`
2. **Queries/filters:** Create a separate query or use collection filtering
3. **Don't use `.get()`** with a simple ID on joined collections

## Implemented Runtime Validation

Runtime validation has been added to prevent this error from occurring. The validation:

1. **Detects joins recursively:** Checks the query and all nested subqueries for joins
2. **Fails fast:** Throws `CustomGetKeyWithJoinError` immediately during collection creation
3. **Provides clear guidance:** Error message explains the issue and suggests alternatives

**Implementation Details:**

- New error class: `CustomGetKeyWithJoinError` in `/home/user/db/packages/db/src/errors.ts`
- Validation in: `CollectionConfigBuilder` constructor in `/home/user/db/packages/db/src/query/live/collection-config-builder.ts`
- Method: `hasJoins()` recursively checks query tree for any joins

**Error Message:**
```
Custom getKey is not supported for queries with joins. Joined queries use composite keys
internally (e.g., "[key1,key2]") to ensure uniqueness. Remove the getKey option and use
the default key behavior, or use array methods like .toArray.find() to locate items by
field instead of .get().
```

## Future Enhancements

Consider adding:

1. **TypeScript warning:** Type-level error when `getKey` is provided with a joined query
2. **Documentation:** Clearly document in API docs that custom `getKey` is not supported for joined queries

## Test Cases

Test cases have been added to `/home/user/db/packages/db/tests/query/live-query-collection.test.ts`:

1. **Positive test:** Demonstrates correct usage without custom `getKey` - works as expected
2. **Negative test (direct join):** Verifies error is thrown when custom `getKey` is used with a joined query
3. **Negative test (nested subquery):** Verifies error is thrown when custom `getKey` is used with a nested subquery containing joins

## Files Modified

- `/home/user/db/packages/db/src/errors.ts` - Added `CustomGetKeyWithJoinError` class
- `/home/user/db/packages/db/src/query/live/collection-config-builder.ts` - Added runtime validation in constructor and `hasJoins()` helper method
- `/home/user/db/packages/db/tests/query/live-query-collection.test.ts` - Added test cases demonstrating correct usage and validating error handling

## Related Code References

- `/home/user/db/packages/db/src/query/compiler/joins.ts:574` - Composite key creation
- `/home/user/db/packages/db/src/query/live/collection-config-builder.ts:181-183` - Default getKey
- `/home/user/db/packages/db/src/query/live/collection-config-builder.ts:666` - Key storage in WeakMap

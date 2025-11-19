# Root Cause Analysis for Issue #821

I've investigated this bug and identified the exact root cause:

## Location
**File**: `packages/query-db-collection/src/query.ts:1047-1059`

## The Problem

The mutation wrapper handlers (`wrappedOnUpdate`, `wrappedOnInsert`, `wrappedOnDelete`) call `refetch()` without any parameters:

```typescript
const wrappedOnUpdate = onUpdate
  ? async (params: UpdateMutationFnParams<any>) => {
      const handlerResult = (await onUpdate(params)) ?? {}
      const shouldRefetch =
        (handlerResult as { refetch?: boolean }).refetch !== false

      if (shouldRefetch) {
        await refetch()  // ← NO PARAMETERS - uses original query!
      }

      return handlerResult
    }
  : undefined
```

The `refetch()` function (lines 985-995) then refetches **all query observers** with their **original query parameters**:

```typescript
const refetch: RefetchFn = async (opts) => {
  const queryKeys = [...hashToQueryKey.values()]
  const refetchPromises = queryKeys.map((queryKey) => {
    const queryObserver = state.observers.get(hashKey(queryKey))!
    return queryObserver.refetch({
      throwOnError: opts?.throwOnError,
    })
  })

  await Promise.all(refetchPromises)
}
```

This means the system re-executes the original query **including `orderBy` and `limit`** instead of fetching just the mutated item by ID.

## Missing Information

The mutation params contain all necessary information but it's not being used:

```typescript
// Available in params.transaction.mutations[]:
{
  key: any,         // ← THE ITEM ID!
  modified: T,
  original: T,
  changes: {...},
  // ...
}
```

The item IDs are available in `params.transaction.mutations.map(m => m.key)` but this information is never passed to the `refetch()` function.

## What Should Happen

For on-demand mode, the refetch should:

1. **Extract mutated item IDs**: `params.transaction.mutations.map(m => m.key)`
2. **Create a targeted WHERE clause**: `{ type: 'eq', args: [{ path: ['id'] }, { value: itemId }] }`
3. **Build `LoadSubsetOptions`** with **only** the WHERE clause (no `orderBy`, no `limit`)
4. **Fetch only those specific items** and merge them back into the collection

This would:
- Fetch only the changed item for verification
- Update that specific item in the collection
- Preserve previously loaded items
- Only remove items actually deleted via `collection.delete()`

## Infrastructure Already Exists

The codebase has the pieces needed for a fix:

✅ `LoadSubsetOptions` supports `where` clauses (types.ts:237-253)
✅ `createQueryFromOpts` can create queries from options (query.ts:624-631)
✅ Mutation info available in `params.transaction.mutations`
✅ Expression system exists for building WHERE clauses

❌ **Missing**: Logic to build targeted queries from mutation keys in refetch handlers

## Affected Handlers

All three mutation handlers have this issue:
- `wrappedOnInsert` (lines 1033-1045) - Should fetch newly inserted items by ID
- `wrappedOnUpdate` (lines 1047-1059) - Should fetch updated items by ID
- `wrappedOnDelete` (lines 1061-1073) - Less critical but same pattern

## Proposed Solution

Modify the `refetch()` function to accept optional mutation keys and create targeted queries when in on-demand mode:

```typescript
const refetch: RefetchFn = async (opts, mutatedKeys?) => {
  if (mutatedKeys && mutatedKeys.length > 0) {
    // Create targeted query for specific items
    // Build WHERE clause: id IN (mutatedKeys)
    const targetedWhere = {
      type: 'in',
      args: [
        { path: ['id'] },
        { value: mutatedKeys }
      ]
    }

    const targetedOpts: LoadSubsetOptions = {
      where: targetedWhere,
      // NO orderBy, NO limit - just fetch these specific items
    }

    // Create and execute targeted query
    await createQueryFromOpts(targetedOpts)
  } else {
    // Existing behavior - refetch all observers
    const queryKeys = [...hashToQueryKey.values()]
    const refetchPromises = queryKeys.map((queryKey) => {
      const queryObserver = state.observers.get(hashKey(queryKey))!
      return queryObserver.refetch({
        throwOnError: opts?.throwOnError,
      })
    })
    await Promise.all(refetchPromises)
  }
}
```

Then update the mutation wrappers to pass the mutation keys:

```typescript
const wrappedOnUpdate = onUpdate
  ? async (params: UpdateMutationFnParams<any>) => {
      const handlerResult = (await onUpdate(params)) ?? {}
      const shouldRefetch =
        (handlerResult as { refetch?: boolean }).refetch !== false

      if (shouldRefetch) {
        const mutatedKeys = params.transaction.mutations.map(m => m.key)
        await refetch(undefined, mutatedKeys)
      }

      return handlerResult
    }
  : undefined
```

This would preserve the existing behavior for eager mode while fixing the data consistency issue in on-demand mode.

## Impact

**Severity: High** for on-demand mode

This is a data consistency issue that causes:
- Stale data in the collection (never receives server confirmation)
- Items disappearing unexpectedly (fall outside limit range)
- Increased network usage (fetching N items instead of 1)

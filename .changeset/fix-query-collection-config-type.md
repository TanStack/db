---
"@tanstack/query-db-collection": patch
---

Fix TypeScript type resolution for QueryCollectionConfig when using queryCollectionOptions without a schema.

Previously, the `QueryCollectionConfig` interface extended `BaseCollectionConfig`, but TypeScript failed to resolve inherited properties like `getKey`, `onInsert`, `onUpdate`, etc. when the interface contained a conditional type for the `queryFn` property. This caused type errors when trying to use `queryCollectionOptions` without a schema.

**Before:**

```typescript
// This would fail with TypeScript error:
// "Property 'getKey' does not exist on type 'QueryCollectionConfig<...>'"
const options = queryCollectionOptions({
  queryKey: ["todos"],
  queryFn: async (): Promise<Array<Todo>> => {
    const response = await fetch("/api/todos")
    return response.json()
  },
  queryClient,
  getKey: (item) => item.id, // ❌ Type error
})
```

**After:**

```typescript
// Now works correctly!
const options = queryCollectionOptions({
  queryKey: ["todos"],
  queryFn: async (): Promise<Array<Todo>> => {
    const response = await fetch("/api/todos")
    return response.json()
  },
  queryClient,
  getKey: (item) => item.id, // ✅ Works
})

const collection = createCollection(options) // ✅ Fully typed
```

**Changes:**

- Changed `QueryCollectionConfig` to use `Omit<BaseCollectionConfig<...>, 'onInsert' | 'onUpdate' | 'onDelete'>` pattern
- This matches the approach used by `ElectricCollectionConfig` and `PowerSyncCollectionConfig` for consistency
- Explicitly declares mutation handlers with custom return type `{ refetch?: boolean }`
- This resolves the TypeScript type resolution issue with conditional types
- All functionality remains the same - this is purely a type-level fix
- Added test cases to verify the no-schema use case works correctly

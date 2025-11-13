# Investigation: Supporting Pagination Metadata in queryCollectionOptions

## Issue Summary

A Discord user (Amir Hoseinian) requested a way to return extra pagination info alongside the data array from `queryFn` in TanStack Table integration. Their API returns:

```typescript
{
  data: object[]
  pagination_info: { total_count: number }
}
```

Currently, `queryFn` in `queryCollectionOptions` only allows returning an array of objects, forcing users to duplicate metadata into every item:

```typescript
queryFn: async (ctx) => {
  const { data } = await client.v1.getApiContacts(...)

  // Hack: duplicate total_count into every item
  return data.response?.data?.map((contact) => ({
    ...contact,
    total_count: data.response?.pagination?.total_count,
  })) ?? []
}
```

## Current Implementation

### Files Examined
- `/home/user/db/packages/query-db-collection/src/query.ts` (lines 59-200, 520-770)
- `/home/user/db/packages/query-db-collection/tests/query.test.ts` (lines 451-570)
- `/home/user/db/docs/collections/query-collection.md` (lines 296-325)

### How It Works Today

1. **The `select` Function** (line 79 in query.ts):
   ```typescript
   /* Function that extracts array items from wrapped API responses (e.g metadata, pagination) */
   select?: (data: TQueryData) => Array<T>
   ```

2. **Query Result Handling** (lines 733-746):
   ```typescript
   const rawData = result.data
   const newItemsArray = select ? select(rawData) : rawData
   ```
   - The full response (including metadata) IS cached in TanStack Query
   - The `select` function extracts just the array portion
   - Only the array is stored in the collection

3. **Test Evidence** (lines 542-570 in query.test.ts):
   ```typescript
   it(`Whole response is cached in QueryClient when used with select option`, async () => {
     // ...
     const initialCache = queryClient.getQueryData(queryKey) as MetaDataType<TestItem>
     expect(initialCache).toEqual(initialMetaData) // Full response with metadata!
   })
   ```

### Current Workaround

Users can access metadata via `queryClient.getQueryData(queryKey)`:

```typescript
const collection = createCollection(
  queryCollectionOptions({
    queryKey: ['contacts'],
    queryFn: async () => {
      const res = await api.getContacts()
      return res // { data: [...], pagination_info: { total_count: 100 } }
    },
    select: (data) => data.data,
    queryClient,
    getKey: (item) => item.id,
  })
)

// In component:
const cachedResponse = queryClient.getQueryData(['contacts'])
const totalCount = cachedResponse?.pagination_info?.total_count
```

**Problems with this approach:**
- Not documented or discoverable
- Not reactive (doesn't trigger re-renders)
- Requires direct queryClient access
- Awkward to use with TanStack Table
- Breaks encapsulation (consumers need to know the queryKey)

## Potential Solutions

### Option 1: Add `queryData` to QueryCollectionUtils ⭐ RECOMMENDED

Expose the full query response through the collection utils:

```typescript
interface QueryCollectionUtils<TItem, TKey, TInsertInput, TError, TQueryData> {
  // ... existing properties (refetch, writeInsert, etc.)

  /** The full query response data including metadata */
  queryData: TQueryData | undefined
}
```

**Usage:**
```typescript
const collection = createCollection(
  queryCollectionOptions({
    queryKey: ['contacts'],
    queryFn: async () => {
      const res = await api.getContacts()
      return { data: res.data, totalCount: res.pagination.total_count }
    },
    select: (data) => data.data,
    queryClient,
    getKey: (item) => item.id,
  })
)

// In TanStack Table:
const totalCount = collection.utils.queryData?.totalCount
```

**Pros:**
- ✅ Clean, discoverable API
- ✅ Reactive (updates when query refetches)
- ✅ Easy to access in components
- ✅ Natural fit with existing utils
- ✅ Non-breaking addition
- ✅ TypeScript provides full type safety

**Cons:**
- ⚠️ Adds another generic type parameter to QueryCollectionUtils
- ⚠️ May be unclear what `queryData` contains vs collection data

**Implementation Notes:**
- Store `rawData` from line 733 in query.ts
- Add to state object and expose via utils
- Make reactive using the same pattern as other utils properties

---

### Option 2: Add `selectMeta` Function

Allow users to extract metadata separately:

```typescript
interface QueryCollectionConfig<...> {
  select?: (data: TQueryData) => Array<T>
  selectMeta?: (data: TQueryData) => TMeta
}

interface QueryCollectionUtils<...> {
  meta: TMeta | undefined
}
```

**Usage:**
```typescript
const collection = createCollection(
  queryCollectionOptions({
    queryFn: async () => api.getContacts(),
    select: (data) => data.data,
    selectMeta: (data) => ({ totalCount: data.pagination.total_count }),
    // ...
  })
)

const totalCount = collection.utils.meta?.totalCount
```

**Pros:**
- ✅ More explicit about what's metadata
- ✅ User controls what to expose
- ✅ Smaller API surface

**Cons:**
- ⚠️ Requires writing another function
- ⚠️ More configuration needed
- ⚠️ Less flexible (what if you need different metadata in different places?)

---

### Option 3: Document the Workaround

Simply document that users can access `queryClient.getQueryData(queryKey)`.

**Pros:**
- ✅ No code changes needed
- ✅ Works today

**Cons:**
- ❌ Not reactive in components
- ❌ Requires queryClient access
- ❌ Not discoverable
- ❌ Awkward with TanStack Table
- ❌ Doesn't solve the user's problem

---

### Option 4: Change queryFn Return Type (NOT RECOMMENDED)

Allow queryFn to return `{ data: Array<T>, meta: any }`:

**Cons:**
- ❌ Breaking change
- ❌ Conflicts with existing `select` pattern
- ❌ Less flexible

---

## Recommendation

**Implement Option 1: Add `queryData` to QueryCollectionUtils**

This is the best solution because:
1. It's a non-breaking addition
2. It provides a clean, reactive API
3. It works naturally with the existing `select` pattern
4. It's discoverable through TypeScript autocomplete
5. It solves the user's TanStack Table use case perfectly

### Implementation Plan

1. **Update QueryCollectionUtils interface** (query.ts:154-200):
   ```typescript
   export interface QueryCollectionUtils<
     TItem extends object = Record<string, unknown>,
     TKey extends string | number = string | number,
     TInsertInput extends object = TItem,
     TError = unknown,
     TQueryData = any, // NEW
   > extends UtilsRecord {
     // ... existing properties

     /** The full query response data including metadata from queryFn */
     queryData: TQueryData | undefined
   }
   ```

2. **Update internal state** (query.ts:~203):
   ```typescript
   interface QueryCollectionState<TError> {
     queryObserver: QueryObserver | null
     unsubscribe: (() => void) | null
     lastError: TError | undefined
     errorCount: number
     queryData: any | undefined // NEW
   }
   ```

3. **Store queryData in handleQueryResult** (query.ts:733):
   ```typescript
   const handleQueryResult: UpdateHandler = (result) => {
     if (result.isSuccess) {
       const rawData = result.data
       state.queryData = rawData // NEW
       const newItemsArray = select ? select(rawData) : rawData
       // ... rest of the logic
     }
   }
   ```

4. **Expose via utils** (query.ts:~900+):
   ```typescript
   queryData: state.queryData,
   ```

5. **Add tests** (query.test.ts):
   - Test that queryData is accessible via utils
   - Test that it updates reactively
   - Test with and without select
   - Test TypeScript types

6. **Update documentation** (docs/collections/query-collection.md):
   - Document the queryData property
   - Show example with pagination metadata
   - Show TanStack Table integration example

## Example Usage After Implementation

```typescript
// API Setup
const contactsCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['contacts'],
    queryFn: async (ctx) => {
      const parsed = parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions)
      const res = await client.v1.getApiContacts({
        offset: 0,
        limit: parsed.limit,
        sort_field: parsed.sorts[0]?.field[0],
        sort_direction: parsed.sorts[0]?.direction,
      }, { signal: ctx.signal })

      // Return full response - no more duplication!
      return {
        data: res.data.response?.data ?? [],
        totalCount: res.data.response?.pagination?.total_count ?? 0,
      }
    },
    select: (response) => response.data,
    queryClient,
    getKey: (contact) => contact.id,
  })
)

// TanStack Table Component
function ContactsTable() {
  const contacts = useLiveQuery(contactsCollection)
  const totalCount = contactsCollection.utils.queryData?.totalCount ?? 0

  return (
    <div>
      <p>Total contacts: {totalCount}</p>
      <Table data={contacts} />
    </div>
  )
}
```

## Breaking Changes

None - this is a non-breaking addition.

## Alternative Approaches Considered

We could also add a subscription mechanism for metadata changes, but that seems over-engineered for this use case. The simpler approach of exposing `queryData` on utils should be sufficient.

## Questions to Resolve

1. Should we add `queryData` to the base `UtilsRecord` interface or only to `QueryCollectionUtils`?
   - **Answer**: Only to `QueryCollectionUtils`, as it's specific to query collections

2. Should we rename it to something more specific like `fullQueryResponse` or `rawQueryData`?
   - **Answer**: `queryData` matches TanStack Query's naming convention (`queryClient.getQueryData`)

3. Should we expose the TanStack Query's full `QueryObserverResult` instead?
   - **Answer**: No, just the data. Users already have access to `isFetching`, `isLoading`, etc. through existing utils properties

## Related Issues/PRs

- PR #551: Added the `select` function to extract arrays from wrapped responses
- This feature request builds on that foundation

---

**Status**: Investigation complete, awaiting decision on implementation approach.

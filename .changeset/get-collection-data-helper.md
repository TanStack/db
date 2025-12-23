---
"@tanstack/db": minor
---

Add type-safe data access helpers for single/array result collections

Adds new methods and functions to eliminate type assertions when working with collections that may return single results or arrays based on whether `findOne()` was used in the query:

1. `collection.toDataWhenReady()` - Instance method that waits for data and returns appropriately
2. `getCollectionData(collection)` - Sync helper with proper type narrowing
3. `getCollectionDataWhenReady(collection)` - Async helper with proper type narrowing

```typescript
// For a single-result query (findOne)
const userQuery = createLiveQueryCollection((q) =>
  q.from({ users }).where(({ users }) => eq(users.id, 1)).findOne()
)
const user = await getCollectionDataWhenReady(userQuery) // type: User | undefined

// For an array-result query
const usersQuery = createLiveQueryCollection((q) =>
  q.from({ users }).where(({ users }) => eq(users.active, true))
)
const users = await getCollectionDataWhenReady(usersQuery) // type: User[]
```

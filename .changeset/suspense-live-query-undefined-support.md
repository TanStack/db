---
"@tanstack/react-db": patch
---

Allow `useLiveSuspenseQuery` to accept `undefined` to disable queries, matching `useLiveQuery` behavior.

`useLiveSuspenseQuery` now supports conditional queries by accepting query functions that can return `undefined` or `null`. When the query function returns `undefined`, the hook returns `undefined` values without suspending, instead of throwing an error.

**Before:**

```typescript
// This would throw an error
useLiveSuspenseQuery(
  (q) => userId
    ? q.from({ users }).where(({ users }) => eq(users.id, userId)).findOne()
    : undefined,
  [userId]
)
// Error: useLiveSuspenseQuery does not support disabled queries
```

**After:**

```typescript
// Now works correctly - returns undefined when userId is not set
const { data } = useLiveSuspenseQuery(
  (q) => userId
    ? q.from({ users }).where(({ users }) => eq(users.id, userId)).findOne()
    : undefined,
  [userId]
)
// data is undefined when userId is undefined, without suspending
```

This change makes `useLiveSuspenseQuery` consistent with `useLiveQuery` and enables conditional query patterns that are common in React applications.

---
'@tanstack/svelte-db': minor
---

Add `findOne()` / `SingleResult` support to `useLiveQuery` hook.

When using `.findOne()` in a query, the `data` property is now correctly typed as `T | undefined` instead of `Array<T>`, matching the React implementation.

**Example:**

```ts
const query = useLiveQuery((q) =>
  q
    .from({ users: usersCollection })
    .where(({ users }) => eq(users.id, userId))
    .findOne(),
)

// query.data is now typed as User | undefined (not User[])
```

This works with all query patterns:

- Query functions: `useLiveQuery((q) => q.from(...).findOne())`
- Config objects: `useLiveQuery({ query: (q) => q.from(...).findOne() })`
- Pre-created collections with `SingleResult`

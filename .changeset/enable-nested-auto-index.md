---
"@tanstack/db": patch
---

Enable auto-indexing for nested field paths

Previously, auto-indexes were only created for top-level fields. Queries filtering on nested fields like `vehicleDispatch.date` or `profile.score` were forced to perform full table scans, causing significant performance issues.

Now, auto-indexes are automatically created for nested field paths of any depth when using `eq()`, `gt()`, `gte()`, `lt()`, `lte()`, or `in()` operations.

**Performance Impact:**

Before this fix, filtering on nested fields resulted in expensive full scans:

- Query time: ~353ms for 39 executions (from issue #727)
- "graph run" and "d2ts join" operations dominated execution time

After this fix, nested field queries use indexes:

- Query time: Sub-millisecond (typical indexed lookup)
- Proper index utilization verified through query optimizer

**Example:**

```typescript
const collection = createCollection({
  getKey: (item) => item.id,
  autoIndex: "eager", // default
  // ... sync config
})

// These now automatically create and use indexes:
collection.subscribeChanges((items) => console.log(items), {
  whereExpression: eq(row.vehicleDispatch?.date, "2024-01-01"),
})

collection.subscribeChanges((items) => console.log(items), {
  whereExpression: gt(row.profile?.stats.rating, 4.5),
})
```

**Index Naming:**

Auto-indexes for nested paths use the format `auto:field.path` to avoid naming conflicts:

- `auto:status` for top-level field `status`
- `auto:profile.score` for nested field `profile.score`
- `auto:metadata.stats.views` for deeply nested field `metadata.stats.views`

Fixes #727

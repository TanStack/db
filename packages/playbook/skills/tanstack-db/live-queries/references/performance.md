# Performance

Understand how live queries achieve sub-millisecond updates and how to optimize for large datasets.

## How Incremental Updates Work

TanStack DB uses differential dataflow (via d2ts). Instead of re-running queries when data changes, it:

1. Tracks what changed (insert, update, delete)
2. Propagates only the delta through the query pipeline
3. Updates results incrementally

**Result:** Updating one row in a sorted 100k collection takes ~0.7ms on an M1 Pro.

## Benchmarks

| Operation      | 100 items | 10k items | 100k items |
| -------------- | --------- | --------- | ---------- |
| Single update  | <0.1ms    | ~0.3ms    | ~0.7ms     |
| Filter change  | <0.1ms    | ~1ms      | ~5ms       |
| Full re-render | ~1ms      | ~50ms     | ~500ms     |

## Optimization Strategies

### 1. Use Expressions Over Functional Variants

```tsx
// ✅ Optimizable
.where(({ user }) => eq(user.active, true))

// ❌ Not optimizable
.fn.where((row) => row.user.active === true)
```

### 2. Filter Early

Reduce data before expensive operations:

```tsx
// ✅ Better: filter first
const { data } = useLiveQuery((q) =>
  q
    .from({ order: ordersCollection })
    .where(({ order }) => eq(order.status, 'completed'))
    .join({ user: usersCollection }, ...)
)

// ❌ Worse: join everything then filter
const { data } = useLiveQuery((q) =>
  q
    .from({ order: ordersCollection })
    .join({ user: usersCollection }, ...)
    .where(({ order }) => eq(order.status, 'completed'))
)
```

### 3. Use Derived Collections for Reuse

Cache intermediate results:

```tsx
// Create once, reuse everywhere
const activeUsers = createLiveQueryCollection((q) =>
  q
    .from({ user: usersCollection })
    .where(({ user }) => eq(user.active, true))
)

// Fast: uses cached result
const userPosts = useLiveQuery((q) =>
  q.from({ user: activeUsers }).join(...)
)

// Fast: same cached result
const userComments = useLiveQuery((q) =>
  q.from({ user: activeUsers }).join(...)
)
```

### 4. Limit Result Sets

Don't load more than needed:

```tsx
// ✅ Paginated
const { data } = useLiveQuery((q) =>
  q
    .from({ item: itemsCollection })
    .orderBy(({ item }) => item.createdAt, 'desc')
    .limit(50),
)

// ❌ Loading everything
const { data } = useLiveQuery((q) => q.from({ item: itemsCollection }))
```

### 5. Use On-Demand Sync Mode

For large datasets, let queries drive loading:

```tsx
const collection = createCollection(
  queryCollectionOptions({
    syncMode: 'on-demand', // Only load what queries need
    queryFn: async (ctx) => {
      const params = parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions)
      return api.getItems(params)
    },
  }),
)
```

### 6. Selective Field Loading

Only select fields you need:

```tsx
// ✅ Only needed fields
const { data } = useLiveQuery((q) =>
  q.from({ user: usersCollection }).select(({ user }) => ({
    id: user.id,
    name: user.name,
  })),
)

// ❌ All fields (includes large blobs, etc.)
const { data } = useLiveQuery((q) => q.from({ user: usersCollection }))
```

## Memory Considerations

### Collection Size

- **< 10k rows**: Eager sync works well
- **10k - 50k rows**: Consider progressive sync
- **> 50k rows**: Use on-demand sync

### Query Result Caching

Live query results are cached and updated incrementally. Multiple components using the same query share the cache:

```tsx
// These share the same underlying query cache
function ComponentA() {
  const { data } = useLiveQuery((q) => q.from({ user: usersCollection }))
}

function ComponentB() {
  const { data } = useLiveQuery((q) => q.from({ user: usersCollection }))
}
```

### Garbage Collection

Unused queries are garbage collected after `gcTime` (default 5 seconds):

```tsx
const collection = createCollection(
  liveQueryCollectionOptions({
    query: ...,
    gcTime: 30000, // Keep for 30 seconds after unmount
  })
)
```

## Debugging Performance

### Enable Debug Logging

```javascript
localStorage.debug = 'ts/db:*'
```

### Measure Query Time

```tsx
const start = performance.now()
const { data } = useLiveQuery(...)
console.log(`Query took ${performance.now() - start}ms`)
```

### Profile with React DevTools

Use React DevTools Profiler to identify re-render causes.

## Common Pitfalls

| Issue                  | Cause                           | Fix                               |
| ---------------------- | ------------------------------- | --------------------------------- |
| Slow initial load      | Too much data                   | Use on-demand sync                |
| Slow updates           | Functional variants             | Use expression functions          |
| Memory growth          | Too many active queries         | Consolidate queries, check gcTime |
| Unnecessary re-renders | New query reference each render | Use dependency array correctly    |

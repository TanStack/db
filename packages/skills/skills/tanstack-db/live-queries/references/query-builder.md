# Query Builder API

Complete reference for the TanStack DB query builder.

## Query Methods

### from

Start a query by specifying collections:

```tsx
q.from({ user: usersCollection })
q.from({ user: usersCollection, post: postsCollection })
```

### where

Filter results with conditions:

```tsx
.where(({ user }) => eq(user.active, true))

// Multiple where clauses are ANDed
.where(({ user }) => eq(user.active, true))
.where(({ user }) => gt(user.age, 18))

// Complex conditions
.where(({ user }) =>
  and(
    eq(user.active, true),
    or(gt(user.age, 25), eq(user.role, 'admin'))
  )
)
```

### select

Transform and pick fields:

```tsx
// Pick specific fields
.select(({ user }) => ({
  id: user.id,
  name: user.name,
}))

// Computed fields
.select(({ user }) => ({
  ...user,
  fullName: concat(user.firstName, ' ', user.lastName),
  isAdult: gt(user.age, 18),
}))
```

### join / leftJoin / innerJoin

Combine data from multiple collections:

```tsx
.join(
  { post: postsCollection },
  ({ user, post }) => eq(user.id, post.userId),
  'left' // 'left' | 'right' | 'inner' | 'full'
)

// Convenience methods
.leftJoin({ post: postsCollection }, ({ user, post }) => eq(user.id, post.userId))
.innerJoin({ post: postsCollection }, ({ user, post }) => eq(user.id, post.userId))
```

### groupBy

Group results for aggregation:

```tsx
.groupBy(({ order }) => order.customerId)
.groupBy(({ order }) => [order.customerId, order.year]) // Multiple columns
```

### having

Filter groups after aggregation:

```tsx
.groupBy(({ order }) => order.customerId)
.select(({ order }) => ({
  customerId: order.customerId,
  total: sum(order.amount),
}))
.having(({ $selected }) => gt($selected.total, 1000))
```

### orderBy

Sort results:

```tsx
.orderBy(({ user }) => user.name, 'asc')
.orderBy(({ user }) => user.createdAt, 'desc')

// Multiple columns
.orderBy(({ user }) => user.lastName, 'asc')
.orderBy(({ user }) => user.firstName, 'asc')
```

### limit / offset

Paginate results:

```tsx
.limit(20)
.offset(40) // Skip first 40, return next 20
```

### distinct

Remove duplicates:

```tsx
.distinct()
```

### findOne

Return single item instead of array:

```tsx
.findOne() // Returns T | undefined instead of T[]
```

## Hook API

### useLiveQuery

```tsx
const {
  data,          // Query results (T[] or T | undefined for findOne)
  isLoading,     // True during initial load
  isEnabled,     // False when query returns undefined
  error,         // Any error that occurred
} = useLiveQuery(
  (q) => q.from({ user: usersCollection }),
  [dep1, dep2]  // Optional dependency array
)
```

### useLiveSuspenseQuery

```tsx
// data is always defined (suspends until ready)
const { data } = useLiveSuspenseQuery(
  (q) => q.from({ user: usersCollection }),
  [dep1, dep2]
)
```

### useLiveInfiniteQuery

```tsx
const {
  data,          // All loaded pages flattened
  hasNextPage,
  fetchNextPage,
  isFetchingNextPage,
} = useLiveInfiniteQuery(
  (q, { pageParam }) =>
    q.from({ user: usersCollection })
      .orderBy(({ user }) => user.id, 'asc')
      .limit(20)
      .offset(pageParam * 20),
  {
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === 20 ? allPages.length : undefined,
  }
)
```

## Type Inference

Query results are fully typed based on your select:

```tsx
const { data } = useLiveQuery((q) =>
  q.from({ user: usersCollection })
   .select(({ user }) => ({
     id: user.id,
     name: user.name,
   }))
)

// data is typed as { id: string; name: string }[]
```

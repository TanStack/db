---
name: tanstack-db-live-queries
description: |
  Live query patterns in TanStack DB.
  Use for filtering, joins, aggregations, sorting, and reactive data binding.
---

# Live Queries

TanStack DB live queries are reactive, type-safe queries that automatically update when underlying data changes. Built on differential dataflow, they update incrementally rather than re-running—achieving sub-millisecond performance even on 100k+ item collections.

## Common Patterns

### Basic Query with useLiveQuery

```tsx
import { useLiveQuery, eq } from '@tanstack/react-db'

function TodoList() {
  const { data: todos, isLoading } = useLiveQuery((q) =>
    q
      .from({ todo: todoCollection })
      .where(({ todo }) => eq(todo.completed, false))
      .orderBy(({ todo }) => todo.createdAt, 'desc')
  )

  if (isLoading) return <div>Loading...</div>

  return (
    <ul>
      {todos?.map((todo) => (
        <li key={todo.id}>{todo.text}</li>
      ))}
    </ul>
  )
}
```

### Filtering with Where Clauses

```tsx
import { eq, gt, and, or, inArray, like } from '@tanstack/db'

// Simple equality
.where(({ user }) => eq(user.active, true))

// Multiple conditions (chained = AND)
.where(({ user }) => eq(user.active, true))
.where(({ user }) => gt(user.age, 18))

// Complex conditions
.where(({ user }) =>
  and(
    eq(user.active, true),
    or(
      gt(user.age, 25),
      eq(user.role, 'admin')
    )
  )
)

// Array membership
.where(({ user }) => inArray(user.id, [1, 2, 3]))

// Pattern matching
.where(({ user }) => like(user.email, '%@company.com'))
```

### Select and Transform

```tsx
import { concat, upper, gt } from '@tanstack/db'

const { data } = useLiveQuery((q) =>
  q
    .from({ user: usersCollection })
    .select(({ user }) => ({
      id: user.id,
      displayName: concat(user.firstName, ' ', user.lastName),
      isAdult: gt(user.age, 18),
      ...user, // Spread to include all fields
    }))
)
```

### Joins Across Collections

```tsx
const { data } = useLiveQuery((q) =>
  q
    .from({ user: usersCollection })
    .join(
      { post: postsCollection },
      ({ user, post }) => eq(user.id, post.userId),
      'inner' // 'left' | 'right' | 'inner' | 'full'
    )
    .select(({ user, post }) => ({
      userName: user.name,
      postTitle: post.title,
    }))
)

// Convenience methods
.leftJoin({ post: postsCollection }, ({ user, post }) => eq(user.id, post.userId))
.innerJoin({ post: postsCollection }, ({ user, post }) => eq(user.id, post.userId))
```

### Aggregations with groupBy

```tsx
import { count, sum, avg, min, max } from '@tanstack/db'

const { data } = useLiveQuery((q) =>
  q
    .from({ order: ordersCollection })
    .groupBy(({ order }) => order.customerId)
    .select(({ order }) => ({
      customerId: order.customerId,
      totalOrders: count(order.id),
      totalSpent: sum(order.amount),
      avgOrder: avg(order.amount),
    }))
    .having(({ $selected }) => gt($selected.totalSpent, 1000))
    .orderBy(({ $selected }) => $selected.totalSpent, 'desc')
)
```

### Pagination with Limit and Offset

```tsx
const { data } = useLiveQuery((q) =>
  q
    .from({ user: usersCollection })
    .orderBy(({ user }) => user.name, 'asc')
    .limit(20)
    .offset(page * 20)
)
```

### Find Single Record

```tsx
const { data: user } = useLiveQuery((q) =>
  q
    .from({ user: usersCollection })
    .where(({ user }) => eq(user.id, userId))
    .findOne() // Returns single object | undefined instead of array
, [userId])
```

### Conditional Queries

```tsx
const { data, isEnabled } = useLiveQuery((q) => {
  if (!userId) return undefined // Disable query

  return q
    .from({ todo: todosCollection })
    .where(({ todo }) => eq(todo.userId, userId))
}, [userId])

if (!isEnabled) return <div>Select a user</div>
```

### Subqueries

```tsx
const { data } = useLiveQuery((q) => {
  // Build subquery
  const activeUsers = q
    .from({ user: usersCollection })
    .where(({ user }) => eq(user.active, true))

  // Use in main query
  return q
    .from({ activeUser: activeUsers })
    .join({ post: postsCollection }, ({ activeUser, post }) =>
      eq(activeUser.id, post.userId)
    )
})
```

### React Suspense Support

```tsx
import { useLiveSuspenseQuery } from '@tanstack/react-db'
import { Suspense } from 'react'

function UserList() {
  // data is always defined (never undefined)
  const { data } = useLiveSuspenseQuery((q) =>
    q.from({ user: usersCollection })
  )

  return <ul>{data.map(user => <li key={user.id}>{user.name}</li>)}</ul>
}

function App() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <UserList />
    </Suspense>
  )
}
```

### Dependency Arrays

```tsx
// Re-run query when minAge changes
const { data } = useLiveQuery(
  (q) =>
    q
      .from({ user: usersCollection })
      .where(({ user }) => gt(user.age, minAge)),
  [minAge] // Dependency array
)
```

## Expression Functions

| Function   | Usage                                | Example                              |
| ---------- | ------------------------------------ | ------------------------------------ |
| `eq`       | Equality                             | `eq(user.id, 1)`                     |
| `gt/gte`   | Greater than (or equal)              | `gt(user.age, 18)`                   |
| `lt/lte`   | Less than (or equal)                 | `lt(user.price, 100)`                |
| `and`      | Logical AND                          | `and(cond1, cond2)`                  |
| `or`       | Logical OR                           | `or(cond1, cond2)`                   |
| `not`      | Logical NOT                          | `not(eq(user.active, false))`        |
| `inArray`  | Value in array                       | `inArray(user.id, [1, 2, 3])`        |
| `like`     | Pattern match (case-sensitive)       | `like(user.name, 'John%')`           |
| `ilike`    | Pattern match (case-insensitive)     | `ilike(user.email, '%@gmail.com')`   |
| `isNull`   | Check for null                       | `isNull(user.deletedAt)`             |
| `isUndefined` | Check for undefined              | `isUndefined(profile)`               |
| `concat`   | String concatenation                 | `concat(user.first, ' ', user.last)` |
| `upper`    | Uppercase                            | `upper(user.name)`                   |
| `lower`    | Lowercase                            | `lower(user.email)`                  |
| `length`   | String/array length                  | `length(user.tags)`                  |
| `count`    | Count (aggregate)                    | `count(order.id)`                    |
| `sum`      | Sum (aggregate)                      | `sum(order.amount)`                  |
| `avg`      | Average (aggregate)                  | `avg(order.amount)`                  |
| `min`      | Minimum (aggregate)                  | `min(order.amount)`                  |
| `max`      | Maximum (aggregate)                  | `max(order.amount)`                  |

## Detailed References

| Reference                           | When to Use                                           |
| ----------------------------------- | ----------------------------------------------------- |
| `references/query-builder.md`       | Full query builder API, method signatures, chaining   |
| `references/joins.md`               | Join types, multi-table queries, join optimization    |
| `references/aggregations.md`        | groupBy, having, aggregate functions, multi-column    |
| `references/subqueries.md`          | Nested queries, query composition, deduplication      |
| `references/functional-variants.md` | fn.where, fn.select for complex JavaScript logic      |
| `references/performance.md`         | Incremental updates, caching, derived collections     |

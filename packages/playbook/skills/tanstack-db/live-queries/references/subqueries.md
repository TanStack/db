# Subqueries

Embed queries within queries for complex data transformations.

## Subqueries vs Derived Collections

| Approach           | Materialized? | Use Case                                            |
| ------------------ | ------------- | --------------------------------------------------- |
| Subquery           | No            | Internal to parent query, not accessible separately |
| Derived Collection | Yes           | Reusable, cacheable intermediate result             |

## Subquery in From

Use a query as the source:

```tsx
const { data } = useLiveQuery((q) => {
  // Build subquery
  const activeUsers = q
    .from({ user: usersCollection })
    .where(({ user }) => eq(user.active, true))

  // Use in main query
  return q.from({ activeUser: activeUsers }).select(({ activeUser }) => ({
    id: activeUser.id,
    name: activeUser.name,
  }))
})
```

## Subquery in Join

Join against a filtered/transformed subset:

```tsx
const { data } = useLiveQuery((q) => {
  const recentPosts = q
    .from({ post: postsCollection })
    .where(({ post }) => gt(post.createdAt, lastWeek))
    .orderBy(({ post }) => post.createdAt, 'desc')

  return q
    .from({ user: usersCollection })
    .leftJoin({ recentPost: recentPosts }, ({ user, recentPost }) =>
      eq(user.id, recentPost.userId),
    )
})
```

## Nested Subqueries

Build complex queries with multiple levels:

```tsx
const { data } = useLiveQuery((q) => {
  // First level: count posts per user
  const postCounts = q
    .from({ post: postsCollection })
    .groupBy(({ post }) => post.userId)
    .select(({ post }) => ({
      userId: post.userId,
      postCount: count(post.id),
    }))

  // Second level: join with users
  const userStats = q
    .from({ user: usersCollection })
    .leftJoin({ stats: postCounts }, ({ user, stats }) =>
      eq(user.id, stats.userId),
    )
    .select(({ user, stats }) => ({
      id: user.id,
      name: user.name,
      postCount: stats?.postCount ?? 0,
    }))

  // Final: top users
  return q
    .from({ userStat: userStats })
    .orderBy(({ userStat }) => userStat.postCount, 'desc')
    .limit(10)
})
```

## Subquery Deduplication

Same subquery used multiple times is executed once:

```tsx
const { data } = useLiveQuery((q) => {
  // This subquery is defined once
  const activeUsers = q
    .from({ user: usersCollection })
    .where(({ user }) => eq(user.active, true))

  // Used in multiple places - only computed once
  return q
    .from({ activeUser: activeUsers })
    .join({ post: postsCollection }, ({ activeUser, post }) =>
      eq(activeUser.id, post.userId),
    )
    .join({ comment: commentsCollection }, ({ activeUser, comment }) =>
      eq(activeUser.id, comment.userId),
    )
})
```

## Derived Collections (Alternative)

For reusable intermediate results, use derived collections:

```tsx
// Create reusable derived collection
const activeUsers = createLiveQueryCollection((q) =>
  q
    .from({ user: usersCollection })
    .where(({ user }) => eq(user.active, true))
)

// Use in multiple queries
const activeUserPosts = useLiveQuery((q) =>
  q
    .from({ user: activeUsers }) // Uses the derived collection
    .join({ post: postsCollection }, ...)
)

const activeUserComments = useLiveQuery((q) =>
  q
    .from({ user: activeUsers }) // Same derived collection
    .join({ comment: commentsCollection }, ...)
)
```

## When to Use Subqueries

**Use subqueries when:**

- Query is only needed within a single parent query
- You don't need to access intermediate results
- Building complex multi-step transformations

**Use derived collections when:**

- Same query is used in multiple places
- You want to cache intermediate results
- You need to access the intermediate collection directly

## Subquery Patterns

### Filter Before Join

```tsx
const { data } = useLiveQuery((q) => {
  const premiumUsers = q
    .from({ user: usersCollection })
    .where(({ user }) => eq(user.tier, 'premium'))

  return q
    .from({ user: premiumUsers })
    .join({ order: ordersCollection }, ...)
})
```

### Aggregate Then Join

```tsx
const { data } = useLiveQuery((q) => {
  const orderTotals = q
    .from({ order: ordersCollection })
    .groupBy(({ order }) => order.userId)
    .select(({ order }) => ({
      userId: order.userId,
      total: sum(order.amount),
    }))

  return q
    .from({ user: usersCollection })
    .leftJoin({ totals: orderTotals }, ({ user, totals }) =>
      eq(user.id, totals.userId),
    )
})
```

### Top N Per Group

```tsx
const { data } = useLiveQuery((q) => {
  const rankedPosts = q
    .from({ post: postsCollection })
    .orderBy(({ post }) => post.likes, 'desc')

  return q
    .from({ user: usersCollection })
    .leftJoin({ topPost: rankedPosts }, ({ user, topPost }) =>
      eq(user.id, topPost.userId),
    )
  // Further processing...
})
```

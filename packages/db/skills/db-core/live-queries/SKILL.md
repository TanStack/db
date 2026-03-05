---
name: db-core/live-queries
description: >
  Query builder fluent API: from, where, join, leftJoin, rightJoin, innerJoin,
  fullJoin, select, fn.select, groupBy, having, orderBy, limit, offset, distinct,
  findOne. Operators: eq, gt, gte, lt, lte, like, ilike, inArray, isNull,
  isUndefined, and, or, not. Aggregates: count, sum, avg, min, max. String
  functions: upper, lower, length, concat, coalesce. Math: add. $selected
  namespace. createLiveQueryCollection. Derived collections. Predicate push-down.
  Incremental view maintenance via differential dataflow (d2ts).
type: sub-skill
library: db
library_version: '0.5.30'
sources:
  - 'TanStack/db:docs/guides/live-queries.md'
  - 'TanStack/db:packages/db/src/query/builder/index.ts'
  - 'TanStack/db:packages/db/src/query/compiler/index.ts'
---

# Live Queries

> This skill builds on db-core.

TanStack DB live queries use a SQL-like fluent query builder to create **reactive derived collections** that automatically update when underlying data changes. The query engine compiles queries into incremental view maintenance (IVM) pipelines using differential dataflow (d2ts), so only deltas are recomputed.

All operators, string functions, math functions, and aggregates are incrementally maintained. Prefer them over equivalent JS code.

## Setup

Minimal example using the core API (no framework hooks):

```ts
import {
  createCollection,
  createLiveQueryCollection,
  liveQueryCollectionOptions,
  eq,
} from '@tanstack/db'

// Assume usersCollection is already created via createCollection(...)

// Option 1: createLiveQueryCollection shorthand
const activeUsers = createLiveQueryCollection((q) =>
  q
    .from({ user: usersCollection })
    .where(({ user }) => eq(user.active, true))
    .select(({ user }) => ({
      id: user.id,
      name: user.name,
      email: user.email,
    })),
)

// Option 2: full options via liveQueryCollectionOptions
const activeUsers2 = createCollection(
  liveQueryCollectionOptions({
    query: (q) =>
      q
        .from({ user: usersCollection })
        .where(({ user }) => eq(user.active, true))
        .select(({ user }) => ({
          id: user.id,
          name: user.name,
        })),
    getKey: (user) => user.id,
  }),
)

// The result is a live collection -- iterate, subscribe, or use as source
for (const user of activeUsers) {
  console.log(user.name)
}
```

## Core Patterns

### 1. Filtering with where + operators

Chain `.where()` calls (ANDed together) using expression operators. Use `and()`, `or()`, `not()` for complex logic.

```ts
import { eq, gt, or, and, not, inArray, like } from '@tanstack/db'

const results = createLiveQueryCollection((q) =>
  q
    .from({ user: usersCollection })
    .where(({ user }) => eq(user.active, true))
    .where(({ user }) =>
      and(
        gt(user.age, 18),
        or(eq(user.role, 'admin'), eq(user.role, 'moderator')),
        not(inArray(user.id, bannedIds)),
      ),
    ),
)
```

Boolean column references work directly:

```ts
.where(({ user }) => user.active)        // bare boolean ref
.where(({ user }) => not(user.suspended)) // negated boolean ref
```

### 2. Joining two collections

Join conditions **must** use `eq()` (equality only -- IVM constraint). Default join type is `left`. Convenience methods: `leftJoin`, `rightJoin`, `innerJoin`, `fullJoin`.

```ts
import { eq } from '@tanstack/db'

const userPosts = createLiveQueryCollection((q) =>
  q
    .from({ user: usersCollection })
    .innerJoin({ post: postsCollection }, ({ user, post }) =>
      eq(user.id, post.userId),
    )
    .select(({ user, post }) => ({
      userName: user.name,
      postTitle: post.title,
    })),
)
```

Multiple joins:

```ts
q.from({ user: usersCollection })
  .join({ post: postsCollection }, ({ user, post }) => eq(user.id, post.userId))
  .join({ comment: commentsCollection }, ({ post, comment }) =>
    eq(post.id, comment.postId),
  )
```

### 3. Aggregation with groupBy + having

Use `groupBy` to group rows, then aggregate in `select`. Filter groups with `having`. The `$selected` namespace lets `having` and `orderBy` reference fields defined in `select`.

```ts
import { count, sum, gt } from '@tanstack/db'

const topCustomers = createLiveQueryCollection((q) =>
  q
    .from({ order: ordersCollection })
    .groupBy(({ order }) => order.customerId)
    .select(({ order }) => ({
      customerId: order.customerId,
      totalSpent: sum(order.amount),
      orderCount: count(order.id),
    }))
    .having(({ $selected }) => gt($selected.totalSpent, 1000))
    .orderBy(({ $selected }) => $selected.totalSpent, 'desc')
    .limit(10),
)
```

Without `groupBy`, aggregates in `select` treat the entire collection as one group:

```ts
const stats = createLiveQueryCollection((q) =>
  q.from({ user: usersCollection }).select(({ user }) => ({
    totalUsers: count(user.id),
    avgAge: avg(user.age),
  })),
)
```

### 4. Standalone derived collection with createLiveQueryCollection

Derived collections are themselves collections. Use one as a source for another query to cache intermediate results:

```ts
// Base derived collection
const activeUsers = createLiveQueryCollection((q) =>
  q.from({ user: usersCollection }).where(({ user }) => eq(user.active, true)),
)

// Second query uses the derived collection as its source
const activeUserPosts = createLiveQueryCollection((q) =>
  q
    .from({ user: activeUsers })
    .join({ post: postsCollection }, ({ user, post }) =>
      eq(user.id, post.userId),
    )
    .select(({ user, post }) => ({
      userName: user.name,
      postTitle: post.title,
    })),
)
```

Create derived collections once at module scope and reuse them. Do not recreate on every render or navigation.

## Common Mistakes

### CRITICAL: Using === instead of eq()

JavaScript `===` in a where callback returns a boolean primitive, not an expression object. Throws `InvalidWhereExpressionError`.

```ts
// WRONG
q.from({ user: usersCollection }).where(({ user }) => user.active === true)

// CORRECT
q.from({ user: usersCollection }).where(({ user }) => eq(user.active, true))
```

### CRITICAL: Filtering in JS instead of query operators

JS `.filter()` / `.map()` on the result array throws away incremental maintenance -- the JS code re-runs from scratch on every change.

```ts
// WRONG -- re-runs filter on every change
const { data } = useLiveQuery((q) => q.from({ todos: todosCollection }))
const active = data.filter((t) => t.completed === false)

// CORRECT -- incrementally maintained
const { data } = useLiveQuery((q) =>
  q
    .from({ todos: todosCollection })
    .where(({ todos }) => eq(todos.completed, false)),
)
```

### HIGH: Not using the full operator set

The library provides string functions (`upper`, `lower`, `length`, `concat`), math (`add`), utility (`coalesce`), and aggregates (`count`, `sum`, `avg`, `min`, `max`). All are incrementally maintained. Prefer them over JS equivalents.

```ts
// WRONG
.fn.select((row) => ({
  name: row.user.name.toUpperCase(),
  total: row.order.price + row.order.tax,
}))

// CORRECT
.select(({ user, order }) => ({
  name: upper(user.name),
  total: add(order.price, order.tax),
}))
```

### HIGH: .distinct() without .select()

`distinct()` deduplicates by the selected columns. Without `select()`, throws `DistinctRequiresSelectError`.

```ts
// WRONG
q.from({ user: usersCollection }).distinct()

// CORRECT
q.from({ user: usersCollection })
  .select(({ user }) => ({ country: user.country }))
  .distinct()
```

### HIGH: .having() without .groupBy()

`having` filters aggregated groups. Without `groupBy`, there are no groups. Throws `HavingRequiresGroupByError`.

```ts
// WRONG
q.from({ order: ordersCollection }).having(({ order }) =>
  gt(count(order.id), 5),
)

// CORRECT
q.from({ order: ordersCollection })
  .groupBy(({ order }) => order.customerId)
  .having(({ order }) => gt(count(order.id), 5))
```

### HIGH: .limit() / .offset() without .orderBy()

Without deterministic ordering, limit/offset results are non-deterministic and cannot be incrementally maintained. Throws `LimitOffsetRequireOrderByError`.

```ts
// WRONG
q.from({ user: usersCollection }).limit(10)

// CORRECT
q.from({ user: usersCollection })
  .orderBy(({ user }) => user.name)
  .limit(10)
```

### HIGH: Join condition using non-eq() operator

The differential dataflow join operator only supports equality joins. Using `gt()`, `like()`, etc. throws `JoinConditionMustBeEqualityError`.

```ts
// WRONG
q.from({ user: usersCollection }).join(
  { post: postsCollection },
  ({ user, post }) => gt(user.id, post.userId),
)

// CORRECT
q.from({ user: usersCollection }).join(
  { post: postsCollection },
  ({ user, post }) => eq(user.id, post.userId),
)
```

### MEDIUM: Passing source directly instead of {alias: collection}

`from()` and `join()` require sources wrapped as `{alias: collection}`. Passing the collection directly throws `InvalidSourceTypeError`.

```ts
// WRONG
q.from(usersCollection)

// CORRECT
q.from({ users: usersCollection })
```

## Tension: Query expressiveness vs. IVM constraints

The query builder looks like SQL but has constraints that SQL does not:

- **Equality joins only** -- `eq()` is the only allowed join condition operator.
- **orderBy required for limit/offset** -- non-deterministic pagination cannot be incrementally maintained.
- **distinct requires select** -- deduplication needs an explicit projection.
- **fn.select() cannot be used with groupBy()** -- the compiler must statically analyze select to discover aggregate functions.

These constraints exist because the underlying d2ts differential dataflow engine requires them for correct incremental view maintenance.

See also: react-db/SKILL.md for React hooks (`useLiveQuery`, `useLiveSuspenseQuery`, `useLiveInfiniteQuery`).

## References

- [Query Operators Reference](./references/operators.md) -- full signatures and examples for all operators, functions, and aggregates.

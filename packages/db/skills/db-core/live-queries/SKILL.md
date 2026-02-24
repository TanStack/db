---
name: db-core/live-queries
description: >
  Building reactive queries across collections. Covers Query builder fluent
  API (from/where/join/select/groupBy/having/orderBy/limit/offset/distinct/
  findOne). Comparison operators (eq, gt, gte, lt, lte, like, ilike,
  inArray, isNull, isUndefined). Logical operators (and, or, not). Aggregate
  functions (count, sum, avg, min, max). String functions (upper, lower,
  length, concat, coalesce). Math (add, subtract, multiply, divide). Join
  types (inner, left, right, full). Derived collections.
  createLiveQueryCollection. $selected namespace. Predicate push-down.
  Incremental view maintenance via d2ts.
type: sub-skill
library: db
library_version: '0.5.29'
sources:
  - 'TanStack/db:docs/guides/live-queries.md'
  - 'TanStack/db:packages/db/src/query/builder/index.ts'
  - 'TanStack/db:packages/db/src/query/compiler/index.ts'
---

# Live Query Construction

## Setup

Live queries use a fluent SQL-like builder. Query results are reactive —
they update automatically when underlying collection data changes.

```typescript
import { createCollection, liveQueryCollectionOptions, eq } from '@tanstack/db'

const activeUsers = createCollection(
  liveQueryCollectionOptions({
    query: (q) =>
      q
        .from({ user: usersCollection })
        .where(({ user }) => eq(user.active, true))
        .select(({ user }) => ({
          id: user.id,
          name: user.name,
          email: user.email,
        })),
  }),
)
```

For React/Vue/Svelte/Solid/Angular, use the framework hooks instead
(see react-db/SKILL.md or the relevant framework skill).

## Core Patterns

### Filtering with WHERE and operators

All operators return expression objects for the query engine. Import them
from `@tanstack/db`:

```typescript
import {
  eq,
  gt,
  lt,
  gte,
  lte,
  and,
  or,
  not,
  like,
  ilike,
  inArray,
  isNull,
  isUndefined,
} from '@tanstack/db'

// Single condition
q.from({ t: todos }).where(({ t }) => eq(t.completed, false))

// Multiple conditions with AND
q.from({ t: todos }).where(({ t }) =>
  and(eq(t.completed, false), gt(t.priority, 3)),
)

// OR conditions
q.from({ t: todos }).where(({ t }) =>
  or(eq(t.status, 'urgent'), and(gt(t.priority, 4), eq(t.completed, false))),
)

// Pattern matching
q.from({ u: users }).where(({ u }) => ilike(u.email, '%@example.com'))

// Null checks
q.from({ t: todos }).where(({ t }) => not(isNull(t.assignee)))

// Array membership
q.from({ t: todos }).where(({ t }) =>
  inArray(t.status, ['open', 'in-progress']),
)
```

### Projections with SELECT and computed fields

```typescript
import {
  upper,
  concat,
  coalesce,
  add,
  count,
  sum,
  avg,
  min,
  max,
  length,
} from '@tanstack/db'

// Project specific fields
q.from({ u: users }).select(({ u }) => ({
  id: u.id,
  displayName: upper(u.name),
  fullName: concat(u.firstName, ' ', u.lastName),
  score: add(u.baseScore, u.bonus),
  status: coalesce(u.status, 'unknown'),
}))

// Aggregations with GROUP BY
q.from({ o: orders })
  .groupBy(({ o }) => o.customerId)
  .select(({ o }) => ({
    customerId: o.customerId,
    totalSpent: sum(o.amount),
    orderCount: count(),
    avgOrder: avg(o.amount),
    lastOrder: max(o.createdAt),
  }))
  .having(({ $selected }) => gt($selected.totalSpent, 1000))
```

Use `$selected` to reference SELECT fields in HAVING and ORDER BY clauses.

### Joining collections

Only equality joins are supported (d2ts differential dataflow constraint):

```typescript
import { eq } from '@tanstack/db'

// Inner join
q.from({ o: orders })
  .join({ c: customers }, ({ o, c }) => eq(o.customerId, c.id))
  .select(({ o, c }) => ({
    orderId: o.id,
    amount: o.amount,
    customerName: c.name,
  }))

// Left join (keeps all orders, customer may be null)
q.from({ o: orders })
  .leftJoin({ c: customers }, ({ o, c }) => eq(o.customerId, c.id))
  .select(({ o, c }) => ({
    orderId: o.id,
    customerName: coalesce(c.name, 'Unknown'),
  }))
```

Join types: `.join()` (inner), `.leftJoin()`, `.rightJoin()`, `.fullJoin()`.

### Sorting, pagination, and findOne

```typescript
// Sort and paginate (orderBy is REQUIRED for limit/offset)
q.from({ t: todos })
  .orderBy(({ t }) => t.createdAt, 'desc')
  .limit(20)
  .offset(40)

// Get a single item
q.from({ t: todos })
  .where(({ t }) => eq(t.id, selectedId))
  .findOne()
```

### Derived collections

Query results are themselves collections that can be queried further:

```typescript
const activeUsers = createCollection(
  liveQueryCollectionOptions({
    query: (q) =>
      q.from({ u: usersCollection }).where(({ u }) => eq(u.active, true)),
  }),
)

// Query the derived collection
const topActiveUsers = createCollection(
  liveQueryCollectionOptions({
    query: (q) =>
      q
        .from({ u: activeUsers })
        .orderBy(({ u }) => u.score, 'desc')
        .limit(10),
  }),
)
```

## Common Mistakes

### CRITICAL — Using === instead of eq() in where clauses

Wrong:

```typescript
q.from({ t: todos }).where(({ t }) => t.completed === false)
```

Correct:

```typescript
import { eq } from '@tanstack/db'

q.from({ t: todos }).where(({ t }) => eq(t.completed, false))
```

JavaScript `===` returns a boolean, not an expression object. The query
engine cannot build a filter predicate from a plain boolean. This throws
`InvalidWhereExpressionError`.

Source: packages/db/src/query/builder/index.ts:375

### CRITICAL — Filtering or transforming data in JS instead of using query operators

Wrong:

```typescript
const { data } = useLiveQuery((q) => q.from({ t: todos }))
// Then in render:
const filtered = data.filter((t) => t.priority > 3)
const sorted = filtered.sort((a, b) => b.createdAt - a.createdAt)
```

Correct:

```typescript
const { data } = useLiveQuery((q) =>
  q
    .from({ t: todos })
    .where(({ t }) => gt(t.priority, 3))
    .orderBy(({ t }) => t.createdAt, 'desc'),
)
```

JS `.filter()`, `.map()`, `.sort()`, `.reduce()` re-run from scratch on
every change. Query builder operators are incrementally maintained via
d2ts — only deltas are recomputed. Always slower to use JS, even for
trivial cases.

Source: maintainer interview

### HIGH — Not using the full set of available query operators

Wrong:

```typescript
// Using JS for string operations
const { data } = useLiveQuery((q) => q.from({ u: users }))
const display = data.map((u) => ({
  ...u,
  name: u.name.toUpperCase(),
  label: `${u.firstName} ${u.lastName}`,
}))
```

Correct:

```typescript
const { data } = useLiveQuery((q) =>
  q.from({ u: users }).select(({ u }) => ({
    id: u.id,
    name: upper(u.name),
    label: concat(u.firstName, ' ', u.lastName),
  })),
)
```

The library has `upper`, `lower`, `length`, `concat`, `coalesce`, `add`,
plus all aggregate functions. Every operator is incrementally maintained.
Prefer query operators over JS equivalents.

Source: maintainer interview

### HIGH — Using .distinct() without .select()

Wrong:

```typescript
q.from({ t: todos }).distinct()
```

Correct:

```typescript
q.from({ t: todos })
  .select(({ t }) => ({ status: t.status }))
  .distinct()
```

`distinct()` deduplicates by the selected object shape. Without `select()`,
the shape is the full row, and the engine throws `DistinctRequiresSelectError`.

Source: packages/db/src/query/compiler/index.ts:218

### HIGH — Using .having() without .groupBy()

Wrong:

```typescript
q.from({ o: orders })
  .select(({ o }) => ({ total: sum(o.amount) }))
  .having(({ $selected }) => gt($selected.total, 100))
```

Correct:

```typescript
q.from({ o: orders })
  .groupBy(({ o }) => o.customerId)
  .select(({ o }) => ({
    customerId: o.customerId,
    total: sum(o.amount),
  }))
  .having(({ $selected }) => gt($selected.total, 100))
```

HAVING filters aggregated groups. Without GROUP BY there are no groups,
throwing `HavingRequiresGroupByError`.

Source: packages/db/src/query/compiler/index.ts:293

### HIGH — Using .limit() or .offset() without .orderBy()

Wrong:

```typescript
q.from({ t: todos }).limit(10)
```

Correct:

```typescript
q.from({ t: todos })
  .orderBy(({ t }) => t.createdAt, 'desc')
  .limit(10)
```

Without deterministic ordering, limit/offset results are non-deterministic
and cannot be incrementally maintained. Throws `LimitOffsetRequireOrderByError`.

Source: packages/db/src/query/compiler/index.ts:356

### HIGH — Join condition using operator other than eq()

Wrong:

```typescript
q.from({ o: orders }).join({ c: customers }, ({ o, c }) =>
  gt(o.amount, c.minOrder),
)
```

Correct:

```typescript
q.from({ o: orders })
  .join({ c: customers }, ({ o, c }) => eq(o.customerId, c.id))
  .where(({ o, c }) => gt(o.amount, c.minOrder))
```

The d2ts join operator only supports equality conditions. Non-equality
predicates throw `JoinConditionMustBeEqualityError`. Move non-equality
conditions to `.where()`.

Source: packages/db/src/query/builder/index.ts:216

### MEDIUM — Passing source directly instead of {alias: collection}

Wrong:

```typescript
q.from(todosCollection)
```

Correct:

```typescript
q.from({ todos: todosCollection })
```

`.from()` and `.join()` require sources wrapped as `{alias: collection}`.
The alias is how you reference fields in subsequent clauses. Passing the
collection directly throws `InvalidSourceTypeError`.

Source: packages/db/src/query/builder/index.ts:79-96

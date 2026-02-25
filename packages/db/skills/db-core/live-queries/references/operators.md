# Query Operator Reference

All operators are imported from `@tanstack/db`. They return expression
objects for the query engine — never use JS operators in `.where()`.

## Comparison Operators

```typescript
import { eq, gt, gte, lt, lte, like, ilike, inArray, isNull, isUndefined } from '@tanstack/db'
```

| Operator | SQL equivalent | Example |
|----------|---------------|---------|
| `eq(a, b)` | `a = b` | `eq(t.status, 'active')` |
| `gt(a, b)` | `a > b` | `gt(t.priority, 3)` |
| `gte(a, b)` | `a >= b` | `gte(t.age, 18)` |
| `lt(a, b)` | `a < b` | `lt(t.price, 100)` |
| `lte(a, b)` | `a <= b` | `lte(t.quantity, 0)` |
| `like(a, pattern)` | `a LIKE pattern` | `like(t.name, 'John%')` |
| `ilike(a, pattern)` | `a ILIKE pattern` | `ilike(t.email, '%@example.com')` |
| `inArray(a, arr)` | `a IN (...)` | `inArray(t.status, ['open', 'pending'])` |
| `isNull(a)` | `a IS NULL` | `isNull(t.deletedAt)` |
| `isUndefined(a)` | `a IS UNDEFINED` | `isUndefined(t.optional)` |

`like` / `ilike` use SQL-style patterns: `%` matches any sequence, `_`
matches one character. `ilike` is case-insensitive.

**There is no `ne()` operator.** Use `not(eq(a, b))` instead.

## Logical Operators

```typescript
import { and, or, not } from '@tanstack/db'
```

| Operator | Example |
|----------|---------|
| `and(...exprs)` | `and(eq(t.active, true), gt(t.age, 18))` |
| `or(...exprs)` | `or(eq(t.role, 'admin'), eq(t.role, 'owner'))` |
| `not(expr)` | `not(isNull(t.email))` |

`and` and `or` accept any number of arguments:

```typescript
and(
  eq(t.active, true),
  gt(t.age, 18),
  not(isNull(t.email)),
  or(eq(t.role, 'admin'), eq(t.role, 'editor')),
)
```

## Aggregate Functions

```typescript
import { count, sum, avg, min, max } from '@tanstack/db'
```

| Function | Returns | Example |
|----------|---------|---------|
| `count()` | number | `count()` — count all rows |
| `count(expr)` | number | `count(t.email)` — count non-null |
| `sum(expr)` | number | `sum(o.amount)` |
| `avg(expr)` | number | `avg(o.amount)` |
| `min(expr)` | same type | `min(o.createdAt)` |
| `max(expr)` | same type | `max(o.createdAt)` |

Aggregates require `.groupBy()`:

```typescript
q.from({ o: orders })
  .groupBy(({ o }) => o.customerId)
  .select(({ o }) => ({
    customerId: o.customerId,
    total: sum(o.amount),
    count: count(),
    average: avg(o.amount),
    firstOrder: min(o.createdAt),
    lastOrder: max(o.createdAt),
  }))
```

Use `$selected` to reference aggregated fields in `.having()`:

```typescript
.having(({ $selected }) => gt($selected.total, 1000))
```

## String Functions

```typescript
import { upper, lower, length, concat, coalesce } from '@tanstack/db'
```

| Function | Returns | Example |
|----------|---------|---------|
| `upper(expr)` | string | `upper(u.name)` |
| `lower(expr)` | string | `lower(u.email)` |
| `length(expr)` | number | `length(u.name)` |
| `concat(...exprs)` | string | `concat(u.first, ' ', u.last)` |
| `coalesce(...exprs)` | first non-null | `coalesce(u.nickname, u.name)` |

```typescript
q.from({ u: users }).select(({ u }) => ({
  id: u.id,
  display: coalesce(u.nickname, concat(u.firstName, ' ', u.lastName)),
  emailLower: lower(u.email),
  nameLen: length(u.name),
}))
```

## Math Functions

```typescript
import { add } from '@tanstack/db'
```

| Function | Returns | Example |
|----------|---------|---------|
| `add(a, b)` | number | `add(t.price, t.tax)` |

```typescript
q.from({ p: products }).select(({ p }) => ({
  id: p.id,
  totalPrice: add(p.price, p.shipping),
}))
```

## Complete Example

```typescript
import {
  eq, gt, and, or, not, isNull, inArray, ilike,
  count, sum, avg,
  upper, concat, coalesce, add,
} from '@tanstack/db'

q.from({ o: orders })
  .join({ c: customers }, ({ o, c }) => eq(o.customerId, c.id))
  .where(({ o, c }) =>
    and(
      not(isNull(c.email)),
      inArray(o.status, ['completed', 'shipped']),
      gt(o.amount, 0),
    ),
  )
  .groupBy(({ c }) => c.id)
  .select(({ o, c }) => ({
    customerId: c.id,
    name: upper(c.name),
    email: coalesce(c.email, 'unknown'),
    orderCount: count(),
    totalSpent: sum(o.amount),
    avgOrder: avg(o.amount),
  }))
  .having(({ $selected }) => gt($selected.totalSpent, 500))
  .orderBy(({ $selected }) => $selected.totalSpent, 'desc')
  .limit(20)
```

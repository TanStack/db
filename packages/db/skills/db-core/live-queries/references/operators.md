# Query Operators Reference

All operators are imported from `@tanstack/db` (also re-exported by `@tanstack/react-db` and other framework packages).

```ts
import {
  // Comparison
  eq, gt, gte, lt, lte, like, ilike, inArray, isNull, isUndefined,
  // Logical
  and, or, not,
  // Aggregate
  count, sum, avg, min, max,
  // String
  upper, lower, length, concat,
  // Math
  add,
  // Utility
  coalesce,
} from '@tanstack/db'
```

---

## Comparison Operators

### eq(left, right) -> BasicExpression\<boolean\>

Equality comparison. Works with any type.

```ts
eq(user.id, 1)
eq(user.name, 'Alice')
```

### not(eq(left, right)) — not-equal pattern

There is no `ne` operator. Use `not(eq(...))` for not-equal:

```ts
not(eq(user.role, 'banned'))
```

### gt, gte, lt, lte (left, right) -> BasicExpression\<boolean\>

Ordering comparisons. Work with numbers, strings, dates.

```ts
gt(user.age, 18)              // greater than
gte(user.salary, 50000)       // greater than or equal
lt(user.age, 65)              // less than
lte(user.rating, 5)           // less than or equal
gt(user.createdAt, new Date('2024-01-01'))
```

### like(left, right) -> BasicExpression\<boolean\>

Case-sensitive string pattern matching. Use `%` as wildcard.

```ts
like(user.name, 'John%')       // starts with John
like(user.email, '%@corp.com')  // ends with @corp.com
```

### ilike(left, right) -> BasicExpression\<boolean\>

Case-insensitive string pattern matching.

```ts
ilike(user.email, '%@gmail.com')
```

### inArray(value, array) -> BasicExpression\<boolean\>

Check if value is contained in an array.

```ts
inArray(user.id, [1, 2, 3])
inArray(user.role, ['admin', 'moderator'])
```

### isNull(value) -> BasicExpression\<boolean\>

Check if value is explicitly `null`.

```ts
isNull(user.bio)
```

### isUndefined(value) -> BasicExpression\<boolean\>

Check if value is `undefined` (absent). Especially useful after left joins where unmatched rows produce `undefined`.

```ts
isUndefined(profile)  // no matching profile in left join
```

---

## Logical Operators

### and(...conditions) -> BasicExpression\<boolean\>

Combine two or more conditions with AND logic.

```ts
and(eq(user.active, true), gt(user.age, 18))
and(eq(user.active, true), gt(user.age, 18), eq(user.role, 'user'))
```

### or(...conditions) -> BasicExpression\<boolean\>

Combine two or more conditions with OR logic.

```ts
or(eq(user.role, 'admin'), eq(user.role, 'moderator'))
```

### not(condition) -> BasicExpression\<boolean\>

Negate a condition.

```ts
not(eq(user.active, false))
not(inArray(user.id, bannedIds))
```

---

## Aggregate Functions

Used inside `.select()` with `.groupBy()`, or without `groupBy` to aggregate the entire collection as one group.

### count(value) -> Aggregate\<number\>

Count non-null values in a group.

```ts
count(user.id)
```

### sum(value), avg(value) -> Aggregate\<number | null | undefined\>

Sum or average of numeric values.

```ts
sum(order.amount)
avg(user.salary)
```

### min(value), max(value) -> Aggregate\<T\>

Minimum/maximum value (numbers, strings, dates).

```ts
min(order.amount)
max(user.createdAt)
```

---

## String Functions

### upper(value), lower(value) -> BasicExpression\<string\>

Convert string case.

```ts
upper(user.name)   // 'ALICE'
lower(user.email)  // 'alice@example.com'
```

### length(value) -> BasicExpression\<number\>

Get string or array length.

```ts
length(user.name)  // string length
length(user.tags)  // array length
```

### concat(...values) -> BasicExpression\<string\>

Concatenate any number of values into a string.

```ts
concat(user.firstName, ' ', user.lastName)
```

---

## Math Functions

### add(left, right) -> BasicExpression\<number\>

Add two numeric values.

```ts
add(order.price, order.tax)
add(user.salary, coalesce(user.bonus, 0))
```

---

## Utility Functions

### coalesce(...values) -> BasicExpression\<any\>

Return the first non-null, non-undefined value.

```ts
coalesce(user.displayName, user.name, 'Unknown')
coalesce(user.bonus, 0)
```

---

## $selected Namespace

When a query has a `.select()` clause, the `$selected` namespace becomes available in `.orderBy()` and `.having()` callbacks. It provides access to the computed/aggregated fields defined in `select`.

```ts
q.from({ order: ordersCollection })
  .groupBy(({ order }) => order.customerId)
  .select(({ order }) => ({
    customerId: order.customerId,
    totalSpent: sum(order.amount),
    orderCount: count(order.id),
  }))
  .having(({ $selected }) => gt($selected.totalSpent, 1000))
  .orderBy(({ $selected }) => $selected.totalSpent, 'desc')
```

`$selected` is only available when `.select()` (or `.fn.select()`) has been called on the query.

---

## Functional Variants (fn.select, fn.where, fn.having)

Escape hatches for logic that cannot be expressed with declarative operators. These execute arbitrary JS on each row but **cannot be optimized** by the query compiler (no predicate push-down, no index use).

### fn.select(callback)

```ts
q.from({ user: usersCollection })
  .fn.select((row) => ({
    id: row.user.id,
    domain: row.user.email.split('@')[1],
    tier: row.user.salary > 100000 ? 'senior' : 'junior',
  }))
```

**Limitation**: `fn.select()` cannot be used with `groupBy()`. The compiler must statically analyze select to discover aggregate functions.

### fn.where(callback)

```ts
q.from({ user: usersCollection })
  .fn.where((row) =>
    row.user.active && row.user.email.endsWith('@company.com')
  )
```

### fn.having(callback)

Receives `$selected` when a `select()` clause exists.

```ts
q.from({ order: ordersCollection })
  .groupBy(({ order }) => order.customerId)
  .select(({ order }) => ({
    customerId: order.customerId,
    totalSpent: sum(order.amount),
    orderCount: count(order.id),
  }))
  .fn.having(({ $selected }) =>
    $selected.totalSpent > 1000 && $selected.orderCount >= 3
  )
```

### When to use functional variants

- String manipulation not covered by `upper`/`lower`/`concat`/`like` (e.g., `split`, `slice`, regex)
- Complex conditional logic (ternaries, multi-branch)
- External function calls or lookups

Prefer declarative operators whenever possible for incremental maintenance.

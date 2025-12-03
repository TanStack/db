# Handling `eq(col, null)` with 3-Valued Logic

## Background

PR #765 introduced 3-valued logic (true/false/unknown) for all comparison and logical operators to match SQL database behavior. The changeset stated:

> With 3-valued logic, `eq(anything, null)` evaluates to `null` (UNKNOWN) and is filtered out. Use `isNull()` instead.

This was an intentional breaking change to align local query evaluation with SQL semantics.

## The Problem

After PR #765, an inconsistency emerged between the SQL compiler and JavaScript evaluator when handling `eq(col, null)`:

### SQL Compiler Behavior

When `eq(col, null)` is compiled to SQL for Electric proxy queries, we faced a choice:

1. Generate `"col" = $1` with `null` as the parameter → But `serialize(null)` returns empty string, causing invalid queries with missing params (the original bug)
2. Generate `"col" = NULL` → Always returns UNKNOWN in SQL, matching 3-valued logic but returning no rows
3. Transform to `"col" IS NULL` → Returns rows where col is null

We chose option 3 because option 1 was broken and option 2 would silently return no results.

### JavaScript Evaluator Behavior (Before Fix)

The JS evaluator followed strict 3-valued logic:
```javascript
case `eq`: {
  return (data) => {
    const a = argA(data)
    const b = argB(data)
    if (isUnknown(a) || isUnknown(b)) {
      return null  // UNKNOWN
    }
    return a === b
  }
}
```

### The Inconsistency

This created a frustrating user experience:

1. User writes: `eq(user.email, null)`
2. SQL compiler generates: `"email" IS NULL` → Data loads from Electric
3. JS evaluator returns: `null` (UNKNOWN) → `toBooleanPredicate(null)` = `false` → All rows filtered out
4. Result: Data loads but immediately disappears

## The Solution

We modified the JS evaluator to detect **literal null values** at compile time and transform them to `isNull` semantics:

```javascript
case `eq`: {
  const argExprA = func.args[0]
  const argExprB = func.args[1]
  const aIsLiteralNull = argExprA?.type === `val` &&
    (argExprA.value === null || argExprA.value === undefined)
  const bIsLiteralNull = argExprB?.type === `val` &&
    (argExprB.value === null || argExprB.value === undefined)

  if (aIsLiteralNull && bIsLiteralNull) {
    // eq(null, null) - always true
    return () => true
  } else if (aIsLiteralNull) {
    // eq(null, col) - check if col is null/undefined
    return (data) => argB(data) === null || argB(data) === undefined
  } else if (bIsLiteralNull) {
    // eq(col, null) - check if col is null/undefined
    return (data) => argA(data) === null || argA(data) === undefined
  }

  // Standard 3-valued logic for column-to-column comparisons
  // ...
}
```

## Why This Approach?

### 1. Consistency Between SQL and JS

Both the SQL compiler and JS evaluator now handle `eq(col, null)` the same way - as an IS NULL check. Data that loads from the server won't be unexpectedly filtered out locally.

### 2. Preserves 3-Valued Logic Where It Matters

3-valued logic still applies for **column-to-column comparisons**:

```typescript
// 3-valued logic applies - returns UNKNOWN if either column is null
eq(user.email, manager.email)
```

This is the important case for 3-valued logic - when you're comparing two columns and one might unexpectedly be null in the data.

### 3. Handles Dynamic Values Gracefully

If a user has a dynamic filter value that might be null:

```typescript
const filterValue = getUserInput() // might be null
q.where(({ user }) => eq(user.name, filterValue))
```

With strict 3-valued logic, this would silently return no results when `filterValue` is null. With our fix, it correctly returns rows where `name` is null.

Without this fix, users would need to write:
```typescript
q.where(({ user }) =>
  filterValue === null
    ? isNull(user.name)
    : eq(user.name, filterValue)
)
```

### 4. Follows User Intent

When a user explicitly writes `eq(col, null)`, they almost certainly mean "find rows where col is null". The strict 3-valued interpretation (return UNKNOWN, filter out all rows) is technically correct but practically useless.

## The Distinction

| Expression | Behavior | Rationale |
|------------|----------|-----------|
| `eq(col, null)` | Returns `true` if col is null | User explicitly asked for null comparison |
| `eq(col, variable)` where variable is null | Returns `true` if col is null | Same as above - the null is a literal value in the IR |
| `eq(col1, col2)` where col2 is null at runtime | Returns `null` (UNKNOWN) | 3-valued logic - null in data is unexpected |

The key insight is that **literal null values** (type `val` in the IR) represent intentional null comparisons, while **null column values** at runtime represent missing/unknown data where 3-valued logic is appropriate.

## Other Comparison Operators

For other operators (`gt`, `lt`, `gte`, `lte`, `like`, `ilike`), comparing with null doesn't have a sensible interpretation like "IS NULL", so the SQL compiler throws an error:

```
Cannot use null/undefined value with 'gt' operator. Use isNull() or isUndefined() to check for null/undefined values.
```

This guides users toward the correct approach while allowing `eq(col, null)` to work intuitively.

## Summary

This is a pragmatic middle-ground that:
- Maintains SQL/JS consistency for `eq(col, null)`
- Preserves 3-valued logic for column-to-column comparisons
- Handles dynamic null values gracefully
- Follows user intent when they explicitly compare to null

The alternative (strict 3-valued logic everywhere) would require users to always use `isNull()` and handle dynamic values explicitly, which is more error-prone and less intuitive.

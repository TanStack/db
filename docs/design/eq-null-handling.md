# Handling Null Values in Comparison Operators

## Background

PR #765 introduced 3-valued logic (true/false/unknown) for all comparison and logical operators to match SQL database behavior. The changeset stated:

> With 3-valued logic, `eq(anything, null)` evaluates to `null` (UNKNOWN) and is filtered out. Use `isNull()` instead.

This was an intentional breaking change to align local query evaluation with SQL semantics.

## The Problem

When using cursor-based pagination (e.g., `useLiveInfiniteQuery`), if a cursor column has a `null` value, the next page query would generate something like `gt(col, null)`. This caused invalid SQL queries with missing parameters because `serialize(null)` returns an empty string.

Example of the bug:
```
subset__where="projectId" = $1 AND "name" > $2
subset__params={"1":"uuid..."} // missing $2!
```

## The Solution

All comparison operators (`eq`, `gt`, `gte`, `lt`, `lte`, `like`, `ilike`) now throw a clear error when used with `null` or `undefined` values:

```
Cannot use null/undefined value with 'eq' operator.
Comparisons with null always evaluate to UNKNOWN in SQL.
Use isNull() or isUndefined() to check for null values,
or filter out null values before building the query.
```

## Why Not Transform `eq(col, null)` to `IS NULL`?

We considered automatically transforming `eq(col, null)` to `IS NULL` syntax, but decided against it for these reasons:

1. **Consistency with 3-valued logic design**: PR #765 explicitly documented that `eq(col, null)` should return UNKNOWN and users should use `isNull()` instead.

2. **Explicitness**: Requiring users to write `isNull(col)` makes the intent clear and avoids confusion about SQL null semantics.

3. **Runtime null values**: If we transformed literal `null` to `IS NULL`, users might expect `eq(col, variable)` where `variable` is `null` at runtime to also work like `IS NULL`. But we can't distinguish these cases at the IR level, and silently returning no results (UNKNOWN) would be confusing.

## Correct Usage

### Checking for null values

```typescript
// Correct - use isNull()
q.where(({ user }) => isNull(user.email))

// Correct - use isUndefined()
q.where(({ user }) => isUndefined(user.deletedAt))

// Correct - negate with not()
q.where(({ user }) => not(isNull(user.email)))
```

### Handling dynamic values that might be null

```typescript
const filterValue = getUserInput() // might be null

// Option 1: Filter out null values before building the query
if (filterValue !== null) {
  q.where(({ user }) => eq(user.name, filterValue))
}

// Option 2: Handle null case explicitly
q.where(({ user }) =>
  filterValue === null
    ? isNull(user.name)
    : eq(user.name, filterValue)
)
```

### Cursor-based pagination

The original bug was caused by cursor columns having null values. The fix is to ensure cursor columns are never null:

```typescript
// Add a secondary orderBy on a non-nullable column (like primary key)
q.orderBy(({ user }) => [
  asc(user.name),      // might be null
  asc(user.id),        // never null - ensures valid cursor
])
```

## 3-Valued Logic Behavior

With the current implementation, 3-valued logic applies consistently:

| Expression | Result |
|------------|--------|
| `eq(col, null)` | **Error** - use `isNull(col)` |
| `eq(col, value)` where `col` is null at runtime | `null` (UNKNOWN) |
| `eq(col1, col2)` where either is null at runtime | `null` (UNKNOWN) |
| `isNull(col)` | `true` or `false` |

The UNKNOWN result from 3-valued logic causes rows to be filtered out (not included in WHERE clause results), matching SQL behavior.

## Summary

- All comparison operators throw errors for null/undefined values
- Use `isNull()` or `isUndefined()` to check for null values
- 3-valued logic applies when column values are null at runtime
- Cursor-based pagination should use non-nullable columns or add a secondary sort key

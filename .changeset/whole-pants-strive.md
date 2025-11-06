---
"@tanstack/db": major
---

Implement 3-valued logic (true/false/unknown) for all comparison and logical operators.
Queries with null/undefined values now behave consistently with SQL databases, where UNKNOWN results exclude rows from WHERE clauses.

**Breaking Change**: This changes the behavior of `WHERE` and `HAVING` clauses when dealing with `null` and `undefined` values.

**Example 1: Equality checks with null**

Previously, this query would return all persons with `age = null`:

```ts
q.from(...).where(({ person }) => eq(person.age, null))
```

With 3-valued logic, `eq(anything, null)` evaluates to `null` (UNKNOWN) and is filtered out. Use `isNull()` instead:

```ts
q.from(...).where(({ person }) => isNull(person.age))
```

**Example 2: Comparisons with null values**

Previously, this query would return persons with `age < 18` OR `age = null`:

```ts
q.from(...).where(({ person }) => lt(person.age, 18))
```

With 3-valued logic, `lt(null, 18)` evaluates to `null` (UNKNOWN) and is filtered out. The same applies to `undefined` values. To include null values, combine with `isNull()`:

```ts
q.from(...).where(({ person }) =>
  or(lt(person.age, 18), isNull(person.age))
)
```
